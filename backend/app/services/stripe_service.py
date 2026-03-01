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
}


def get_stripe_client() -> StripeClient:
    global _client
    if not settings.STRIPE_SECRET_KEY:
        raise RuntimeError("STRIPE_SECRET_KEY is not configured")
    if _client is None:
        _client = StripeClient(
            api_key=settings.STRIPE_SECRET_KEY,
            stripe_version="2024-12-18.acacia",
        )
    return _client


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


def create_checkout_session(db: Session, lab: Lab, success_url: str, cancel_url: str) -> str:
    validate_redirect_url(success_url)
    validate_redirect_url(cancel_url)
    client = get_stripe_client()
    customer_id = get_or_create_customer(db, lab)
    session = client.checkout.sessions.create(
        params={
            "customer": customer_id,
            "client_reference_id": str(lab.id),
            "mode": "subscription",
            "line_items": [{"price": settings.STRIPE_PRICE_ID, "quantity": 1}],
            "success_url": success_url,
            "cancel_url": cancel_url,
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


def create_invoice_subscription(db: Session, lab: Lab) -> str:
    client = get_stripe_client()
    customer_id = get_or_create_customer(db, lab)
    if lab.stripe_subscription_id:
        raise ValueError("Lab already has a subscription")

    description = "LabAid Annual Subscription"
    if settings.STRIPE_CHECK_ADDRESS:
        description += f"\n\nTo pay by check, please mail to:\n{settings.STRIPE_CHECK_ADDRESS}"

    subscription = client.subscriptions.create(
        params={
            "customer": customer_id,
            "collection_method": "send_invoice",
            "days_until_due": 30,
            "items": [{"price": settings.STRIPE_PRICE_ID}],
            "description": description,
            "metadata": {"lab_id": str(lab.id)},
        },
        options={"idempotency_key": f"invsub_{lab.id}_{int(time.time() // 300)}"},
    )
    return subscription.id


def get_subscription_details(lab: Lab) -> dict | None:
    if not lab.stripe_subscription_id:
        return None
    client = get_stripe_client()
    try:
        sub = client.subscriptions.retrieve(lab.stripe_subscription_id)
        return {
            "status": sub.status,
            "current_period_start": sub.current_period_start,
            "current_period_end": sub.current_period_end,
            "created": sub.created,
            "collection_method": sub.collection_method,
            "cancel_at_period_end": sub.cancel_at_period_end,
        }
    except Exception:
        logger.warning("Could not fetch subscription %s", lab.stripe_subscription_id)
        return None


def apply_subscription_status(
    db: Session,
    lab: Lab,
    stripe_status: str,
    subscription_id: str | None = None,
    user_id: UUID | None = None,
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
    if subscription_id:
        lab.stripe_subscription_id = subscription_id

    if new_billing == BillingStatus.ACTIVE.value:
        lab.trial_ends_at = None

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
