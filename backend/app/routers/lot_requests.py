from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.middleware.auth import get_current_user, require_role
from app.models.models import (
    Antibody,
    Designation,
    Fluorochrome,
    Lot,
    LotRequest,
    LotRequestStatus,
    ReagentComponent,
    StorageUnit,
    User,
    UserRole,
)
from app.schemas.schemas import LotRequestCreate, LotRequestOut, LotRequestReview
from app.services.audit import log_audit, snapshot_antibody
from app.services.vial_service import receive_vials

router = APIRouter(prefix="/api/lot-requests", tags=["lot-requests"])

_DEFAULT_FLUORO_COLOR = "#9ca3af"


def _enrich_request(req: LotRequest, db: Session) -> LotRequestOut:
    submitter = db.get(User, req.user_id)
    reviewer = db.get(User, req.reviewed_by) if req.reviewed_by else None
    unit = db.get(StorageUnit, req.storage_unit_id) if req.storage_unit_id else None
    return LotRequestOut(
        id=req.id,
        lab_id=req.lab_id,
        user_id=req.user_id,
        user_full_name=submitter.full_name if submitter else None,
        barcode=req.barcode,
        lot_number=req.lot_number,
        expiration_date=req.expiration_date,
        quantity=req.quantity,
        storage_unit_id=req.storage_unit_id,
        storage_unit_name=unit.name if unit else None,
        gs1_ai=req.gs1_ai,
        enrichment_data=req.enrichment_data,
        proposed_antibody=req.proposed_antibody,
        notes=req.notes,
        status=req.status,
        reviewed_by=req.reviewed_by,
        reviewer_name=reviewer.full_name if reviewer else None,
        reviewed_at=req.reviewed_at,
        rejection_note=req.rejection_note,
        created_at=req.created_at,
    )


@router.get("/", response_model=list[LotRequestOut])
def list_lot_requests(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(LotRequest).filter(LotRequest.lab_id == current_user.lab_id)

    # Techs only see their own requests
    if current_user.role == UserRole.TECH:
        q = q.filter(LotRequest.user_id == current_user.id)

    requests = q.order_by(LotRequest.created_at.desc()).all()
    return [_enrich_request(r, db) for r in requests]


@router.get("/pending-count")
def pending_count(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(
        UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR
    )),
):
    count = (
        db.query(func.count(LotRequest.id))
        .filter(
            LotRequest.lab_id == current_user.lab_id,
            LotRequest.status == LotRequestStatus.PENDING,
        )
        .scalar()
    )
    return {"count": count or 0}


@router.post("/", response_model=LotRequestOut)
def submit_lot_request(
    body: LotRequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(
        UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR, UserRole.TECH
    )),
):
    req = LotRequest(
        lab_id=current_user.lab_id,
        user_id=current_user.id,
        barcode=body.barcode,
        lot_number=body.lot_number,
        expiration_date=body.expiration_date,
        quantity=body.quantity,
        storage_unit_id=body.storage_unit_id,
        gs1_ai=body.gs1_ai,
        enrichment_data=body.enrichment_data,
        proposed_antibody=body.proposed_antibody,
        notes=body.notes,
        status=LotRequestStatus.PENDING,
    )
    db.add(req)
    db.flush()

    log_audit(
        db,
        lab_id=current_user.lab_id,
        user_id=current_user.id,
        action="lot_request.submitted",
        entity_type="lot_request",
        entity_id=req.id,
        after_state=req.proposed_antibody,
        note=f"Barcode: {body.barcode}, Qty: {body.quantity}",
    )

    db.commit()
    db.refresh(req)
    return _enrich_request(req, db)


@router.patch("/{request_id}/approve", response_model=LotRequestOut)
def approve_lot_request(
    request_id: UUID,
    body: LotRequestReview | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(
        UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR
    )),
):
    req = (
        db.query(LotRequest)
        .filter(
            LotRequest.id == request_id,
            LotRequest.lab_id == current_user.lab_id,
        )
        .first()
    )
    if not req:
        raise HTTPException(status_code=404, detail="Lot request not found")
    if req.status != LotRequestStatus.PENDING:
        raise HTTPException(status_code=400, detail="Request is not pending")

    # Apply reviewer edits
    if body:
        if body.lot_number is not None:
            req.lot_number = body.lot_number
        if body.expiration_date is not None:
            req.expiration_date = body.expiration_date
        if body.quantity is not None:
            req.quantity = body.quantity
        if body.storage_unit_id is not None:
            req.storage_unit_id = body.storage_unit_id
        if body.proposed_antibody is not None:
            req.proposed_antibody = body.proposed_antibody

    ab_data = req.proposed_antibody
    designation = ab_data.get("designation", "ruo")
    target_lab_id = current_user.lab_id

    # 1. Create fluorochrome if needed (RUO/ASR)
    fluoro_name = ab_data.get("fluorochrome")
    if fluoro_name and fluoro_name.strip():
        fluoro_name = fluoro_name.strip()
        existing = (
            db.query(Fluorochrome)
            .filter(Fluorochrome.lab_id == target_lab_id)
            .filter(func.lower(Fluorochrome.name) == func.lower(fluoro_name))
            .first()
        )
        if not existing:
            db.add(Fluorochrome(
                lab_id=target_lab_id,
                name=fluoro_name,
                color=_DEFAULT_FLUORO_COLOR,
            ))

    # 2. Create antibody
    ab = Antibody(
        lab_id=target_lab_id,
        target=ab_data.get("target"),
        fluorochrome=fluoro_name if fluoro_name else None,
        clone=ab_data.get("clone"),
        vendor=ab_data.get("vendor"),
        catalog_number=ab_data.get("catalog_number"),
        designation=Designation(designation),
        name=ab_data.get("name"),
        short_code=ab_data.get("short_code"),
        color=ab_data.get("color"),
        stability_days=ab_data.get("stability_days"),
        low_stock_threshold=ab_data.get("low_stock_threshold"),
        approved_low_threshold=ab_data.get("approved_low_threshold"),
    )
    db.add(ab)
    db.flush()

    # Add components if IVD
    components = ab_data.get("components", [])
    for i, comp in enumerate(components):
        db.add(ReagentComponent(
            antibody_id=ab.id,
            target=comp["target"],
            fluorochrome=comp["fluorochrome"],
            clone=comp.get("clone"),
            ordinal=comp.get("ordinal", i),
        ))
    db.flush()

    log_audit(
        db,
        lab_id=target_lab_id,
        user_id=current_user.id,
        action="antibody.created",
        entity_type="antibody",
        entity_id=ab.id,
        after_state=snapshot_antibody(ab),
        note=f"Created from lot request by {req.submitter.full_name if req.submitter else 'unknown'}",
    )

    # 3. Create lot
    lot = Lot(
        lab_id=target_lab_id,
        antibody_id=ab.id,
        lot_number=req.lot_number or "Unknown",
        vendor_barcode=req.barcode,
        expiration_date=req.expiration_date,
        gs1_ai=req.gs1_ai,
    )
    db.add(lot)
    db.flush()

    log_audit(
        db,
        lab_id=target_lab_id,
        user_id=current_user.id,
        action="lot.created",
        entity_type="lot",
        entity_id=lot.id,
        after_state={
            "lot_number": lot.lot_number,
            "antibody_id": str(ab.id),
            "vendor_barcode": lot.vendor_barcode,
        },
        note=f"Created from lot request",
    )

    # 4. Receive vials
    receive_vials(
        db,
        lot_id=lot.id,
        quantity=req.quantity,
        storage_unit_id=req.storage_unit_id,
        user=current_user,
    )

    # 5. Mark request as approved
    req.status = LotRequestStatus.APPROVED
    req.reviewed_by = current_user.id
    req.reviewed_at = datetime.now(timezone.utc)

    ab_label = ab.name or "-".join(filter(None, [ab.target, ab.fluorochrome])) or "Unnamed"
    log_audit(
        db,
        lab_id=target_lab_id,
        user_id=current_user.id,
        action="lot_request.approved",
        entity_type="antibody",
        entity_id=ab.id,
        after_state={
            "antibody_id": str(ab.id),
            "lot_id": str(lot.id),
            "quantity": req.quantity,
        },
        note=f"{ab_label}, Lot {lot.lot_number} ({req.quantity} vials)",
    )

    db.commit()
    db.refresh(req)
    return _enrich_request(req, db)


@router.patch("/{request_id}/reject", response_model=LotRequestOut)
def reject_lot_request(
    request_id: UUID,
    body: LotRequestReview,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(
        UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR
    )),
):
    req = (
        db.query(LotRequest)
        .filter(
            LotRequest.id == request_id,
            LotRequest.lab_id == current_user.lab_id,
        )
        .first()
    )
    if not req:
        raise HTTPException(status_code=404, detail="Lot request not found")
    if req.status != LotRequestStatus.PENDING:
        raise HTTPException(status_code=400, detail="Request is not pending")
    if not body.rejection_note or not body.rejection_note.strip():
        raise HTTPException(status_code=400, detail="Rejection reason is required")

    req.status = LotRequestStatus.REJECTED
    req.reviewed_by = current_user.id
    req.reviewed_at = datetime.now(timezone.utc)
    req.rejection_note = body.rejection_note.strip()

    log_audit(
        db,
        lab_id=current_user.lab_id,
        user_id=current_user.id,
        action="lot_request.rejected",
        entity_type="lot_request",
        entity_id=req.id,
        after_state={"rejection_note": req.rejection_note},
    )

    db.commit()
    db.refresh(req)
    return _enrich_request(req, db)
