from datetime import datetime, timedelta, timezone
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.database import get_db
from app.models import models
from app.models.models import BillingStatus
from app.schemas import schemas
from app.middleware.auth import get_current_user, require_role
from app.core.config import settings as app_settings
from app.services.audit import log_audit, snapshot_lab
from app.services.object_storage import object_storage
from app.services.storage import create_temporary_storage

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
    labs = db.query(models.Lab).filter(models.Lab.is_demo.is_(False)).all()
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
    elif body.billing_status in (BillingStatus.ACTIVE.value, BillingStatus.TRIAL.value):
        if not lab.is_active:
            lab.is_active = True

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

    if lab.stripe_subscription_id:
        raise HTTPException(status_code=409, detail="This lab's billing is managed by Stripe.")

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

    from app.services.stripe_service import create_checkout_session
    url = create_checkout_session(db, lab, body.success_url, body.cancel_url)
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
    url = create_portal_session(lab, body.return_url)
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
    return {
        "billing_status": lab.billing_status,
        "trial_ends_at": lab.trial_ends_at,
        "has_subscription": bool(lab.stripe_subscription_id),
        "billing_email": lab.billing_email,
        "plan_name": "LabAid Annual" if lab.stripe_subscription_id else "Free Trial",
    }


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
    get_or_create_customer(db, lab)
    db.commit()
    db.refresh(lab)
    return lab
