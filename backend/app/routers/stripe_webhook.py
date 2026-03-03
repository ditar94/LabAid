import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

import stripe
from stripe._error import SignatureVerificationError
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.middleware.auth import require_role
from app.core.cache import suspension_cache
from app.models.models import BillingStatus, Lab, StripeEvent, User, UserRole
from app.services.audit import log_audit
from app.services.stripe_service import apply_subscription_status, get_stripe_client

logger = logging.getLogger("labaid")

router = APIRouter(prefix="/api/stripe", tags=["stripe"])


@router.post("/webhook", status_code=200)
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    if not settings.STRIPE_WEBHOOK_SECRET:
        raise HTTPException(status_code=500, detail="Stripe webhook not configured")

    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")
    if not sig_header:
        raise HTTPException(status_code=400, detail="Missing stripe-signature header")

    try:
        event = stripe.Webhook.construct_event(payload, sig_header, settings.STRIPE_WEBHOOK_SECRET)
    except SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid signature")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid payload")

    try:
        existing = db.query(StripeEvent).filter(
            StripeEvent.stripe_event_id == event["id"]
        ).first()
        if existing:
            return {"status": "already_processed"}

        db.add(StripeEvent(stripe_event_id=event["id"], event_type=event["type"]))

        event_type = event["type"]
        data = event["data"]["object"]

        if event_type == "checkout.session.completed":
            _handle_checkout_completed(db, data)
        elif event_type == "checkout.session.async_payment_succeeded":
            _handle_checkout_completed(db, data)
        elif event_type == "checkout.session.async_payment_failed":
            _handle_async_payment_failed(db, data)
        elif event_type == "invoice.paid":
            _handle_invoice_paid(db, data)
        elif event_type == "invoice.payment_failed":
            _handle_invoice_payment_failed(db, data)
        elif event_type == "invoice.overdue":
            _handle_invoice_payment_failed(db, data)
        elif event_type == "invoice.marked_uncollectible":
            _handle_invoice_uncollectible(db, data)
        elif event_type == "invoice.sent":
            _handle_invoice_sent(db, data)
        elif event_type == "invoice.upcoming":
            _handle_invoice_upcoming(db, data)
        elif event_type == "customer.subscription.created":
            _handle_subscription_created(db, data)
        elif event_type == "customer.subscription.updated":
            _handle_subscription_updated(db, data)
        elif event_type == "customer.subscription.deleted":
            _handle_subscription_deleted(db, data)
        elif event_type == "customer.subscription.trial_will_end":
            _handle_trial_will_end(db, data)
        elif event_type == "charge.dispute.created":
            _handle_dispute_created(db, data)
        elif event_type == "customer.updated":
            _handle_customer_updated(db, data)
        else:
            logger.info("Unhandled Stripe event: %s", event_type)

        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Error processing Stripe webhook: %s", event["type"])
        return JSONResponse(status_code=500, content={"status": "error"})

    return {"status": "ok"}


def _find_lab_by_customer(db: Session, customer_id: str) -> Lab | None:
    return db.query(Lab).filter(Lab.stripe_customer_id == customer_id).first()


def _handle_checkout_completed(db: Session, session: dict) -> None:
    lab_id = session.get("client_reference_id")
    customer_id = session.get("customer")
    subscription_id = session.get("subscription")

    if not lab_id:
        logger.warning("checkout.session.completed missing client_reference_id")
        return

    lab = db.query(Lab).filter(Lab.id == UUID(lab_id)).first()
    if not lab:
        logger.warning("checkout.session.completed: lab %s not found", lab_id)
        return

    lab.stripe_customer_id = customer_id
    if session.get("customer_details", {}).get("email"):
        lab.billing_email = session["customer_details"]["email"]

    # Setup mode: trial conversion — collect payment method and end trial
    if session.get("mode") == "setup":
        metadata = session.get("metadata") or {}
        sub_id = metadata.get("convert_trial_subscription")
        setup_intent_id = session.get("setup_intent")
        if sub_id and setup_intent_id:
            if lab.stripe_subscription_id and sub_id != lab.stripe_subscription_id:
                logger.warning("Setup mode: subscription mismatch for lab %s (expected %s, got %s)",
                               lab.id, lab.stripe_subscription_id, sub_id)
                return
            client = get_stripe_client()
            setup_intent = client.setup_intents.retrieve(setup_intent_id)
            payment_method = setup_intent.payment_method
            if payment_method:
                pm_id = payment_method if isinstance(payment_method, str) else payment_method.id
                client.payment_methods.attach(pm_id, params={"customer": customer_id})
                client.customers.update(customer_id, params={
                    "invoice_settings": {"default_payment_method": pm_id},
                })
                client.subscriptions.update(sub_id, params={
                    "trial_end": "now",
                    "default_payment_method": pm_id,
                })
                # M1+M2: Fetch actual subscription status instead of hardcoding "active"
                sub = client.subscriptions.retrieve(sub_id)
                apply_subscription_status(
                    db, lab, sub.status, subscription_id=sub_id,
                    current_period_end=sub.current_period_end,
                    cancel_at_period_end=getattr(sub, "cancel_at_period_end", False),
                )
        return

    # Subscription mode: fetch actual subscription status
    status = "active"
    period_end = None
    if subscription_id and settings.STRIPE_SECRET_KEY:
        try:
            client = get_stripe_client()
            sub = client.subscriptions.retrieve(subscription_id)
            status = sub.status or "active"
            period_end = sub.current_period_end
        except Exception:
            logger.warning("Could not fetch subscription %s, defaulting to active", subscription_id)

    apply_subscription_status(db, lab, status, subscription_id=subscription_id, current_period_end=period_end)


def _handle_invoice_paid(db: Session, invoice: dict) -> None:
    customer_id = invoice.get("customer")
    if not customer_id:
        return
    lab = _find_lab_by_customer(db, customer_id)
    if not lab:
        return
    subscription_id = invoice.get("subscription")
    if not subscription_id:
        return
    status = "active"
    period_end = None
    if settings.STRIPE_SECRET_KEY:
        try:
            client = get_stripe_client()
            sub = client.subscriptions.retrieve(subscription_id)
            status = sub.status or "active"
            period_end = sub.current_period_end
        except Exception:
            logger.warning("Could not fetch subscription %s in invoice.paid handler", subscription_id)
    apply_subscription_status(db, lab, status, subscription_id=subscription_id, current_period_end=period_end)


def _handle_invoice_payment_failed(db: Session, invoice: dict) -> None:
    customer_id = invoice.get("customer")
    if not customer_id:
        return
    lab = _find_lab_by_customer(db, customer_id)
    if not lab:
        return
    subscription_id = invoice.get("subscription")
    status = "past_due"
    if subscription_id and settings.STRIPE_SECRET_KEY:
        try:
            client = get_stripe_client()
            sub = client.subscriptions.retrieve(subscription_id)
            status = sub.status or "past_due"
        except Exception:
            logger.warning("Could not fetch subscription %s in invoice.payment_failed handler", subscription_id)
    apply_subscription_status(db, lab, status, subscription_id=subscription_id)


def _handle_async_payment_failed(db: Session, session: dict) -> None:
    """F1: Fetch subscription status on async payment failure (e.g. ACH) for faster sync."""
    subscription_id = session.get("subscription")
    customer_id = session.get("customer")
    if not subscription_id or not customer_id:
        logger.warning("Async payment failed for session %s", session.get("id"))
        return
    lab = _find_lab_by_customer(db, customer_id)
    if not lab:
        return
    status = "past_due"
    if settings.STRIPE_SECRET_KEY:
        try:
            client = get_stripe_client()
            sub = client.subscriptions.retrieve(subscription_id)
            status = sub.status or "past_due"
        except Exception:
            logger.warning("Could not fetch subscription %s in async_payment_failed handler", subscription_id)
    apply_subscription_status(db, lab, status, subscription_id=subscription_id)


def _handle_invoice_uncollectible(db: Session, invoice: dict) -> None:
    """F2: Uncollectible = terminal state. Fall back to 'canceled' if Stripe API unreachable."""
    customer_id = invoice.get("customer")
    if not customer_id:
        return
    lab = _find_lab_by_customer(db, customer_id)
    if not lab:
        return
    subscription_id = invoice.get("subscription")
    status = "canceled"
    if subscription_id and settings.STRIPE_SECRET_KEY:
        try:
            client = get_stripe_client()
            sub = client.subscriptions.retrieve(subscription_id)
            status = sub.status or "canceled"
        except Exception:
            logger.warning("Could not fetch subscription %s in invoice.marked_uncollectible handler", subscription_id)
    apply_subscription_status(db, lab, status, subscription_id=subscription_id, cancellation_reason="invoice_uncollectible")


def _handle_invoice_upcoming(db: Session, invoice: dict) -> None:
    """F4: Log upcoming renewal for audit trail."""
    customer_id = invoice.get("customer")
    if not customer_id:
        return
    lab = _find_lab_by_customer(db, customer_id)
    if not lab:
        return
    lab_admin = db.query(User).filter(
        User.lab_id == lab.id,
        User.role.in_([UserRole.LAB_ADMIN, UserRole.SUPER_ADMIN]),
    ).first()
    if lab_admin:
        log_audit(
            db,
            lab_id=lab.id,
            user_id=lab_admin.id,
            action="lab.subscription_renewing",
            entity_type="lab",
            entity_id=lab.id,
            note="Subscription renews in ~3 days",
        )
    logger.info("Subscription renewing soon for lab %s", lab.id)


def _handle_invoice_sent(db: Session, invoice: dict) -> None:
    customer_id = invoice.get("customer")
    if not customer_id:
        return
    lab = _find_lab_by_customer(db, customer_id)
    if not lab:
        return
    if lab.billing_status != BillingStatus.ACTIVE.value:
        lab.billing_status = BillingStatus.INVOICE_PENDING.value
        lab.billing_updated_at = datetime.now(timezone.utc)
        lab.is_active = True
        suspension_cache.pop(str(lab.id), None)


def _fetch_current_subscription(subscription: dict) -> dict:
    """Fetch live subscription status from Stripe to avoid stale retried event data."""
    if not settings.STRIPE_SECRET_KEY:
        return subscription
    try:
        client = get_stripe_client()
        sub = client.subscriptions.retrieve(subscription["id"])
        return {
            "id": sub.id,
            "status": sub.status,
            "customer": sub.customer if isinstance(sub.customer, str) else sub.customer.id,
            "current_period_end": sub.current_period_end,
            "trial_end": sub.trial_end,
            "cancel_at_period_end": sub.cancel_at_period_end,
            "cancellation_details": {
                "reason": getattr(sub.cancellation_details, "reason", None),
            } if sub.cancellation_details else None,
        }
    except Exception:
        logger.warning("Could not fetch subscription %s, using event data", subscription.get("id"))
        return subscription


def _handle_subscription_created(db: Session, subscription: dict) -> None:
    customer_id = subscription.get("customer")
    if not customer_id:
        return
    lab = _find_lab_by_customer(db, customer_id)
    if not lab:
        return
    subscription = _fetch_current_subscription(subscription)
    if lab.billing_status == BillingStatus.INVOICE_PENDING.value and subscription["status"] == "active":
        return
    apply_subscription_status(
        db, lab, subscription["status"], subscription_id=subscription["id"],
        current_period_end=subscription.get("current_period_end"),
        trial_end=subscription.get("trial_end"),
        cancel_at_period_end=subscription.get("cancel_at_period_end", False),
        cancellation_reason=_extract_cancellation_reason(subscription),
    )


def _handle_subscription_updated(db: Session, subscription: dict) -> None:
    customer_id = subscription.get("customer")
    if not customer_id:
        return
    lab = _find_lab_by_customer(db, customer_id)
    if not lab:
        return
    subscription = _fetch_current_subscription(subscription)
    if lab.billing_status == BillingStatus.INVOICE_PENDING.value and subscription["status"] == "active":
        return
    apply_subscription_status(
        db, lab, subscription["status"], subscription_id=subscription["id"],
        current_period_end=subscription.get("current_period_end"),
        trial_end=subscription.get("trial_end"),
        cancel_at_period_end=subscription.get("cancel_at_period_end", False),
        cancellation_reason=_extract_cancellation_reason(subscription),
    )


def _extract_cancellation_reason(subscription: dict) -> str | None:
    details = subscription.get("cancellation_details")
    if not details:
        return None
    raw = details.get("reason")
    reason_map = {"payment_failed": "payment_failed", "cancellation_requested": "customer_requested"}
    return reason_map.get(raw, raw)


def _handle_subscription_deleted(db: Session, subscription: dict) -> None:
    customer_id = subscription.get("customer")
    if not customer_id:
        return
    lab = _find_lab_by_customer(db, customer_id)
    if not lab:
        return
    if lab.stripe_subscription_id != subscription["id"]:
        logger.info("Ignoring deletion of non-current subscription %s for lab %s", subscription["id"], lab.id)
        return
    apply_subscription_status(
        db, lab, "canceled", subscription_id=subscription["id"],
        current_period_end=subscription.get("current_period_end"),
        cancel_at_period_end=False,
        cancellation_reason=_extract_cancellation_reason(subscription),
    )


def _handle_trial_will_end(db: Session, subscription: dict) -> None:
    customer_id = subscription.get("customer")
    if not customer_id:
        return
    lab = _find_lab_by_customer(db, customer_id)
    if not lab:
        return
    lab_admin = db.query(User).filter(
        User.lab_id == lab.id,
        User.role.in_([UserRole.LAB_ADMIN, UserRole.SUPER_ADMIN]),
    ).first()
    if lab_admin:
        log_audit(
            db,
            lab_id=lab.id,
            user_id=lab_admin.id,
            action="lab.trial_ending_soon",
            entity_type="lab",
            entity_id=lab.id,
            note="Stripe: trial ending in ~3 days",
        )
    logger.info("Trial will end soon for lab %s", lab.id)


def _handle_dispute_created(db: Session, dispute: dict) -> None:
    charge_ref = dispute.get("charge")
    amount = dispute.get("amount")
    reason = dispute.get("reason", "unknown")
    customer_id = None

    # M3: Webhook payloads send charge/payment_intent as string IDs, not expanded objects
    if isinstance(charge_ref, str):
        try:
            client = get_stripe_client()
            charge_obj = client.charges.retrieve(charge_ref)
            cust = charge_obj.customer
            customer_id = cust if isinstance(cust, str) else getattr(cust, "id", None)
        except Exception:
            logger.warning("charge.dispute.created: could not fetch charge %s", charge_ref)
    elif isinstance(charge_ref, dict):
        customer_id = charge_ref.get("customer")

    if not customer_id:
        logger.warning("charge.dispute.created: could not determine customer_id")
        return

    lab = _find_lab_by_customer(db, customer_id)
    if not lab:
        logger.warning("charge.dispute.created: no lab for customer %s", customer_id)
        return

    lab_admin = db.query(User).filter(
        User.lab_id == lab.id,
        User.role.in_([UserRole.LAB_ADMIN, UserRole.SUPER_ADMIN]),
    ).first()
    if lab_admin:
        log_audit(
            db,
            lab_id=lab.id,
            user_id=lab_admin.id,
            action="lab.payment_disputed",
            entity_type="lab",
            entity_id=lab.id,
            note=f"Dispute: {reason}, amount: {amount}, charge: {charge_ref}",
        )
    logger.warning("Payment dispute for lab %s: reason=%s amount=%s", lab.id, reason, amount)


def _handle_customer_updated(db: Session, customer: dict) -> None:
    customer_id = customer.get("id")
    if not customer_id:
        return
    lab = _find_lab_by_customer(db, customer_id)
    if not lab:
        return
    email = customer.get("email")
    if email and email != lab.billing_email:
        old_email = lab.billing_email
        lab.billing_email = email
        lab_admin = db.query(User).filter(
            User.lab_id == lab.id,
            User.role.in_([UserRole.LAB_ADMIN, UserRole.SUPER_ADMIN]),
        ).first()
        if lab_admin:
            log_audit(
                db, lab_id=lab.id, user_id=lab_admin.id,
                action="lab.billing_email_updated",
                entity_type="lab", entity_id=lab.id,
                note=f"Stripe: billing email changed from {old_email} to {email}",
            )


@router.delete("/events/cleanup", status_code=200)
def cleanup_stripe_events(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN)),
):
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    count = db.query(StripeEvent).filter(StripeEvent.processed_at < cutoff).delete()
    db.commit()
    return {"deleted": count}
