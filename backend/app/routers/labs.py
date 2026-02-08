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
    labs = db.query(models.Lab).all()
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
    settings = dict(lab.settings or {})
    updates = body.model_dump(exclude_none=True)
    settings.update(updates)
    lab.settings = settings
    flag_modified(lab, "settings")

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

    before = snapshot_lab(lab)
    lab.trial_ends_at = body.trial_ends_at

    log_audit(
        db,
        lab_id=lab.id,
        user_id=current_user.id,
        action="lab.trial_updated",
        entity_type="lab",
        entity_id=lab.id,
        before_state=before,
        after_state=snapshot_lab(lab),
    )

    db.commit()
    db.refresh(lab)
    return lab
