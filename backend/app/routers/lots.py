from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import case, func
from sqlalchemy.orm import Session, subqueryload

from app.core.database import get_db
from app.middleware.auth import get_current_user, require_role
from app.models.models import Antibody, Lab, Lot, LotDocument, QCStatus, User, UserRole, Vial, VialStatus
from app.schemas.schemas import LotArchiveRequest, LotCreate, LotOut, LotUpdateQC, LotWithCounts, VialCounts, VialOut
from app.services.audit import log_audit, snapshot_lot
from app.services.vial_service import deplete_all_opened, deplete_all_lot

router = APIRouter(prefix="/api/lots", tags=["lots"])


@router.get("/", response_model=list[LotWithCounts])
def list_lots(
    antibody_id: UUID | None = None,
    lab_id: UUID | None = None,
    include_archived: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Lot)
    if current_user.role == UserRole.SUPER_ADMIN and lab_id:
        q = q.filter(Lot.lab_id == lab_id)
    else:
        q = q.filter(Lot.lab_id == current_user.lab_id)

    if antibody_id:
        q = q.filter(Lot.antibody_id == antibody_id)

    if not include_archived:
        q = q.filter(Lot.is_archived.is_(False))
    lots = q.options(subqueryload(Lot.documents)).order_by(Lot.created_at.desc()).all()

    if not lots:
        return []


    # Batch query: vial counts per lot in one query
    lot_ids = [lot.id for lot in lots]
    counts_q = (
        db.query(
            Vial.lot_id,
            func.sum(case((Vial.status == VialStatus.SEALED, 1), else_=0)).label("sealed"),
            func.sum(case((Vial.status == VialStatus.OPENED, 1), else_=0)).label("opened"),
            func.sum(case((Vial.status == VialStatus.DEPLETED, 1), else_=0)).label("depleted"),
            func.sum(case((Vial.status != VialStatus.DEPLETED, 1), else_=0)).label("total"),
        )
        .filter(Vial.lot_id.in_(lot_ids))
        .group_by(Vial.lot_id)
        .all()
    )
    counts_map = {
        row.lot_id: VialCounts(
            sealed=row.sealed or 0,
            opened=row.opened or 0,
            depleted=row.depleted or 0,
            total=row.total or 0,
        )
        for row in counts_q
    }

    # Batch query: antibody info
    ab_ids = list({lot.antibody_id for lot in lots})
    abs_q = db.query(Antibody).filter(Antibody.id.in_(ab_ids)).all()
    ab_map = {ab.id: ab for ab in abs_q}

    # Batch query: which lots have a QC document
    qc_doc_lot_ids = {
        r[0]
        for r in db.query(LotDocument.lot_id)
        .filter(LotDocument.lot_id.in_(lot_ids), LotDocument.is_qc_document.is_(True))
        .distinct()
        .all()
    }

    results = []
    for lot in lots:
        ab = ab_map.get(lot.antibody_id)
        results.append(
            LotWithCounts(
                id=lot.id,
                antibody_id=lot.antibody_id,
                lab_id=lot.lab_id,
                lot_number=lot.lot_number,
                vendor_barcode=lot.vendor_barcode,
                expiration_date=lot.expiration_date,
                qc_status=lot.qc_status,
                qc_approved_by=lot.qc_approved_by,
                qc_approved_at=lot.qc_approved_at,
                is_archived=lot.is_archived,
                created_at=lot.created_at,
                vial_counts=counts_map.get(lot.id, VialCounts()),
                antibody_target=ab.target if ab else None,
                antibody_fluorochrome=ab.fluorochrome if ab else None,
                documents=lot.documents,
                has_qc_document=lot.id in qc_doc_lot_ids,
            )
        )

    return results


@router.post("/", response_model=LotOut)
def create_lot(
    body: LotCreate,
    lab_id: UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    target_lab_id = current_user.lab_id
    if current_user.role == UserRole.SUPER_ADMIN and lab_id:
        target_lab_id = lab_id

    ab = (
        db.query(Antibody)
        .filter(Antibody.id == body.antibody_id, Antibody.lab_id == target_lab_id)
        .first()
    )
    if not ab:
        raise HTTPException(status_code=404, detail="Antibody not found")

    lot = Lot(lab_id=target_lab_id, **body.model_dump())
    db.add(lot)
    db.flush()

    log_audit(
        db,
        lab_id=target_lab_id,
        user_id=current_user.id,
        action="lot.created",
        entity_type="lot",
        entity_id=lot.id,
        after_state=snapshot_lot(lot),
    )

    db.commit()
    db.refresh(lot)
    return lot


@router.patch("/{lot_id}/qc", response_model=LotOut)
def update_qc_status(
    lot_id: UUID,
    body: LotUpdateQC,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    q = db.query(Lot).filter(Lot.id == lot_id)
    if current_user.role != UserRole.SUPER_ADMIN:
        q = q.filter(Lot.lab_id == current_user.lab_id)
    lot = q.first()
    
    if not lot:
        raise HTTPException(status_code=404, detail="Lot not found")

    before = snapshot_lot(lot)

    # Enforce QC document requirement if lab has the setting enabled
    if body.qc_status == QCStatus.APPROVED:
        lab = db.get(Lab, lot.lab_id)
        if lab and (lab.settings or {}).get("qc_doc_required", False):
            has_qc_doc = db.query(LotDocument.id).filter(
                LotDocument.lot_id == lot_id,
                LotDocument.is_qc_document.is_(True),
            ).first() is not None
            if not has_qc_doc:
                raise HTTPException(
                    status_code=409,
                    detail="A QC document must be uploaded before this lot can be approved. Your lab requires QC documentation for lot approval.",
                )

    lot.qc_status = body.qc_status
    if body.qc_status == QCStatus.APPROVED:
        lot.qc_approved_by = current_user.id
        lot.qc_approved_at = datetime.now(timezone.utc)
    else:
        lot.qc_approved_by = None
        lot.qc_approved_at = None

    log_audit(
        db,
        lab_id=lot.lab_id,
        user_id=current_user.id,
        action=f"lot.qc_{body.qc_status.value}",
        entity_type="lot",
        entity_id=lot.id,
        before_state=before,
        after_state=snapshot_lot(lot),
    )

    db.commit()
    db.refresh(lot)
    return lot


@router.post("/{lot_id}/deplete-all", response_model=list[VialOut])
def deplete_all_vials(
    lot_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(
        UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR, UserRole.TECH
    )),
):
    return deplete_all_opened(db, lot_id=lot_id, user=current_user)


@router.post("/{lot_id}/deplete-all-lot", response_model=list[VialOut])
def deplete_entire_lot(
    lot_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(
        UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR
    )),
):
    return deplete_all_lot(db, lot_id=lot_id, user=current_user)


@router.patch("/{lot_id}/archive", response_model=LotOut)
def archive_lot(
    lot_id: UUID,
    body: LotArchiveRequest | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(
        UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR
    )),
):
    q = db.query(Lot).filter(Lot.id == lot_id)
    if current_user.role != UserRole.SUPER_ADMIN:
        q = q.filter(Lot.lab_id == current_user.lab_id)
    lot = q.first()
    if not lot:
        raise HTTPException(status_code=404, detail="Lot not found")

    before = snapshot_lot(lot)
    lot.is_archived = not lot.is_archived
    if lot.is_archived:
        lot.archive_note = body.note if body else None
    else:
        lot.archive_note = None

    log_audit(
        db,
        lab_id=lot.lab_id,
        user_id=current_user.id,
        action="lot.archived" if lot.is_archived else "lot.unarchived",
        entity_type="lot",
        entity_id=lot.id,
        before_state=before,
        after_state=snapshot_lot(lot),
        note=body.note if body else None,
    )

    db.commit()
    db.refresh(lot)
    return lot


@router.get("/{lot_id}", response_model=LotOut)
def get_lot(
    lot_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Lot).filter(Lot.id == lot_id)
    if current_user.role != UserRole.SUPER_ADMIN:
        q = q.filter(Lot.lab_id == current_user.lab_id)

    lot = q.first()
    if not lot:
        raise HTTPException(status_code=404, detail="Lot not found")
    return lot
