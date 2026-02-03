from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.middleware.auth import get_current_user, require_role
from app.models.models import User, UserRole, Vial, VialStatus
from app.schemas.schemas import (
    ReturnToStorageRequest,
    VialCorrectionRequest,
    VialIntakeRequest,
    VialOpenRequest,
    VialOut,
)
from app.services.vial_service import (
    correct_vial,
    deplete_vial,
    open_vial,
    receive_vials,
    return_to_storage,
)

router = APIRouter(prefix="/api/vials", tags=["vials"])


@router.get("/", response_model=list[VialOut])
def list_vials(
    lot_id: UUID | None = None,
    status: VialStatus | None = None,
    storage_unit_id: UUID | None = None,
    lab_id: UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Vial)
    if current_user.role == UserRole.SUPER_ADMIN and lab_id:
        q = q.filter(Vial.lab_id == lab_id)
    else:
        q = q.filter(Vial.lab_id == current_user.lab_id)

    if lot_id:
        q = q.filter(Vial.lot_id == lot_id)
    if status:
        q = q.filter(Vial.status == status)
    if storage_unit_id:
        from app.models.models import StorageCell

        cell_ids = (
            db.query(StorageCell.id)
            .filter(StorageCell.storage_unit_id == storage_unit_id)
            .subquery()
        )
        q = q.filter(Vial.location_cell_id.in_(cell_ids))
    return q.order_by(Vial.received_at.desc()).all()


@router.post("/receive", response_model=list[VialOut])
def intake_vials(
    body: VialIntakeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    if body.quantity < 1 or body.quantity > 100:
        raise HTTPException(status_code=400, detail="Quantity must be between 1 and 100")
    return receive_vials(
        db,
        lot_id=body.lot_id,
        quantity=body.quantity,
        storage_unit_id=body.storage_unit_id,
        user=current_user,
    )


@router.post("/{vial_id}/open", response_model=VialOut)
def open_vial_endpoint(
    vial_id: UUID,
    body: VialOpenRequest,
    force: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR, UserRole.TECH)),
):
    return open_vial(db, vial_id=vial_id, cell_id=body.cell_id, user=current_user, force=force)


@router.post("/{vial_id}/deplete", response_model=VialOut)
def deplete_vial_endpoint(
    vial_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR, UserRole.TECH)),
):
    return deplete_vial(db, vial_id=vial_id, user=current_user)


@router.post("/{vial_id}/return-to-storage", response_model=VialOut)
def return_to_storage_endpoint(
    vial_id: UUID,
    body: ReturnToStorageRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR, UserRole.TECH)),
):
    return return_to_storage(db, vial_id=vial_id, cell_id=body.cell_id, user=current_user)


@router.post("/{vial_id}/correct/revert-open", response_model=VialOut)
def revert_open(
    vial_id: UUID,
    body: VialCorrectionRequest,
    restore_cell_id: UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN)),
):
    return correct_vial(
        db,
        vial_id=vial_id,
        note=body.note,
        user=current_user,
        revert_to=VialStatus.SEALED,
        restore_cell_id=restore_cell_id,
    )


@router.post("/{vial_id}/correct/revert-deplete", response_model=VialOut)
def revert_deplete(
    vial_id: UUID,
    body: VialCorrectionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN)),
):
    return correct_vial(
        db,
        vial_id=vial_id,
        note=body.note,
        user=current_user,
        revert_to=VialStatus.OPENED,
    )
