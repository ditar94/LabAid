from collections import defaultdict
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import case, func, or_
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.middleware.auth import get_current_user, require_role
from app.models.models import Antibody, Designation, Fluorochrome, Lot, ReagentComponent, StorageCell, StorageUnit, User, UserRole, Vial, VialStatus
from app.schemas.schemas import (
    AntibodyArchiveRequest,
    AntibodyCreate,
    AntibodyOut,
    AntibodySearchResult,
    AntibodyUpdate,
    LotSummary,
    StorageLocation,
    VialCounts,
)
from app.services.audit import log_audit, snapshot_antibody

router = APIRouter(prefix="/api/antibodies", tags=["antibodies"])
_DEFAULT_FLUORO_COLOR = "#9ca3af"


@router.get("/", response_model=list[AntibodyOut])
def list_antibodies(
    lab_id: UUID | None = None,
    include_inactive: bool = False,
    designation: str | None = None,
    limit: int = 500,
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Antibody)
    if current_user.role == UserRole.SUPER_ADMIN and lab_id:
        q = q.filter(Antibody.lab_id == lab_id)
    else:
        q = q.filter(Antibody.lab_id == current_user.lab_id)

    if not include_inactive:
        q = q.filter(Antibody.is_active.is_(True))

    if designation:
        q = q.filter(Antibody.designation == designation)

    return q.order_by(func.coalesce(Antibody.target, Antibody.name), Antibody.fluorochrome).offset(offset).limit(min(limit, 1000)).all()


@router.post("/", response_model=AntibodyOut)
def create_antibody(
    body: AntibodyCreate,
    lab_id: UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    target_lab_id = current_user.lab_id
    if current_user.role == UserRole.SUPER_ADMIN and lab_id:
        target_lab_id = lab_id

    fluoro_name = body.fluorochrome.strip() if body.fluorochrome else None
    if fluoro_name:
        existing_fluoro = (
            db.query(Fluorochrome)
            .filter(Fluorochrome.lab_id == target_lab_id)
            .filter(func.lower(Fluorochrome.name) == func.lower(fluoro_name))
            .first()
        )
        if not existing_fluoro:
            db.add(
                Fluorochrome(
                    lab_id=target_lab_id,
                    name=fluoro_name,
                    color=_DEFAULT_FLUORO_COLOR,
                )
            )

    ab_data = body.model_dump(exclude={"fluorochrome", "components"})
    ab = Antibody(lab_id=target_lab_id, **ab_data, fluorochrome=fluoro_name)
    db.add(ab)
    db.flush()

    if body.components:
        for comp in body.components:
            db.add(ReagentComponent(
                antibody_id=ab.id,
                target=comp.target,
                fluorochrome=comp.fluorochrome,
                clone=comp.clone,
                ordinal=comp.ordinal,
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
    )

    db.commit()
    db.refresh(ab)
    return ab


@router.get("/search", response_model=list[AntibodySearchResult])
def search_antibodies(
    q: str = "",
    lab_id: UUID | None = None,
    designation: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not q.strip():
        return []

    term = f"%{q.strip()}%"

    target_lab_id = current_user.lab_id
    if current_user.role == UserRole.SUPER_ADMIN and lab_id:
        target_lab_id = lab_id

    # Subquery: antibody IDs that have a matching component
    component_ab_ids = (
        db.query(ReagentComponent.antibody_id)
        .filter(or_(
            ReagentComponent.target.ilike(term),
            ReagentComponent.fluorochrome.ilike(term),
        ))
    )

    # Subquery: antibody IDs that have a matching lot number
    lot_ab_ids = (
        db.query(Lot.antibody_id)
        .filter(
            Lot.lab_id == target_lab_id,
            Lot.lot_number.ilike(term),
        )
    )

    # 1. Find matching antibodies
    search_query = db.query(Antibody).filter(
        Antibody.lab_id == target_lab_id,
        Antibody.is_active.is_(True),
        or_(
            Antibody.target.ilike(term),
            Antibody.fluorochrome.ilike(term),
            Antibody.clone.ilike(term),
            Antibody.catalog_number.ilike(term),
            Antibody.name.ilike(term),
            Antibody.id.in_(component_ab_ids),
            Antibody.id.in_(lot_ab_ids),
        ),
    )

    if designation:
        search_query = search_query.filter(Antibody.designation == designation)

    antibodies = (
        search_query
        .order_by(func.coalesce(Antibody.target, Antibody.name), Antibody.fluorochrome)
        .limit(50)
        .all()
    )

    if not antibodies:
        return []

    ab_ids = [ab.id for ab in antibodies]

    # 2. Batch-query lots for matching antibodies
    lots = db.query(Lot).filter(Lot.antibody_id.in_(ab_ids)).all()
    lot_ids = [lot.id for lot in lots]

    # 3. Batch vial counts per lot
    counts_map: dict = {}
    if lot_ids:
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

    # 4. Batch-query vials with storage locations (sealed or opened, in storage)
    #    Exclude vials from archived lots so they don't create ghost locations
    archived_lot_ids = {lot.id for lot in lots if lot.is_archived}
    active_lot_ids = [lid for lid in lot_ids if lid not in archived_lot_ids]
    stored_vials = []
    if active_lot_ids:
        stored_vials = (
            db.query(Vial.id, Vial.lot_id, Vial.location_cell_id)
            .filter(
                Vial.lot_id.in_(active_lot_ids),
                Vial.location_cell_id.isnot(None),
                Vial.status.in_([VialStatus.SEALED, VialStatus.OPENED]),
            )
            .all()
        )

    # 5. Batch-query cells → storage units
    cell_ids = [v.location_cell_id for v in stored_vials]
    cell_to_unit: dict = {}
    if cell_ids:
        cells = db.query(StorageCell.id, StorageCell.storage_unit_id).filter(StorageCell.id.in_(cell_ids)).all()
        cell_to_unit = {c.id: c.storage_unit_id for c in cells}

    unit_ids = list(set(cell_to_unit.values()))
    unit_map: dict = {}
    if unit_ids:
        units = db.query(StorageUnit).filter(StorageUnit.id.in_(unit_ids)).all()
        unit_map = {u.id: u for u in units}

    # 6. Build lookup maps
    lots_by_ab: dict = defaultdict(list)
    for lot in lots:
        lots_by_ab[lot.antibody_id].append(lot)

    lot_ab_map = {lot.id: lot.antibody_id for lot in lots}

    # Group: antibody_id → unit_id → [vial_ids]
    ab_unit_vials: dict = defaultdict(lambda: defaultdict(list))
    for v in stored_vials:
        ab_id = lot_ab_map.get(v.lot_id)
        uid = cell_to_unit.get(v.location_cell_id)
        if ab_id and uid:
            ab_unit_vials[ab_id][uid].append(v.id)

    # 7. Assemble results
    results = []
    for ab in antibodies:
        ab_lots = lots_by_ab.get(ab.id, [])
        lot_summaries = [
            LotSummary(
                id=lot.id,
                lot_number=lot.lot_number,
                vendor_barcode=lot.vendor_barcode,
                expiration_date=lot.expiration_date,
                qc_status=lot.qc_status,
                vial_counts=counts_map.get(lot.id, VialCounts()),
                is_archived=lot.is_archived,
                created_at=lot.created_at,
            )
            for lot in ab_lots
        ]

        total = VialCounts(
            sealed=sum(counts_map.get(l.id, VialCounts()).sealed for l in ab_lots),
            opened=sum(counts_map.get(l.id, VialCounts()).opened for l in ab_lots),
            depleted=sum(counts_map.get(l.id, VialCounts()).depleted for l in ab_lots),
            total=sum(counts_map.get(l.id, VialCounts()).total for l in ab_lots),
        )

        storage_locs = []
        for uid, vids in ab_unit_vials.get(ab.id, {}).items():
            u = unit_map[uid]
            storage_locs.append(
                StorageLocation(
                    unit_id=u.id,
                    unit_name=u.name,
                    temperature=u.temperature,
                    vial_ids=vids,
                )
            )

        results.append(
            AntibodySearchResult(
                antibody=ab,
                lots=lot_summaries,
                total_vial_counts=total,
                storage_locations=storage_locs,
            )
        )

    return results


@router.patch("/{antibody_id}", response_model=AntibodyOut)
def update_antibody(
    antibody_id: UUID,
    body: AntibodyUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    q = db.query(Antibody).filter(Antibody.id == antibody_id)
    if current_user.role != UserRole.SUPER_ADMIN:
        q = q.filter(Antibody.lab_id == current_user.lab_id)
    ab = q.first()

    if not ab:
        raise HTTPException(status_code=404, detail="Antibody not found")

    before = snapshot_antibody(ab)

    updates = body.model_dump(exclude_unset=True)

    # Extract components separately — not a direct column
    new_components = updates.pop("components", None)

    # Handle fluorochrome change — ensure it exists in the lab's list
    if "fluorochrome" in updates and updates["fluorochrome"]:
        fluoro_name = updates["fluorochrome"].strip()
        target_lab_id = ab.lab_id
        existing_fluoro = (
            db.query(Fluorochrome)
            .filter(Fluorochrome.lab_id == target_lab_id)
            .filter(func.lower(Fluorochrome.name) == func.lower(fluoro_name))
            .first()
        )
        if not existing_fluoro:
            db.add(
                Fluorochrome(
                    lab_id=target_lab_id,
                    name=fluoro_name,
                    color=_DEFAULT_FLUORO_COLOR,
                )
            )
        updates["fluorochrome"] = fluoro_name

    for field, value in updates.items():
        setattr(ab, field, value)

    # Replace components if provided
    if new_components is not None:
        db.query(ReagentComponent).filter(ReagentComponent.antibody_id == ab.id).delete()
        for comp in new_components:
            db.add(ReagentComponent(
                antibody_id=ab.id,
                target=comp["target"],
                fluorochrome=comp["fluorochrome"],
                clone=comp.get("clone"),
                ordinal=comp.get("ordinal", 0),
            ))
        db.flush()

    log_audit(
        db,
        lab_id=ab.lab_id,
        user_id=current_user.id,
        action="antibody.updated",
        entity_type="antibody",
        entity_id=ab.id,
        before_state=before,
        after_state=snapshot_antibody(ab),
    )

    db.commit()
    db.refresh(ab)
    return ab


@router.get("/low-stock", response_model=list[AntibodyOut])
def get_low_stock_antibodies(
    lab_id: UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    target_lab_id = current_user.lab_id
    if current_user.role == UserRole.SUPER_ADMIN and lab_id:
        target_lab_id = lab_id

    from app.models.models import QCStatus as QCS

    # Total sealed vials from non-archived, non-failed lots (pending QC + approved)
    total_vials_subquery = (
        db.query(
            Lot.antibody_id,
            func.count(Vial.id).label("total_vial_count"),
        )
        .join(Vial, Lot.id == Vial.lot_id)
        .filter(
            Lot.lab_id == target_lab_id,
            Lot.is_archived.is_(False),
            Lot.qc_status.in_([QCS.PENDING, QCS.APPROVED]),
            Vial.status == VialStatus.SEALED,
        )
        .group_by(Lot.antibody_id)
        .subquery()
    )

    # Approved lots' sealed vials only
    approved_vials_subquery = (
        db.query(
            Lot.antibody_id,
            func.count(Vial.id).label("approved_vial_count"),
        )
        .join(Vial, Lot.id == Vial.lot_id)
        .filter(
            Lot.lab_id == target_lab_id,
            Lot.is_archived.is_(False),
            Lot.qc_status == QCS.APPROVED,
            Vial.status == VialStatus.SEALED,
        )
        .group_by(Lot.antibody_id)
        .subquery()
    )

    # Antibodies below EITHER threshold
    antibodies = (
        db.query(Antibody)
        .outerjoin(
            total_vials_subquery,
            Antibody.id == total_vials_subquery.c.antibody_id,
        )
        .outerjoin(
            approved_vials_subquery,
            Antibody.id == approved_vials_subquery.c.antibody_id,
        )
        .filter(
            Antibody.lab_id == target_lab_id,
            Antibody.is_active.is_(True),
            or_(
                (Antibody.low_stock_threshold.isnot(None))
                & (
                    func.coalesce(total_vials_subquery.c.total_vial_count, 0)
                    < Antibody.low_stock_threshold
                ),
                (Antibody.approved_low_threshold.isnot(None))
                & (
                    func.coalesce(approved_vials_subquery.c.approved_vial_count, 0)
                    < Antibody.approved_low_threshold
                ),
            ),
        )
        .all()
    )

    return antibodies


@router.patch("/{antibody_id}/archive", response_model=AntibodyOut)
def archive_antibody(
    antibody_id: UUID,
    body: AntibodyArchiveRequest | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    q = db.query(Antibody).filter(Antibody.id == antibody_id)
    if current_user.role != UserRole.SUPER_ADMIN:
        q = q.filter(Antibody.lab_id == current_user.lab_id)
    ab = q.first()
    if not ab:
        raise HTTPException(status_code=404, detail="Antibody not found")

    before = snapshot_antibody(ab)
    ab.is_active = not ab.is_active

    log_audit(
        db,
        lab_id=ab.lab_id,
        user_id=current_user.id,
        action="antibody.archived" if not ab.is_active else "antibody.unarchived",
        entity_type="antibody",
        entity_id=ab.id,
        before_state=before,
        after_state=snapshot_antibody(ab),
        note=body.note if body else None,
    )

    db.commit()
    db.refresh(ab)
    return ab


@router.get("/{antibody_id}", response_model=AntibodyOut)
def get_antibody(
    antibody_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Antibody).filter(Antibody.id == antibody_id)
    if current_user.role != UserRole.SUPER_ADMIN:
        q = q.filter(Antibody.lab_id == current_user.lab_id)

    ab = q.first()
    if not ab:
        raise HTTPException(status_code=404, detail="Antibody not found")
    return ab
