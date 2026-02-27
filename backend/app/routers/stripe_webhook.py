import logging
from uuid import UUID

from stripe._error import SignatureVerificationError
from fastapi import APIRouter, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.models.models import Lab, StripeEvent
from app.services.stripe_service import apply_subscription_status, get_stripe_client

logger = logging.getLogger("labaid")

router = APIRouter(prefix="/api/stripe", tags=["stripe"])


@router.post("/webhook", status_code=200)
async def stripe_webhook(request: Request):
    if not settings.STRIPE_WEBHOOK_SECRET:
        raise HTTPException(status_code=500, detail="Stripe webhook not configured")

    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")
    if not sig_header:
        raise HTTPException(status_code=400, detail="Missing stripe-signature header")

    s = get_stripe_client()
    try:
        event = s.Webhook.construct_event(payload, sig_header, settings.STRIPE_WEBHOOK_SECRET)
    except SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid signature")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid payload")

    db = SessionLocal()
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
        else:
            logger.info("Unhandled Stripe event: %s", event_type)

        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Error processing Stripe webhook: %s", event["type"])
        raise
    finally:
        db.close()

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

    apply_subscription_status(db, lab, "active", subscription_id=subscription_id)


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
        db, lab, subscription["status"], subscription_id=subscription["id"]
    )


def _handle_subscription_deleted(db: Session, subscription: dict) -> None:
    customer_id = subscription.get("customer")
    if not customer_id:
        return
    lab = _find_lab_by_customer(db, customer_id)
    if not lab:
        return
    apply_subscription_status(db, lab, "canceled", subscription_id=subscription["id"])
