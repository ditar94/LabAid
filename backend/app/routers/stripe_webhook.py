import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

import stripe
from stripe._error import SignatureVerificationError
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.core.cache import suspension_cache
from app.core.config import settings
from app.core.database import get_db
from app.middleware.auth import require_role
from app.models.models import Lab, StripeEvent, User, UserRole
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
            logger.warning("Async payment failed for session %s", data.get("id"))
        elif event_type == "invoice.paid":
            _handle_invoice_paid(db, data)
        elif event_type == "invoice.payment_failed":
            _handle_invoice_payment_failed(db, data)
        elif event_type in ("invoice.marked_uncollectible", "invoice.overdue"):
            _handle_invoice_payment_failed(db, data)
        elif event_type == "customer.subscription.updated":
            _handle_subscription_updated(db, data)
        elif event_type == "customer.subscription.deleted":
            _handle_subscription_deleted(db, data)
        elif event_type == "customer.subscription.trial_will_end":
            _handle_trial_will_end(db, data)
        elif event_type == "charge.dispute.created":
            _handle_dispute_created(db, data)
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
    if session.get("customer_email"):
        lab.billing_email = session["customer_email"]

    # Fetch actual subscription status instead of hardcoding "active"
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
    apply_subscription_status(db, lab, "active", subscription_id=subscription_id)


def _handle_invoice_payment_failed(db: Session, invoice: dict) -> None:
    customer_id = invoice.get("customer")
    if not customer_id:
        return
    lab = _find_lab_by_customer(db, customer_id)
    if not lab:
        return
    apply_subscription_status(db, lab, "past_due")


def _handle_subscription_updated(db: Session, subscription: dict) -> None:
    customer_id = subscription.get("customer")
    if not customer_id:
        return
    lab = _find_lab_by_customer(db, customer_id)
    if not lab:
        return
    apply_subscription_status(
        db, lab, subscription["status"], subscription_id=subscription["id"],
        current_period_end=subscription.get("current_period_end"),
    )


def _handle_subscription_deleted(db: Session, subscription: dict) -> None:
    customer_id = subscription.get("customer")
    if not customer_id:
        return
    lab = _find_lab_by_customer(db, customer_id)
    if not lab:
        return
    apply_subscription_status(
        db, lab, "canceled", subscription_id=subscription["id"],
        current_period_end=subscription.get("current_period_end"),
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
    charge = dispute.get("charge")
    amount = dispute.get("amount")
    reason = dispute.get("reason", "unknown")
    customer_id = None

    if isinstance(dispute.get("payment_intent"), dict):
        customer_id = dispute["payment_intent"].get("customer")
    elif isinstance(dispute.get("charge"), dict):
        customer_id = dispute["charge"].get("customer")

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
            note=f"Dispute: {reason}, amount: {amount}, charge: {charge}",
        )
    logger.warning("Payment dispute for lab %s: reason=%s amount=%s", lab.id, reason, amount)


@router.delete("/events/cleanup", status_code=200)
def cleanup_stripe_events(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN)),
):
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    count = db.query(StripeEvent).filter(StripeEvent.processed_at < cutoff).delete()
    db.commit()
    return {"deleted": count}
