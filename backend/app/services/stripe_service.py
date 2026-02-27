import logging
from datetime import datetime, timezone
from uuid import UUID

import stripe
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.models import BillingStatus, Lab, User, UserRole
from app.services.audit import log_audit, snapshot_lab

logger = logging.getLogger("labaid")

_STATUS_MAP = {
    "active": (BillingStatus.ACTIVE.value, True),
    "trialing": (BillingStatus.TRIAL.value, True),
    "past_due": (BillingStatus.PAST_DUE.value, False),
    "canceled": (BillingStatus.CANCELLED.value, False),
    "unpaid": (BillingStatus.CANCELLED.value, False),
}


def get_stripe_client():
    if not settings.STRIPE_SECRET_KEY:
        raise RuntimeError("STRIPE_SECRET_KEY is not configured")
    stripe.api_key = settings.STRIPE_SECRET_KEY
    return stripe


def get_or_create_customer(db: Session, lab: Lab) -> str:
    if lab.stripe_customer_id:
        return lab.stripe_customer_id
    s = get_stripe_client()
    customer = s.Customer.create(
        name=lab.name,
        email=lab.billing_email,
        metadata={"lab_id": str(lab.id)},
    )
    lab.stripe_customer_id = customer.id
    db.flush()
    return customer.id


def create_checkout_session(db: Session, lab: Lab, success_url: str, cancel_url: str) -> str:
    s = get_stripe_client()
    customer_id = get_or_create_customer(db, lab)
    session = s.checkout.Session.create(
        customer=customer_id,
        client_reference_id=str(lab.id),
        mode="subscription",
        line_items=[{"price": settings.STRIPE_PRICE_ID, "quantity": 1}],
        success_url=success_url,
        cancel_url=cancel_url,
    )
    return session.url


def create_portal_session(lab: Lab, return_url: str) -> str:
    if not lab.stripe_customer_id:
        raise ValueError("Lab has no Stripe customer")
    s = get_stripe_client()
    session = s.billing_portal.Session.create(
        customer=lab.stripe_customer_id,
        return_url=return_url,
    )
    return session.url


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
