import logging
from datetime import datetime, timedelta, timezone
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.database import get_db
from app.models import models
from app.models.models import BillingStatus
from app.schemas import schemas
from app.middleware.auth import get_current_user, require_role
from app.core.cache import suspension_cache
from app.core.config import settings as app_settings
from app.services.audit import log_audit, snapshot_lab
from app.services.object_storage import object_storage
from app.services.storage import create_temporary_storage

logger = logging.getLogger("labaid")

_PLAN_NAMES = {
    "standard": "LabAid Standard",
    "enterprise": "LabAid Enterprise",
}


def _plan_display_name(lab):
    if not lab.stripe_subscription_id:
        return "Free Trial"
    return _PLAN_NAMES.get(lab.plan_tier, "LabAid Standard")


router = APIRouter(
    prefix="/api/labs",
    tags=["labs"],
    responses={404: {"description": "Not found"}},
)


@router.post("/", response_model=schemas.Lab, status_code=status.HTTP_201_CREATED)
def create_lab(
    lab: schemas.LabCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role != models.UserRole.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions",
        )
    db_lab = models.Lab(name=lab.name)
    db_lab.trial_ends_at = datetime.now(timezone.utc) + timedelta(days=7)
    db.add(db_lab)
    db.flush()

    # Create temporary storage for the new lab
    create_temporary_storage(db, db_lab.id)

    log_audit(
        db,
        lab_id=db_lab.id,
        user_id=current_user.id,
        action="lab.created",
        entity_type="lab",
        entity_id=db_lab.id,
        after_state=snapshot_lab(db_lab),
    )

    db.commit()

    if app_settings.STRIPE_SECRET_KEY and app_settings.STRIPE_PRICE_ID:
        try:
            from app.services.stripe_service import create_trial_subscription
            sub_id = create_trial_subscription(db, db_lab)
            if sub_id:
                db.commit()
        except Exception:
            logger.warning("Failed to create Stripe trial for lab %s", db_lab.id)

    db.refresh(db_lab)
    return db_lab


@router.get("/", response_model=List[schemas.Lab])
def read_labs(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role != models.UserRole.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions",
        )
    labs = db.query(models.Lab).filter(
        models.Lab.is_demo.is_(False),
        models.Lab.deleted_at.is_(None),
    ).all()
    return labs


@router.get("/my-settings")
def get_my_lab_settings(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if not current_user.lab_id:
        raise HTTPException(status_code=400, detail="User has no lab")
    lab = db.query(models.Lab).filter(models.Lab.id == current_user.lab_id).first()
    if not lab:
        raise HTTPException(status_code=404, detail="Lab not found")
    return {
        **(lab.settings or {}),
        "billing_status": lab.billing_status,
        "is_active": lab.is_active,
        "trial_ends_at": lab.trial_ends_at.isoformat() if lab.trial_ends_at else None,
        "is_demo": lab.is_demo,
        "deletion_requested_at": lab.deletion_requested_at.isoformat() if lab.deletion_requested_at else None,
    }


@router.patch("/{lab_id}/settings", response_model=schemas.Lab)
def update_lab_settings(
    lab_id: UUID,
    body: schemas.LabSettingsUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(
        models.UserRole.SUPER_ADMIN, models.UserRole.LAB_ADMIN
    )),
):
    q = db.query(models.Lab).filter(models.Lab.id == lab_id)
    if current_user.role != models.UserRole.SUPER_ADMIN:
        if current_user.lab_id != lab_id:
            raise HTTPException(status_code=403, detail="Not your lab")
    lab = q.first()
    if not lab:
        raise HTTPException(status_code=404, detail="Lab not found")

    before = snapshot_lab(lab)
    was_sso_enabled = (lab.settings or {}).get("sso_enabled", False)
    settings = dict(lab.settings or {})
    updates = body.model_dump(exclude_none=True)
    settings.update(updates)
    lab.settings = settings
    flag_modified(lab, "settings")

    # When SSO is turned off, re-enable password login for the lab
    if was_sso_enabled and not settings.get("sso_enabled", False):
        pw_provider = db.query(models.LabAuthProvider).filter(
            models.LabAuthProvider.lab_id == lab_id,
            models.LabAuthProvider.provider_type == models.AuthProviderType.PASSWORD,
        ).first()
        if pw_provider and not pw_provider.is_enabled:
            pw_provider.is_enabled = True

    log_audit(
        db,
        lab_id=lab.id,
        user_id=current_user.id,
        action="lab.settings_updated",
        entity_type="lab",
        entity_id=lab.id,
        before_state=before,
        after_state=snapshot_lab(lab),
    )

    db.commit()
    db.refresh(lab)
    return lab


@router.patch("/{lab_id}/suspend", response_model=schemas.Lab)
def suspend_lab(
    lab_id: UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(models.UserRole.SUPER_ADMIN)),
):
    lab = db.query(models.Lab).filter(models.Lab.id == lab_id).first()
    if not lab:
        raise HTTPException(status_code=404, detail="Lab not found")

    before = snapshot_lab(lab)
    lab.is_active = not lab.is_active

    log_audit(
        db,
        lab_id=lab.id,
        user_id=current_user.id,
        action="lab.suspended" if not lab.is_active else "lab.reactivated",
        entity_type="lab",
        entity_id=lab.id,
        before_state=before,
        after_state=snapshot_lab(lab),
    )

    # Transition all lab documents to archive (suspend) or restore (reactivate)
    if object_storage.enabled:
        lab_active = "true" if lab.is_active else "false"
        new_class = "hot" if lab.is_active else "archive"
        docs = db.query(models.LotDocument).filter(models.LotDocument.lab_id == lab.id).all()
        for doc in docs:
            if not doc.file_path.startswith("uploads"):
                try:
                    object_storage.update_tags(doc.file_path, {
                        "storage-class": new_class,
                        "lab-active": lab_active,
                    })
                except Exception:
                    pass
            doc.storage_class = new_class

    db.commit()
    db.refresh(lab)
    return lab


@router.patch("/{lab_id}/billing", response_model=schemas.Lab)
def update_billing_status(
    lab_id: UUID,
    body: schemas.BillingStatusUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(models.UserRole.SUPER_ADMIN)),
):
    """
    Update a lab's billing status. Automatically suspends labs that become
    past_due/cancelled, and reactivates labs that become active/trial.
    """
    valid = {s.value for s in BillingStatus}
    if body.billing_status not in valid:
        raise HTTPException(status_code=400, detail=f"Invalid billing_status. Must be one of: {', '.join(valid)}")

    lab = db.query(models.Lab).filter(models.Lab.id == lab_id).first()
    if not lab:
        raise HTTPException(status_code=404, detail="Lab not found")

    if lab.stripe_subscription_id:
        raise HTTPException(status_code=409, detail="This lab's billing is managed by Stripe. Change status in the Stripe Dashboard.")

    before = snapshot_lab(lab)
    old_status = lab.billing_status
    lab.billing_status = body.billing_status
    lab.billing_updated_at = datetime.now(timezone.utc)

    # Auto-suspend when billing lapses; auto-reactivate when restored
    if body.billing_status in (BillingStatus.PAST_DUE.value, BillingStatus.CANCELLED.value):
        if lab.is_active:
            lab.is_active = False
        if body.billing_status == BillingStatus.CANCELLED.value:
            lab.cancellation_reason = "admin_manual"
    elif body.billing_status in (BillingStatus.ACTIVE.value, BillingStatus.TRIAL.value):
        if not lab.is_active:
            lab.is_active = True
        lab.cancellation_reason = None

    log_audit(
        db,
        lab_id=lab.id,
        user_id=current_user.id,
        action="lab.billing_updated",
        entity_type="lab",
        entity_id=lab.id,
        before_state=before,
        after_state=snapshot_lab(lab),
        note=f"Billing status: {old_status} → {body.billing_status}",
    )

    db.commit()
    db.refresh(lab)
    return lab


@router.patch("/{lab_id}/trial", response_model=schemas.Lab)
def update_trial_ends_at(
    lab_id: UUID,
    body: schemas.TrialEndsAtUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(models.UserRole.SUPER_ADMIN)),
):
    lab = db.query(models.Lab).filter(models.Lab.id == lab_id).first()
    if not lab:
        raise HTTPException(status_code=404, detail="Lab not found")

    if lab.stripe_subscription_id and body.trial_ends_at:
        from app.services.stripe_service import extend_trial
        from stripe._error import StripeError
        try:
            extend_trial(db, lab, body.trial_ends_at)
        except StripeError:
            raise HTTPException(status_code=502, detail="Could not update Stripe trial end")

    before = snapshot_lab(lab)
    lab.trial_ends_at = body.trial_ends_at

    old_date = before.get("trial_ends_at") or "none"
    new_date = str(body.trial_ends_at) if body.trial_ends_at else "none"
    log_audit(
        db,
        lab_id=lab.id,
        user_id=current_user.id,
        action="lab.trial_updated",
        entity_type="lab",
        entity_id=lab.id,
        before_state=before,
        after_state=snapshot_lab(lab),
        note=f"Trial end date: {old_date} → {new_date}",
    )

    db.commit()
    db.refresh(lab)
    return lab


# ── Stripe Billing ────────────────────────────────────────────────────────


@router.post("/billing/checkout", response_model=schemas.CheckoutResponse)
def billing_checkout(
    body: schemas.CheckoutRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(
        models.UserRole.SUPER_ADMIN, models.UserRole.LAB_ADMIN
    )),
):
    if not app_settings.STRIPE_SECRET_KEY:
        raise HTTPException(status_code=501, detail="Billing is not configured")
    if not current_user.lab_id:
        raise HTTPException(status_code=400, detail="User has no lab")
    lab = db.query(models.Lab).filter(models.Lab.id == current_user.lab_id).first()
    if not lab:
        raise HTTPException(status_code=404, detail="Lab not found")

    from app.services.stripe_service import create_checkout_session, _resolve_price_id
    from stripe._error import StripeError
    if lab.billing_status in ("active", "past_due"):
        raise HTTPException(status_code=409, detail="Please use the billing portal to manage your existing subscription")
    try:
        price_id = _resolve_price_id(body.plan_tier) if body.plan_tier else None
        # For trial labs, pass old trial sub ID so webhook can cancel it after new sub activates
        old_trial_sub = None
        if lab.stripe_subscription_id and lab.billing_status == "trial":
            old_trial_sub = lab.stripe_subscription_id
        elif lab.stripe_subscription_id:
            # Clear stale subscription ID for cancelled/expired labs resubscribing
            lab.stripe_subscription_id = None
            db.flush()
        url = create_checkout_session(db, lab, body.success_url, body.cancel_url, price_id=price_id, cancel_trial_sub=old_trial_sub)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except StripeError as e:
        logger.error("Stripe error: %s", e)
        raise HTTPException(status_code=502, detail=str(getattr(e, "user_message", None) or "Payment service temporarily unavailable"))
    db.commit()
    return {"url": url}


@router.post("/billing/portal", response_model=schemas.PortalResponse)
def billing_portal(
    body: schemas.PortalRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(
        models.UserRole.SUPER_ADMIN, models.UserRole.LAB_ADMIN
    )),
):
    if not app_settings.STRIPE_SECRET_KEY:
        raise HTTPException(status_code=501, detail="Billing is not configured")
    if not current_user.lab_id:
        raise HTTPException(status_code=400, detail="User has no lab")
    lab = db.query(models.Lab).filter(models.Lab.id == current_user.lab_id).first()
    if not lab:
        raise HTTPException(status_code=404, detail="Lab not found")
    if not lab.stripe_customer_id:
        raise HTTPException(status_code=400, detail="No billing account found. Please subscribe first.")

    from app.services.stripe_service import create_portal_session
    from stripe._error import StripeError
    try:
        url = create_portal_session(lab, body.return_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except StripeError as e:
        logger.error("Stripe error: %s", e)
        raise HTTPException(status_code=502, detail=str(getattr(e, "user_message", None) or "Payment service temporarily unavailable"))
    return {"url": url}


@router.get("/billing/status", response_model=schemas.BillingStatusResponse)
def billing_status(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if not current_user.lab_id:
        raise HTTPException(status_code=400, detail="User has no lab")
    lab = db.query(models.Lab).filter(models.Lab.id == current_user.lab_id).first()
    if not lab:
        raise HTTPException(status_code=404, detail="Lab not found")
    result = {
        "billing_status": lab.billing_status,
        "trial_ends_at": lab.trial_ends_at,
        "has_subscription": bool(lab.stripe_subscription_id),
        "billing_email": lab.billing_email,
        "plan_name": _plan_display_name(lab),
        "plan_tier": lab.plan_tier or "standard",
    }
    if lab.stripe_subscription_id and app_settings.STRIPE_SECRET_KEY:
        from app.services.stripe_service import get_subscription_details, sync_subscription_status
        details = get_subscription_details(lab)
        if details:
            if sync_subscription_status(db, lab, details):
                db.commit()
                result["billing_status"] = lab.billing_status
                result["has_subscription"] = bool(lab.stripe_subscription_id)
            result["current_period_start"] = details["current_period_start"]
            result["current_period_end"] = details["current_period_end"]
            result["subscribed_at"] = details["created"]
            result["collection_method"] = details["collection_method"]
            result["cancel_at_period_end"] = details.get("cancel_at_period_end", False)
            result["latest_invoice_status"] = details.get("latest_invoice_status")
            if details.get("plan_tier"):
                result["plan_tier"] = details["plan_tier"]
                result["plan_name"] = _PLAN_NAMES.get(details["plan_tier"], result["plan_name"])
    elif lab.stripe_subscription_id and not app_settings.STRIPE_SECRET_KEY:
        # Fallback when Stripe isn't configured (local dev)
        if lab.current_period_end:
            result["current_period_end"] = int(lab.current_period_end.timestamp())
        if lab.billing_updated_at:
            result["subscribed_at"] = int(lab.billing_updated_at.timestamp())
        result["cancel_at_period_end"] = lab.cancel_at_period_end
    result["cancellation_reason"] = lab.cancellation_reason
    return result


@router.get("/billing/customer-info", response_model=schemas.CustomerBillingInfo)
def billing_customer_info(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(
        models.UserRole.SUPER_ADMIN, models.UserRole.LAB_ADMIN
    )),
):
    if not app_settings.STRIPE_SECRET_KEY:
        raise HTTPException(status_code=501, detail="Billing is not configured")
    if not current_user.lab_id:
        raise HTTPException(status_code=400, detail="User has no lab")
    lab = db.query(models.Lab).filter(models.Lab.id == current_user.lab_id).first()
    if not lab or not lab.stripe_customer_id:
        return schemas.CustomerBillingInfo()

    from app.services.stripe_service import get_stripe_client
    from stripe._error import StripeError
    try:
        customer = get_stripe_client().customers.retrieve(lab.stripe_customer_id)
    except StripeError:
        return schemas.CustomerBillingInfo(billing_email=lab.billing_email)

    addr = customer.address or {}
    return schemas.CustomerBillingInfo(
        billing_email=customer.email or lab.billing_email,
        business_name=customer.name,
        phone=customer.phone,
        address_line1=addr.get("line1"),
        address_line2=addr.get("line2"),
        city=addr.get("city"),
        state=addr.get("state"),
        postal_code=addr.get("postal_code"),
        country=addr.get("country"),
    )


@router.post("/{lab_id}/stripe-customer", response_model=schemas.Lab)
def create_stripe_customer(
    lab_id: UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(models.UserRole.SUPER_ADMIN)),
):
    if not app_settings.STRIPE_SECRET_KEY:
        raise HTTPException(status_code=501, detail="Stripe is not configured")
    lab = db.query(models.Lab).filter(models.Lab.id == lab_id).first()
    if not lab:
        raise HTTPException(status_code=404, detail="Lab not found")
    if lab.stripe_customer_id:
        raise HTTPException(status_code=409, detail="Lab already has a Stripe customer")

    from app.services.stripe_service import get_or_create_customer
    from stripe._error import StripeError
    try:
        get_or_create_customer(db, lab)
    except StripeError as e:
        logger.error("Stripe error: %s", e)
        raise HTTPException(status_code=502, detail=str(getattr(e, "user_message", None) or "Payment service temporarily unavailable"))
    db.commit()
    db.refresh(lab)
    return lab


@router.post("/billing/invoice", response_model=schemas.InvoiceSubscriptionResponse)
def billing_invoice(
    body: schemas.InvoiceSubscriptionRequest = schemas.InvoiceSubscriptionRequest(),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(
        models.UserRole.SUPER_ADMIN, models.UserRole.LAB_ADMIN
    )),
):
    if not app_settings.STRIPE_SECRET_KEY:
        raise HTTPException(status_code=501, detail="Billing is not configured")
    if not current_user.lab_id:
        raise HTTPException(status_code=400, detail="User has no lab")
    lab = db.query(models.Lab).filter(models.Lab.id == current_user.lab_id).first()
    if not lab:
        raise HTTPException(status_code=404, detail="Lab not found")
    if body.billing_email:
        lab.billing_email = body.billing_email
        db.flush()

    if not lab.billing_email:
        raise HTTPException(status_code=400, detail="Billing email is required for invoice subscriptions")

    if lab.stripe_subscription_id and lab.billing_status not in ("trial", "cancelled"):
        raise HTTPException(status_code=409, detail="Lab already has an active subscription")

    if lab.cancellation_reason == "invoice_uncollectible":
        raise HTTPException(status_code=409, detail="Invoice billing is unavailable because a previous invoice was not paid. Please use card payment.")

    from app.services.stripe_service import create_invoice_subscription, convert_trial_to_invoice, get_stripe_client, _get_item_period, _resolve_price_id
    from app.core.cache import suspension_cache
    from stripe._error import StripeError
    try:
        price_id = _resolve_price_id(body.plan_tier) if body.plan_tier else None
        if lab.stripe_customer_id:
            customer_params: dict = {}
            if body.billing_email:
                customer_params["email"] = body.billing_email
            if body.business_name:
                customer_params["business_name"] = body.business_name
            if body.phone:
                customer_params["phone"] = body.phone
            address: dict = {}
            if body.address_line1:
                address["line1"] = body.address_line1
            if body.address_line2:
                address["line2"] = body.address_line2
            if body.city:
                address["city"] = body.city
            if body.state:
                address["state"] = body.state
            if body.postal_code:
                address["postal_code"] = body.postal_code
            if body.country:
                address["country"] = body.country
            if address:
                customer_params["address"] = address
            if customer_params:
                get_stripe_client().customers.update(
                    lab.stripe_customer_id, params=customer_params,
                )
        if lab.stripe_subscription_id and lab.billing_status == "trial":
            subscription_id = convert_trial_to_invoice(db, lab)
        else:
            subscription_id = create_invoice_subscription(db, lab, price_id=price_id)

        client = get_stripe_client()
        sub = client.subscriptions.retrieve(subscription_id)

        before = snapshot_lab(lab)
        lab.stripe_subscription_id = subscription_id
        lab.billing_status = BillingStatus.INVOICE_PENDING.value
        lab.billing_updated_at = datetime.now(timezone.utc)
        lab.is_active = True
        lab.trial_ends_at = None
        lab.cancellation_reason = None
        if body.plan_tier:
            lab.plan_tier = body.plan_tier
        _, period_end = _get_item_period(sub)
        if period_end:
            lab.current_period_end = datetime.fromtimestamp(period_end, tz=timezone.utc)
        if sub.cancel_at_period_end is not None:
            lab.cancel_at_period_end = sub.cancel_at_period_end
        log_audit(
            db, lab_id=lab.id, user_id=current_user.id,
            action="lab.billing_updated", entity_type="lab", entity_id=lab.id,
            before_state=before, after_state=snapshot_lab(lab),
            note=f"Invoice subscription created: {before.get('billing_status', 'unknown')} → invoice_pending",
        )
        suspension_cache.pop(str(lab.id), None)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except StripeError as e:
        logger.error("Stripe error: %s", e)
        raise HTTPException(status_code=502, detail=str(getattr(e, "user_message", None) or "Payment service temporarily unavailable"))
    db.commit()
    return {"subscription_id": subscription_id, "message": "Invoice subscription created. An invoice will be sent to your billing email."}


@router.patch("/billing/payment-method")
def switch_payment_method(
    body: schemas.SwitchPaymentMethodRequest = schemas.SwitchPaymentMethodRequest(),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(
        models.UserRole.SUPER_ADMIN, models.UserRole.LAB_ADMIN
    )),
):
    if not app_settings.STRIPE_SECRET_KEY:
        raise HTTPException(status_code=501, detail="Billing is not configured")
    if not current_user.lab_id:
        raise HTTPException(status_code=400, detail="User has no lab")
    lab = db.query(models.Lab).filter(models.Lab.id == current_user.lab_id).first()
    if not lab:
        raise HTTPException(status_code=404, detail="Lab not found")
    if lab.billing_status not in (BillingStatus.ACTIVE.value, BillingStatus.INVOICE_PENDING.value):
        raise HTTPException(status_code=409, detail="Can only switch payment method on active subscriptions")
    if not lab.stripe_subscription_id:
        raise HTTPException(status_code=400, detail="No active subscription found")
    if lab.cancellation_reason == "invoice_uncollectible":
        raise HTTPException(status_code=409, detail="Invoice billing is unavailable because a previous invoice was not paid. Please use card payment.")

    from app.services.stripe_service import get_subscription_details, switch_to_invoice, get_stripe_client
    from app.core.cache import suspension_cache
    from stripe._error import StripeError

    details = get_subscription_details(lab)
    if details and details.get("collection_method") == "send_invoice":
        raise HTTPException(status_code=409, detail="Already on invoice billing")

    if body.billing_email:
        lab.billing_email = body.billing_email
        db.flush()
    if not lab.billing_email:
        raise HTTPException(status_code=400, detail="Billing email is required for invoice billing")

    try:
        if body.billing_email and lab.stripe_customer_id:
            get_stripe_client().customers.update(
                lab.stripe_customer_id, params={"email": body.billing_email},
            )
        switch_to_invoice(lab)
        before = snapshot_lab(lab)
        log_audit(
            db, lab_id=lab.id, user_id=current_user.id,
            action="lab.billing_updated", entity_type="lab", entity_id=lab.id,
            before_state=before, after_state=snapshot_lab(lab),
            note="Switched payment method: card → invoice",
        )
        suspension_cache.pop(str(lab.id), None)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except StripeError as e:
        logger.error("Stripe error: %s", e)
        raise HTTPException(status_code=502, detail=str(getattr(e, "user_message", None) or "Payment service temporarily unavailable"))
    db.commit()
    return {"status": "ok", "message": "Switched to invoice billing. Future charges will be invoiced."}


@router.post("/billing/upgrade/preview", response_model=schemas.UpgradePreviewResponse)
def upgrade_preview(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(
        models.UserRole.SUPER_ADMIN, models.UserRole.LAB_ADMIN
    )),
):
    if not app_settings.STRIPE_SECRET_KEY or not app_settings.STRIPE_ENTERPRISE_PRICE_ID:
        raise HTTPException(status_code=501, detail="Enterprise billing is not configured")
    if not current_user.lab_id:
        raise HTTPException(status_code=400, detail="User has no lab")
    lab = db.query(models.Lab).filter(models.Lab.id == current_user.lab_id).first()
    if not lab:
        raise HTTPException(status_code=404, detail="Lab not found")
    if lab.billing_status not in (BillingStatus.ACTIVE.value, BillingStatus.INVOICE_PENDING.value):
        raise HTTPException(status_code=409, detail="Upgrade is only available for active subscriptions")
    if lab.plan_tier == "enterprise":
        raise HTTPException(status_code=409, detail="Already on Enterprise plan")
    if lab.cancel_at_period_end:
        raise HTTPException(status_code=409, detail="Reactivate your subscription before upgrading")
    if not lab.stripe_subscription_id:
        raise HTTPException(status_code=400, detail="No active subscription found")

    from app.services.stripe_service import preview_upgrade
    from stripe._error import StripeError
    try:
        return preview_upgrade(lab)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except StripeError as e:
        logger.error("Stripe error: %s", e)
        raise HTTPException(status_code=502, detail=str(getattr(e, "user_message", None) or "Payment service temporarily unavailable"))


@router.post("/billing/upgrade/confirm", response_model=schemas.UpgradeConfirmResponse)
def upgrade_confirm(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(
        models.UserRole.SUPER_ADMIN, models.UserRole.LAB_ADMIN
    )),
):
    if not app_settings.STRIPE_SECRET_KEY or not app_settings.STRIPE_ENTERPRISE_PRICE_ID:
        raise HTTPException(status_code=501, detail="Enterprise billing is not configured")
    if not current_user.lab_id:
        raise HTTPException(status_code=400, detail="User has no lab")
    lab = db.query(models.Lab).filter(models.Lab.id == current_user.lab_id).first()
    if not lab:
        raise HTTPException(status_code=404, detail="Lab not found")
    if lab.billing_status not in (BillingStatus.ACTIVE.value, BillingStatus.INVOICE_PENDING.value):
        raise HTTPException(status_code=409, detail="Upgrade is only available for active subscriptions")
    if lab.plan_tier == "enterprise":
        raise HTTPException(status_code=409, detail="Already on Enterprise plan")
    if lab.cancel_at_period_end:
        raise HTTPException(status_code=409, detail="Reactivate your subscription before upgrading")
    if not lab.stripe_subscription_id:
        raise HTTPException(status_code=400, detail="No active subscription found")

    from app.services.stripe_service import upgrade_plan
    from stripe._error import StripeError
    try:
        upgrade_plan(db, lab, current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except StripeError as e:
        logger.error("Stripe error: %s", e)
        raise HTTPException(status_code=502, detail=str(getattr(e, "user_message", None) or "Payment service temporarily unavailable"))
    db.commit()
    return {"status": "ok", "message": "Upgrade to Enterprise initiated. Your plan will update shortly."}


@router.post("/{lab_id}/upgrade", response_model=schemas.UpgradeConfirmResponse)
def admin_upgrade_lab(
    lab_id: UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(models.UserRole.SUPER_ADMIN)),
):
    if not app_settings.STRIPE_SECRET_KEY or not app_settings.STRIPE_ENTERPRISE_PRICE_ID:
        raise HTTPException(status_code=501, detail="Enterprise billing is not configured")
    lab = db.query(models.Lab).filter(models.Lab.id == lab_id).first()
    if not lab:
        raise HTTPException(status_code=404, detail="Lab not found")

    from app.services.stripe_service import upgrade_plan
    from stripe._error import StripeError
    try:
        upgrade_plan(db, lab, current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except StripeError as e:
        logger.error("Stripe error: %s", e)
        raise HTTPException(status_code=502, detail=str(getattr(e, "user_message", None) or "Payment service temporarily unavailable"))
    db.commit()
    return {"status": "ok", "message": f"Enterprise upgrade initiated for {lab.name}."}


@router.post("/{lab_id}/admin-subscribe")
def admin_subscribe_lab(
    lab_id: UUID,
    body: schemas.AdminSubscribeRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(models.UserRole.SUPER_ADMIN)),
):
    if not app_settings.STRIPE_SECRET_KEY:
        raise HTTPException(status_code=501, detail="Billing is not configured")
    lab = db.query(models.Lab).filter(models.Lab.id == lab_id).first()
    if not lab:
        raise HTTPException(status_code=404, detail="Lab not found")
    if lab.billing_status != BillingStatus.CANCELLED.value:
        raise HTTPException(status_code=409, detail="Lab is not cancelled")

    from app.services.stripe_service import create_invoice_subscription, get_stripe_client, _resolve_price_id, _get_item_period
    from app.core.cache import suspension_cache
    from stripe._error import StripeError
    try:
        price_id = _resolve_price_id(body.plan_tier)
        before = snapshot_lab(lab)
        lab.cancellation_reason = None
        if lab.stripe_subscription_id:
            lab.stripe_subscription_id = None
            db.flush()
        subscription_id = create_invoice_subscription(db, lab, price_id=price_id)
        client = get_stripe_client()
        sub = client.subscriptions.retrieve(subscription_id)
        lab.stripe_subscription_id = subscription_id
        lab.billing_status = BillingStatus.INVOICE_PENDING.value
        lab.billing_updated_at = datetime.now(timezone.utc)
        lab.is_active = True
        lab.plan_tier = body.plan_tier
        _, period_end = _get_item_period(sub)
        if period_end:
            lab.current_period_end = datetime.fromtimestamp(period_end, tz=timezone.utc)
        log_audit(
            db, lab_id=lab.id, user_id=current_user.id,
            action="lab.admin_subscribed", entity_type="lab", entity_id=lab.id,
            before_state=before, after_state=snapshot_lab(lab),
            note=f"Admin created {body.plan_tier} invoice subscription for cancelled lab",
        )
        suspension_cache.pop(str(lab.id), None)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except StripeError as e:
        logger.error("Stripe error: %s", e)
        raise HTTPException(status_code=502, detail=str(getattr(e, "user_message", None) or "Payment service temporarily unavailable"))
    db.commit()
    tier_label = "Enterprise" if body.plan_tier == "enterprise" else "Standard"
    return {"status": "ok", "message": f"{tier_label} invoice subscription created for {lab.name}.", "subscription_id": subscription_id}


@router.post("/{lab_id}/clear-invoice-block", response_model=schemas.Lab)
def clear_invoice_block(
    lab_id: UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(models.UserRole.SUPER_ADMIN)),
):
    lab = db.query(models.Lab).filter(models.Lab.id == lab_id).first()
    if not lab:
        raise HTTPException(status_code=404, detail="Lab not found")
    if lab.cancellation_reason != "invoice_uncollectible":
        raise HTTPException(status_code=400, detail="Lab does not have an invoice block")

    before = snapshot_lab(lab)
    lab.cancellation_reason = None
    log_audit(
        db,
        lab_id=lab.id,
        user_id=current_user.id,
        action="lab.invoice_block_cleared",
        entity_type="lab",
        entity_id=lab.id,
        before_state=before,
        after_state=snapshot_lab(lab),
        note="Admin cleared invoice_uncollectible block — invoice billing re-enabled",
    )
    db.commit()
    db.refresh(lab)
    return lab


@router.get("/{lab_id}/subscription", response_model=schemas.SubscriptionDetails | None)
def get_lab_subscription(
    lab_id: UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(models.UserRole.SUPER_ADMIN)),
):
    if not app_settings.STRIPE_SECRET_KEY:
        raise HTTPException(status_code=501, detail="Stripe is not configured")
    lab = db.query(models.Lab).filter(models.Lab.id == lab_id).first()
    if not lab:
        raise HTTPException(status_code=404, detail="Lab not found")

    from app.services.stripe_service import get_subscription_details, sync_subscription_status
    details = get_subscription_details(lab)
    if details and sync_subscription_status(db, lab, details):
        db.commit()
    return details


# ── Lab Deletion ─────────────────────────────────────────────────────────


def _soft_delete_lab(db: Session, lab: models.Lab) -> None:
    """Soft-delete a lab: hard-delete business data, deactivate users, retain audit logs."""
    lab_id = str(lab.id)
    p = {"id": lab_id}

    # 1-2. Remove FK references before deleting storage
    db.execute(text("UPDATE vials SET location_cell_id = NULL WHERE lab_id = :id"), p)
    db.execute(text("UPDATE cocktail_lots SET location_cell_id = NULL WHERE lab_id = :id"), p)

    # 3-4. Tickets
    db.execute(text(
        "DELETE FROM ticket_replies WHERE ticket_id IN "
        "(SELECT id FROM support_tickets WHERE lab_id = :id)"
    ), p)
    db.execute(text("DELETE FROM support_tickets WHERE lab_id = :id"), p)

    # 5. Lot requests
    db.execute(text("DELETE FROM lot_requests WHERE lab_id = :id"), p)

    # 6-7. Lot documents (delete blobs first)
    lot_docs = db.query(models.LotDocument).filter(models.LotDocument.lab_id == lab.id).all()
    if object_storage.enabled:
        for doc in lot_docs:
            try:
                object_storage.delete(doc.file_path)
            except Exception:
                logger.warning("Failed to delete blob: %s", doc.file_path)
    db.execute(text("DELETE FROM lot_documents WHERE lab_id = :id"), p)

    # 8-9. Cocktail lot documents (delete blobs first)
    cocktail_docs = db.query(models.CocktailLotDocument).filter(
        models.CocktailLotDocument.lab_id == lab.id
    ).all()
    if object_storage.enabled:
        for doc in cocktail_docs:
            try:
                object_storage.delete(doc.file_path)
            except Exception:
                logger.warning("Failed to delete blob: %s", doc.file_path)
    db.execute(text("DELETE FROM cocktail_lot_documents WHERE lab_id = :id"), p)

    # 10-13. Cocktails
    db.execute(text(
        "DELETE FROM cocktail_lot_sources WHERE cocktail_lot_id IN "
        "(SELECT id FROM cocktail_lots WHERE lab_id = :id)"
    ), p)
    db.execute(text("DELETE FROM cocktail_lots WHERE lab_id = :id"), p)
    db.execute(text(
        "DELETE FROM cocktail_recipe_components WHERE recipe_id IN "
        "(SELECT id FROM cocktail_recipes WHERE lab_id = :id)"
    ), p)
    db.execute(text("DELETE FROM cocktail_recipes WHERE lab_id = :id"), p)

    # 14-15. Vials and lots
    db.execute(text("DELETE FROM vials WHERE lab_id = :id"), p)
    db.execute(text("DELETE FROM lots WHERE lab_id = :id"), p)

    # 16-18. Antibodies, reagent components, fluorochromes
    db.execute(text(
        "DELETE FROM reagent_components WHERE antibody_id IN "
        "(SELECT id FROM antibodies WHERE lab_id = :id)"
    ), p)
    db.execute(text("DELETE FROM antibodies WHERE lab_id = :id"), p)
    db.execute(text("DELETE FROM fluorochromes WHERE lab_id = :id"), p)

    # 19-20. Storage
    db.execute(text(
        "DELETE FROM storage_cells WHERE storage_unit_id IN "
        "(SELECT id FROM storage_units WHERE lab_id = :id)"
    ), p)
    db.execute(text("DELETE FROM storage_units WHERE lab_id = :id"), p)

    # 21. Audit logs — RETAINED for compliance (not deleted)

    # 22. External identities (via users)
    db.execute(text(
        "DELETE FROM external_identities WHERE user_id IN "
        "(SELECT id FROM users WHERE lab_id = :id)"
    ), p)

    # 23. Auth providers
    db.execute(text("DELETE FROM lab_auth_providers WHERE lab_id = :id"), p)

    # 24. Deactivate users (keep rows for audit log FK integrity)
    db.execute(text(
        "UPDATE users SET is_active = FALSE, hashed_password = '!deleted', "
        "invite_token = NULL, invite_token_expires_at = NULL "
        "WHERE lab_id = :id"
    ), p)

    # 25. Nullify shared references
    db.execute(text("UPDATE demo_leads SET demo_lab_id = NULL WHERE demo_lab_id = :id"), p)
    db.execute(text(
        "UPDATE vendor_catalog SET created_by_lab_id = NULL WHERE created_by_lab_id = :id"
    ), p)

    # 26. Soft-delete the lab row
    db.execute(text(
        "UPDATE labs SET deleted_at = now(), is_active = FALSE WHERE id = :id"
    ), p)

    # 27. Clear cache
    suspension_cache.pop(lab_id, None)

    db.flush()


def _cancel_stripe(lab, lab_id):
    """Cancel Stripe subscription and delete customer. Best-effort."""
    if not (lab.stripe_subscription_id or lab.stripe_customer_id):
        return
    try:
        from app.services.stripe_service import get_stripe_client
        client = get_stripe_client()
        if lab.stripe_subscription_id:
            try:
                client.subscriptions.cancel(lab.stripe_subscription_id)
            except Exception:
                logger.warning("Could not cancel subscription %s", lab.stripe_subscription_id)
        if lab.stripe_customer_id:
            try:
                client.customers.delete(lab.stripe_customer_id)
            except Exception:
                logger.warning("Could not delete Stripe customer %s", lab.stripe_customer_id)
    except RuntimeError:
        logger.warning("Stripe not configured, skipping Stripe cleanup for lab %s", lab_id)


def _send_post_deletion_emails(admin_emails: list[str], lab_name: str):
    """Send post-deletion confirmation emails. Best-effort."""
    from datetime import date
    from app.services.email import send_deletion_confirmation_email
    deleted_date = date.today().strftime("%B %d, %Y")
    for email in admin_emails:
        try:
            send_deletion_confirmation_email(email, lab_name, deleted_date)
        except Exception:
            logger.warning("Failed to send deletion confirmation to %s", email)


def _collect_admin_emails(db: Session, lab_id) -> list[str]:
    return [
        u.email for u in db.query(models.User).filter(
            models.User.lab_id == lab_id,
            models.User.role == models.UserRole.LAB_ADMIN,
            models.User.is_active == True,
        ).all()
    ]


@router.post("/{lab_id}/request-deletion")
def request_deletion(
    lab_id: UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(models.UserRole.SUPER_ADMIN)),
):
    lab = db.query(models.Lab).filter(models.Lab.id == lab_id).first()
    if not lab:
        raise HTTPException(status_code=404, detail="Lab not found")
    if lab.is_demo:
        raise HTTPException(status_code=400, detail="Cannot delete demo labs")
    if lab.deleted_at:
        raise HTTPException(status_code=400, detail="Lab is already deleted")
    if lab.billing_status != BillingStatus.CANCELLED.value:
        raise HTTPException(
            status_code=400,
            detail="Only cancelled labs can be deleted. Cancel the subscription first.",
        )

    before = snapshot_lab(lab)
    lab.deletion_requested_at = datetime.now(timezone.utc)
    after = snapshot_lab(lab)

    log_audit(
        db, lab_id=lab.id, user_id=current_user.id,
        action="lab.deletion_requested", entity_type="lab", entity_id=lab.id,
        before_state=before, after_state=after,
    )
    db.commit()

    admin_emails = _collect_admin_emails(db, lab.id)
    from app.services.email import send_deletion_request_email
    for email in admin_emails:
        try:
            send_deletion_request_email(email, lab.name)
        except Exception:
            logger.warning("Failed to send deletion request email to %s", email)

    logger.info("Deletion requested for lab %s (%s) by user %s", lab.name, lab_id, current_user.id)
    return {"detail": "Deletion request sent to lab administrators for confirmation"}


@router.post("/confirm-deletion")
def confirm_deletion(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(
        models.UserRole.LAB_ADMIN,
    )),
):
    if not current_user.lab_id:
        raise HTTPException(status_code=400, detail="User has no lab")
    lab = db.query(models.Lab).filter(models.Lab.id == current_user.lab_id).first()
    if not lab:
        raise HTTPException(status_code=404, detail="Lab not found")
    if lab.deleted_at:
        raise HTTPException(status_code=400, detail="Lab is already deleted")
    if not lab.deletion_requested_at:
        raise HTTPException(status_code=400, detail="No pending deletion request for this lab")

    lab_name = lab.name
    admin_emails = _collect_admin_emails(db, lab.id)

    log_audit(
        db, lab_id=lab.id, user_id=current_user.id,
        action="lab.deleted", entity_type="lab", entity_id=lab.id,
        before_state=snapshot_lab(lab),
        after_state={"deleted": True, "confirmed_by": str(current_user.id)},
    )

    _cancel_stripe(lab, lab.id)
    _soft_delete_lab(db, lab)
    db.commit()

    _send_post_deletion_emails(admin_emails, lab_name)
    logger.info("Lab deleted (confirmed): %s (%s) by user %s", lab_name, lab.id, current_user.id)
    return {"detail": f"Lab '{lab_name}' data has been deleted."}


@router.delete("/{lab_id}")
def force_delete_lab(
    lab_id: UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(models.UserRole.SUPER_ADMIN)),
):
    lab = db.query(models.Lab).filter(models.Lab.id == lab_id).first()
    if not lab:
        raise HTTPException(status_code=404, detail="Lab not found")
    if lab.is_demo:
        raise HTTPException(status_code=400, detail="Cannot delete demo labs")
    if lab.deleted_at:
        raise HTTPException(status_code=400, detail="Lab is already deleted")
    if lab.billing_status != BillingStatus.CANCELLED.value:
        raise HTTPException(
            status_code=400,
            detail="Only cancelled labs can be deleted. Cancel the subscription first.",
        )

    lab_name = lab.name
    admin_emails = _collect_admin_emails(db, lab.id)

    log_audit(
        db, lab_id=lab.id, user_id=current_user.id,
        action="lab.force_deleted", entity_type="lab", entity_id=lab.id,
        before_state=snapshot_lab(lab),
        after_state={"deleted": True, "force_deleted_by": str(current_user.id)},
    )

    _cancel_stripe(lab, lab_id)
    _soft_delete_lab(db, lab)
    db.commit()

    _send_post_deletion_emails(admin_emails, lab_name)
    logger.info("Lab force-deleted: %s (%s) by user %s", lab_name, lab_id, current_user.id)
    return {"detail": f"Lab '{lab_name}' data has been deleted."}
