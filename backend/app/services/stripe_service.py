import logging
import time
from datetime import datetime, timezone
from urllib.parse import urlparse
from uuid import UUID

from stripe import StripeClient
from sqlalchemy.orm import Session

from app.core.cache import suspension_cache
from app.core.config import settings
from app.models.models import BillingStatus, Lab, User, UserRole
from app.services.audit import log_audit, snapshot_lab

_client: StripeClient | None = None
_ALLOWED_ORIGINS: set[str] | None = None


def _get_allowed_origins() -> set[str]:
    global _ALLOWED_ORIGINS
    if _ALLOWED_ORIGINS is None:
        _ALLOWED_ORIGINS = {o.strip().rstrip("/") for o in (settings.CORS_ORIGINS or "").split(",") if o.strip()}
    return _ALLOWED_ORIGINS


def validate_redirect_url(url: str) -> str:
    parsed = urlparse(url)
    origin = f"{parsed.scheme}://{parsed.netloc}".rstrip("/")
    if origin not in _get_allowed_origins():
        raise ValueError("Invalid redirect URL origin")
    return url

logger = logging.getLogger("labaid")

_STATUS_MAP = {
    "active": (BillingStatus.ACTIVE.value, True),
    "trialing": (BillingStatus.TRIAL.value, True),
    "past_due": (BillingStatus.PAST_DUE.value, True),
    "canceled": (BillingStatus.CANCELLED.value, False),
    "unpaid": (BillingStatus.CANCELLED.value, False),
    "incomplete": (BillingStatus.CANCELLED.value, False),
    "incomplete_expired": (BillingStatus.CANCELLED.value, False),
    "paused": (BillingStatus.CANCELLED.value, False),
}


def _resolve_plan_tier(price_id: str | None) -> str:
    if price_id and settings.STRIPE_ENTERPRISE_PRICE_ID and price_id == settings.STRIPE_ENTERPRISE_PRICE_ID:
        return "enterprise"
    return "standard"


def _resolve_price_id(plan_tier: str | None) -> str:
    if plan_tier == "enterprise":
        if not settings.STRIPE_ENTERPRISE_PRICE_ID:
            raise ValueError("Enterprise billing is not configured")
        return settings.STRIPE_ENTERPRISE_PRICE_ID
    return settings.STRIPE_PRICE_ID


def _get_subscription_item_and_price(sub) -> tuple[str | None, str | None]:
    try:
        items = sub["items"] if not isinstance(sub, dict) else sub.get("items")
    except (KeyError, TypeError):
        items = None
    if items:
        data = items.data if hasattr(items, "data") else items.get("data", []) if isinstance(items, dict) else []
        if data and len(data) > 0:
            item = data[0]
            item_id = getattr(item, "id", None) if not isinstance(item, dict) else item.get("id")
            price = getattr(item, "price", None) if not isinstance(item, dict) else item.get("price")
            if price:
                price_id = getattr(price, "id", None) if not isinstance(price, dict) else price.get("id")
            else:
                price_id = None
            return item_id, price_id
    return None, None


def get_stripe_client() -> StripeClient:
    global _client
    if not settings.STRIPE_SECRET_KEY:
        raise RuntimeError("STRIPE_SECRET_KEY is not configured")
    if _client is None:
        _client = StripeClient(
            api_key=settings.STRIPE_SECRET_KEY,
            stripe_version="2026-02-25.clover",
        )
    return _client


def _get_item_period(sub) -> tuple[int | None, int | None]:
    """Extract current_period_start/end from the first subscription item.

    Stripe API 2025-03-31+ moved these fields from subscription level to item level.
    Note: sub.items collides with dict.items(), so we use sub["items"] for SDK objects.
    """
    try:
        items = sub["items"] if not isinstance(sub, dict) else sub.get("items")
    except (KeyError, TypeError):
        items = None
    if items:
        data = items.data if hasattr(items, "data") else items.get("data", []) if isinstance(items, dict) else []
        if data and len(data) > 0:
            item = data[0]
            start = getattr(item, "current_period_start", None) if not isinstance(item, dict) else item.get("current_period_start")
            end = getattr(item, "current_period_end", None) if not isinstance(item, dict) else item.get("current_period_end")
            if start or end:
                return start, end
    # Fallback to subscription-level fields for older API versions
    if isinstance(sub, dict):
        return sub.get("current_period_start"), sub.get("current_period_end")
    return getattr(sub, "current_period_start", None), getattr(sub, "current_period_end", None)


def _finalize_latest_invoice(client: StripeClient, latest_invoice, lab_id) -> None:
    if not latest_invoice:
        return
    if isinstance(latest_invoice, str):
        invoice_id = latest_invoice
    else:
        if latest_invoice.status != "draft":
            return
        invoice_id = latest_invoice.id
    try:
        client.invoices.finalize_invoice(invoice_id)
    except Exception:
        logger.warning("Could not auto-finalize invoice %s for lab %s", invoice_id, lab_id)
        return
    try:
        client.invoices.send_invoice(invoice_id)
    except Exception:
        logger.warning("Could not send invoice %s for lab %s", invoice_id, lab_id)


def get_or_create_customer(db: Session, lab: Lab) -> str:
    if lab.stripe_customer_id:
        return lab.stripe_customer_id
    # Lock row to prevent duplicate Stripe customers on concurrent requests
    lab = db.query(Lab).filter(Lab.id == lab.id).with_for_update().first()
    if lab.stripe_customer_id:
        return lab.stripe_customer_id
    client = get_stripe_client()
    customer = client.customers.create(
        params={
            "name": lab.name,
            "email": lab.billing_email,
            "metadata": {"lab_id": str(lab.id)},
        },
        options={"idempotency_key": f"cust_{lab.id}"},
    )
    lab.stripe_customer_id = customer.id
    db.flush()
    return customer.id


def create_checkout_session(db: Session, lab: Lab, success_url: str, cancel_url: str, price_id: str | None = None) -> str:
    validate_redirect_url(success_url)
    validate_redirect_url(cancel_url)
    client = get_stripe_client()
    customer_id = get_or_create_customer(db, lab)
    session = client.checkout.sessions.create(
        params={
            "customer": customer_id,
            "client_reference_id": str(lab.id),
            "mode": "subscription",
            "currency": "usd",
            "line_items": [{"price": price_id or settings.STRIPE_PRICE_ID, "quantity": 1}],
            "success_url": success_url,
            "cancel_url": cancel_url,
            "billing_address_collection": "required",
            "phone_number_collection": {"enabled": True},
            "name_collection": {"business": {"enabled": True}},
            "customer_update": {"address": "auto", "name": "auto"},
        },
        options={"idempotency_key": f"checkout_{lab.id}_{int(time.time() // 300)}"},
    )
    return session.url


def create_portal_session(lab: Lab, return_url: str) -> str:
    validate_redirect_url(return_url)
    if not lab.stripe_customer_id:
        raise ValueError("Lab has no Stripe customer")
    client = get_stripe_client()
    session = client.billing_portal.sessions.create(params={
        "customer": lab.stripe_customer_id,
        "return_url": return_url,
    })
    return session.url


def create_invoice_subscription(db: Session, lab: Lab, price_id: str | None = None) -> str:
    client = get_stripe_client()
    customer_id = get_or_create_customer(db, lab)
    if lab.stripe_subscription_id and lab.billing_status not in (BillingStatus.CANCELLED.value,):
        raise ValueError("Lab already has a subscription")

    description = "LabAid Annual Subscription"
    if settings.STRIPE_CHECK_ADDRESS:
        description += f"\n\nTo pay by check, please mail to:\n{settings.STRIPE_CHECK_ADDRESS}"

    subscription = client.subscriptions.create(
        params={
            "customer": customer_id,
            "collection_method": "send_invoice",
            "days_until_due": 30,
            "items": [{"price": price_id or settings.STRIPE_PRICE_ID}],
            "description": description,
            "metadata": {"lab_id": str(lab.id)},
        },
        options={"idempotency_key": f"invsub_{lab.id}_{int(time.time() // 300)}"},
    )

    _finalize_latest_invoice(client, subscription.latest_invoice, lab.id)

    return subscription.id


def get_subscription_details(lab: Lab) -> dict | None:
    if not lab.stripe_subscription_id:
        return None
    client = get_stripe_client()
    try:
        sub = client.subscriptions.retrieve(
            lab.stripe_subscription_id,
            params={"expand": ["latest_invoice"]},
        )
        latest_invoice_status = None
        if sub.latest_invoice and not isinstance(sub.latest_invoice, str):
            latest_invoice_status = sub.latest_invoice.status
        cancellation_reason = None
        if sub.cancellation_details:
            raw = getattr(sub.cancellation_details, "reason", None)
            if raw == "cancellation_requested" and sub.trial_end:
                canceled_at = getattr(sub, "canceled_at", 0) or 0
                trial_end = sub.trial_end or 0
                if canceled_at >= trial_end and trial_end > 0:
                    cancellation_reason = "trial_expired"
            if not cancellation_reason and raw:
                reason_map = {"payment_failed": "payment_failed", "cancellation_requested": "customer_requested"}
                cancellation_reason = reason_map.get(raw, raw)
        period_start, period_end = _get_item_period(sub)
        _, price_id = _get_subscription_item_and_price(sub)
        return {
            "status": sub.status,
            "current_period_start": period_start,
            "current_period_end": period_end,
            "created": sub.created,
            "collection_method": sub.collection_method,
            "cancel_at_period_end": sub.cancel_at_period_end,
            "latest_invoice_status": latest_invoice_status,
            "trial_end": sub.trial_end,
            "cancellation_reason": cancellation_reason,
            "plan_tier": _resolve_plan_tier(price_id),
        }
    except Exception as e:
        logger.warning("Could not fetch subscription %s: %s", lab.stripe_subscription_id, type(e).__name__)
        return None


def create_trial_subscription(db: Session, lab: Lab, trial_days: int = 7) -> str | None:
    try:
        customer_id = get_or_create_customer(db, lab)
        client = get_stripe_client()
        subscription = client.subscriptions.create(
            params={
                "customer": customer_id,
                "items": [{"price": settings.STRIPE_PRICE_ID}],
                "trial_period_days": trial_days,
                "trial_settings": {
                    "end_behavior": {"missing_payment_method": "cancel"},
                },
                "payment_settings": {
                    "save_default_payment_method": "on_subscription",
                },
                "metadata": {"lab_id": str(lab.id)},
            },
            options={"idempotency_key": f"trialsub_{lab.id}"},
        )
        lab.stripe_subscription_id = subscription.id
        if subscription.trial_end:
            lab.trial_ends_at = datetime.fromtimestamp(subscription.trial_end, tz=timezone.utc)
        db.flush()
        return subscription.id
    except Exception as e:
        logger.warning("Failed to create Stripe trial subscription for lab %s: %s", lab.id, type(e).__name__)
        return None


def create_trial_conversion_checkout(db: Session, lab: Lab, success_url: str, cancel_url: str) -> str:
    validate_redirect_url(success_url)
    validate_redirect_url(cancel_url)
    client = get_stripe_client()
    customer_id = get_or_create_customer(db, lab)
    session = client.checkout.sessions.create(
        params={
            "customer": customer_id,
            "client_reference_id": str(lab.id),
            "mode": "setup",
            "success_url": success_url,
            "cancel_url": cancel_url,
            "metadata": {
                "lab_id": str(lab.id),
                "convert_trial_subscription": lab.stripe_subscription_id,
            },
            "billing_address_collection": "required",
            "phone_number_collection": {"enabled": True},
            "name_collection": {"business": {"enabled": True}},
            "customer_update": {"address": "auto", "name": "auto"},
        },
        options={"idempotency_key": f"trial_convert_{lab.id}_{int(time.time() // 300)}"},
    )
    return session.url


def convert_trial_to_invoice(db: Session, lab: Lab) -> str:
    client = get_stripe_client()
    description = "LabAid Annual Subscription"
    if settings.STRIPE_CHECK_ADDRESS:
        description += f"\n\nTo pay by check, please mail to:\n{settings.STRIPE_CHECK_ADDRESS}"
    updated_sub = client.subscriptions.update(
        lab.stripe_subscription_id,
        params={
            "collection_method": "send_invoice",
            "days_until_due": 30,
            "trial_end": "now",
            "description": description,
            "default_payment_method": "",
            "trial_settings": {
                "end_behavior": {"missing_payment_method": "create_invoice"},
            },
        },
        options={"idempotency_key": f"trial_to_inv_{lab.id}_{int(time.time() // 300)}"},
    )

    _finalize_latest_invoice(client, updated_sub.latest_invoice, lab.id)

    return lab.stripe_subscription_id


def switch_to_invoice(lab: Lab) -> None:
    if not lab.stripe_subscription_id:
        raise ValueError("Lab has no subscription")
    client = get_stripe_client()
    tier = "Enterprise" if lab.plan_tier == "enterprise" else ""
    description = f"LabAid Annual Subscription{' — ' + tier if tier else ''}"
    if settings.STRIPE_CHECK_ADDRESS:
        description += f"\n\nTo pay by check, please mail to:\n{settings.STRIPE_CHECK_ADDRESS}"
    client.subscriptions.update(
        lab.stripe_subscription_id,
        params={
            "collection_method": "send_invoice",
            "days_until_due": 30,
            "default_payment_method": "",
            "description": description,
        },
        options={"idempotency_key": f"switch_inv_{lab.id}_{int(time.time() // 300)}"},
    )


def extend_trial(db: Session, lab: Lab, new_trial_end: datetime) -> None:
    if not lab.stripe_subscription_id:
        return
    client = get_stripe_client()
    timestamp = int(new_trial_end.timestamp())
    client.subscriptions.update(
        lab.stripe_subscription_id,
        params={"trial_end": timestamp},
        options={"idempotency_key": f"extend_trial_{lab.id}_{timestamp}"},
    )


def sync_subscription_status(db: Session, lab: Lab, details: dict) -> bool:
    """Read-through correction: compare live Stripe status against local DB and fix mismatches.

    Returns True if a correction was made.
    """
    stripe_status = details.get("status")
    if not stripe_status:
        return False
    mapping = _STATUS_MAP.get(stripe_status)
    if not mapping:
        return False
    expected_local, _ = mapping
    if lab.billing_status == expected_local:
        return False
    # Preserve invoice_pending when Stripe says active (invoice sent, awaiting payment)
    if lab.billing_status == BillingStatus.INVOICE_PENDING.value and stripe_status == "active":
        return False
    logger.warning(
        "Read-through correction: lab %s (%s) local=%s stripe=%s, fixing",
        lab.id, lab.name, lab.billing_status, stripe_status,
        extra={
            "event": "billing_sync_correction",
            "lab_id": str(lab.id),
            "lab_name": lab.name,
            "old_status": lab.billing_status,
            "new_status": stripe_status,
        },
    )
    apply_subscription_status(
        db, lab, stripe_status,
        subscription_id=lab.stripe_subscription_id,
        current_period_end=details.get("current_period_end"),
        cancel_at_period_end=details.get("cancel_at_period_end", False),
        trial_end=details.get("trial_end"),
        cancellation_reason=details.get("cancellation_reason"),
    )
    return True


def apply_subscription_status(
    db: Session,
    lab: Lab,
    stripe_status: str,
    subscription_id: str | None = None,
    user_id: UUID | None = None,
    current_period_end: int | None = None,
    trial_end: int | None = None,
    cancel_at_period_end: bool | None = None,
    cancellation_reason: str | None = None,
) -> None:
    mapping = _STATUS_MAP.get(stripe_status)
    if not mapping:
        logger.warning("Unknown Stripe subscription status: %s", stripe_status)
        return

    new_billing, new_active = mapping
    before = snapshot_lab(lab)
    old_status = lab.billing_status

    lab.billing_status = new_billing
    lab.billing_updated_at = datetime.now(timezone.utc)
    lab.is_active = new_active
    if current_period_end:
        lab.current_period_end = datetime.fromtimestamp(current_period_end, tz=timezone.utc)
    if subscription_id:
        lab.stripe_subscription_id = subscription_id

    if cancel_at_period_end is not None:
        lab.cancel_at_period_end = cancel_at_period_end

    if new_billing == BillingStatus.CANCELLED.value:
        if cancellation_reason:
            lab.cancellation_reason = cancellation_reason
    else:
        lab.cancellation_reason = None

    if new_billing == BillingStatus.ACTIVE.value:
        lab.trial_ends_at = None
    elif new_billing == BillingStatus.TRIAL.value and trial_end:
        lab.trial_ends_at = datetime.fromtimestamp(trial_end, tz=timezone.utc)

    # For webhook-driven updates, find a lab admin to attribute the audit entry to
    audit_user_id = user_id
    if not audit_user_id:
        lab_admin = db.query(User).filter(
            User.lab_id == lab.id,
            User.role.in_([UserRole.LAB_ADMIN, UserRole.SUPER_ADMIN]),
        ).first()
        audit_user_id = lab_admin.id if lab_admin else None

    if audit_user_id:
        log_audit(
            db,
            lab_id=lab.id,
            user_id=audit_user_id,
            action="lab.billing_updated",
            entity_type="lab",
            entity_id=lab.id,
            before_state=before,
            after_state=snapshot_lab(lab),
            note=f"Stripe: {old_status} → {new_billing}",
        )

    # Invalidate suspension cache so middleware picks up new status immediately
    suspension_cache.pop(str(lab.id), None)


def preview_upgrade(lab: Lab) -> dict:
    client = get_stripe_client()
    sub = client.subscriptions.retrieve(lab.stripe_subscription_id)
    item_id, current_price_id = _get_subscription_item_and_price(sub)
    if not item_id:
        raise ValueError("Could not determine subscription item")

    preview = client.invoices.create_preview(
        params={
            "customer": lab.stripe_customer_id,
            "subscription": lab.stripe_subscription_id,
            "subscription_details": {
                "items": [{"id": item_id, "price": settings.STRIPE_ENTERPRISE_PRICE_ID}],
                "proration_behavior": "create_prorations",
            },
        },
    )

    proration_credit = 0
    proration_charge = 0
    for line in (preview.lines.data if preview.lines else []):
        if line.amount < 0:
            proration_credit += abs(line.amount)
        elif line.amount > 0 and "Remaining time" in (line.get("description") or ""):
            proration_charge += line.amount

    return {
        "amount_due": proration_charge - proration_credit,
        "currency": preview.currency,
        "proration_credit": proration_credit,
        "proration_charge": proration_charge,
        "current_tier": _resolve_plan_tier(current_price_id),
        "target_tier": "enterprise",
    }


def upgrade_plan(db: Session, lab: Lab, user_id: UUID) -> str:
    if not settings.STRIPE_ENTERPRISE_PRICE_ID:
        raise ValueError("Enterprise pricing is not configured")
    if not lab.stripe_subscription_id:
        raise ValueError("Lab has no subscription")
    if lab.billing_status not in (BillingStatus.ACTIVE.value, BillingStatus.INVOICE_PENDING.value):
        raise ValueError("Upgrade is only available for active subscriptions")
    if lab.plan_tier == "enterprise":
        raise ValueError("Lab is already on Enterprise")
    if lab.cancel_at_period_end:
        raise ValueError("Subscription is scheduled for cancellation. Reactivate before upgrading.")

    client = get_stripe_client()
    sub = client.subscriptions.retrieve(lab.stripe_subscription_id)
    item_id, _ = _get_subscription_item_and_price(sub)
    if not item_id:
        raise ValueError("Could not determine subscription item")

    client.subscriptions.update(
        lab.stripe_subscription_id,
        params={
            "items": [{"id": item_id, "price": settings.STRIPE_ENTERPRISE_PRICE_ID}],
            "proration_behavior": "create_prorations",
            "metadata": {"plan_tier": "enterprise", "lab_id": str(lab.id)},
        },
        options={"idempotency_key": f"upgrade_{lab.id}_enterprise_{int(time.time() // 300)}"},
    )

    # For invoice customers, finalize and send the prorated invoice
    if sub.collection_method == "send_invoice":
        updated_sub = client.subscriptions.retrieve(
            lab.stripe_subscription_id,
            params={"expand": ["latest_invoice"]},
        )
        _finalize_latest_invoice(client, updated_sub.latest_invoice, lab.id)

    return lab.stripe_subscription_id
