from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.middleware.auth import require_role
from app.models.models import Antibody, Lab, Lot, ReagentComponent, User, UserRole
from app.schemas.schemas import (
    GlobalSearchAntibody,
    GlobalSearchLab,
    GlobalSearchLot,
    GlobalSearchResult,
    ReagentComponentOut,
)

router = APIRouter(
    prefix="/api/search",
    tags=["search"],
)

RESULTS_PER_CATEGORY = 20


@router.get("/global", response_model=GlobalSearchResult)
def global_search(
    q: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN)),
):
    """Search across all labs for labs, antibodies, and lots. Super Admin only."""
    term = f"%{q}%"

    # Search labs
    lab_rows = (
        db.query(Lab)
        .filter(Lab.name.ilike(term))
        .limit(RESULTS_PER_CATEGORY)
        .all()
    )
    labs = [
        GlobalSearchLab(id=lab.id, name=lab.name, is_active=lab.is_active)
        for lab in lab_rows
    ]

    # Build lab name lookup for antibodies/lots
    lab_cache: dict[str, str] = {}

    def get_lab_name(lab_id) -> str:
        key = str(lab_id)
        if key not in lab_cache:
            lab = db.query(Lab.name).filter(Lab.id == lab_id).first()
            lab_cache[key] = lab.name if lab else "Unknown"
        return lab_cache[key]

    # Subquery: antibody IDs with matching components
    component_ab_ids = (
        db.query(ReagentComponent.antibody_id)
        .filter(or_(
            ReagentComponent.target.ilike(term),
            ReagentComponent.fluorochrome.ilike(term),
        ))
    )

    # Search antibodies
    ab_rows = (
        db.query(Antibody)
        .options(joinedload(Antibody.components))
        .filter(
            Antibody.is_active.is_(True),
            or_(
                Antibody.target.ilike(term),
                Antibody.fluorochrome.ilike(term),
                Antibody.clone.ilike(term),
                Antibody.catalog_number.ilike(term),
                Antibody.name.ilike(term),
                Antibody.id.in_(component_ab_ids),
            ),
        )
        .limit(RESULTS_PER_CATEGORY)
        .all()
    )
    antibodies = [
        GlobalSearchAntibody(
            id=ab.id,
            lab_id=ab.lab_id,
            lab_name=get_lab_name(ab.lab_id),
            target=ab.target,
            fluorochrome=ab.fluorochrome,
            clone=ab.clone,
            vendor=ab.vendor,
            catalog_number=ab.catalog_number,
            designation=ab.designation,
            name=ab.name,
            components=[ReagentComponentOut.model_validate(c) for c in ab.components],
        )
        for ab in ab_rows
    ]

    # Search lots
    lot_rows = (
        db.query(Lot)
        .filter(
            Lot.lot_number.ilike(term) | Lot.vendor_barcode.ilike(term),
        )
        .limit(RESULTS_PER_CATEGORY)
        .all()
    )

    # Resolve antibody info for lots
    ab_cache: dict[str, tuple[str | None, str | None]] = {}

    def get_ab_info(antibody_id) -> tuple[str | None, str | None]:
        key = str(antibody_id)
        if key not in ab_cache:
            ab = db.query(Antibody.target, Antibody.fluorochrome).filter(Antibody.id == antibody_id).first()
            ab_cache[key] = (ab.target, ab.fluorochrome) if ab else (None, None)
        return ab_cache[key]

    lots = []
    for lot in lot_rows:
        target, fluoro = get_ab_info(lot.antibody_id)
        lots.append(
            GlobalSearchLot(
                id=lot.id,
                lab_id=lot.lab_id,
                lab_name=get_lab_name(lot.lab_id),
                lot_number=lot.lot_number,
                antibody_target=target,
                antibody_fluorochrome=fluoro,
                qc_status=lot.qc_status,
                vendor_barcode=lot.vendor_barcode,
            )
        )

    return GlobalSearchResult(labs=labs, antibodies=antibodies, lots=lots)
