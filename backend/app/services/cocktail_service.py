from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func as sa_func
from sqlalchemy.orm import Session

from app.models.models import (
    Antibody,
    CocktailLot,
    CocktailLotDocument,
    CocktailLotSource,
    CocktailLotStatus,
    CocktailRecipe,
    CocktailRecipeComponent,
    Lab,
    Lot,
    QCStatus,
    StorageCell,
    Vial,
)
from app.services.audit import log_audit


def _snapshot_cocktail_lot(lot: CocktailLot) -> dict:
    return {
        "id": str(lot.id),
        "lot_number": lot.lot_number,
        "recipe_id": str(lot.recipe_id),
        "expiration_date": str(lot.expiration_date) if lot.expiration_date else None,
        "status": lot.status.value if lot.status else None,
        "qc_status": lot.qc_status.value if lot.qc_status else None,
        "renewal_count": lot.renewal_count,
        "is_archived": lot.is_archived,
        "location_cell_id": str(lot.location_cell_id) if lot.location_cell_id else None,
    }


def create_cocktail_lot(
    db: Session,
    *,
    recipe: CocktailRecipe,
    lot_number: str,
    vendor_barcode: str | None,
    preparation_date: date,
    expiration_date: date | None,
    sources: list[dict],
    user,
    lab_id: UUID,
) -> CocktailLot:
    if not recipe.is_active:
        raise HTTPException(status_code=400, detail="Recipe is not active")

    # Build component map for validation
    component_map = {c.id: c for c in recipe.components}

    # Auto-calculate expiration if not provided
    exp = expiration_date or (preparation_date + timedelta(days=recipe.shelf_life_days))

    lot = CocktailLot(
        recipe_id=recipe.id,
        lab_id=lab_id,
        lot_number=lot_number,
        vendor_barcode=vendor_barcode or None,
        preparation_date=preparation_date,
        expiration_date=exp,
        created_by=user.id,
    )
    db.add(lot)
    db.flush()

    # Create source traceability records
    for src in sources:
        comp = component_map.get(src["component_id"])
        if not comp:
            raise HTTPException(
                status_code=400,
                detail=f"Component {src['component_id']} does not belong to this recipe",
            )
        # Validate source lot belongs to the correct antibody
        source_lot = db.query(Lot).filter(
            Lot.id == src["source_lot_id"],
            Lot.antibody_id == comp.antibody_id,
            Lot.lab_id == lab_id,
        ).first()
        if not source_lot:
            raise HTTPException(
                status_code=400,
                detail=f"Source lot {src['source_lot_id']} not found or does not match component antibody",
            )
        db.add(CocktailLotSource(
            cocktail_lot_id=lot.id,
            component_id=src["component_id"],
            source_lot_id=src["source_lot_id"],
        ))

    log_audit(
        db,
        lab_id=lab_id,
        user_id=user.id,
        action="cocktail_lot.created",
        entity_type="cocktail_lot",
        entity_id=lot.id,
        after_state=_snapshot_cocktail_lot(lot),
        is_support_action=getattr(user, "_is_impersonating", False),
    )

    return lot


def renew_cocktail_lot(db: Session, *, cocktail_lot: CocktailLot, user) -> CocktailLot:
    recipe = db.get(CocktailRecipe, cocktail_lot.recipe_id)
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    if recipe.max_renewals is not None and cocktail_lot.renewal_count >= recipe.max_renewals:
        raise HTTPException(
            status_code=409,
            detail=f"Maximum renewals ({recipe.max_renewals}) reached for this cocktail lot",
        )

    before = _snapshot_cocktail_lot(cocktail_lot)

    cocktail_lot.expiration_date = date.today() + timedelta(days=recipe.shelf_life_days)
    cocktail_lot.qc_status = QCStatus.PENDING
    cocktail_lot.qc_approved_by = None
    cocktail_lot.qc_approved_at = None
    cocktail_lot.renewal_count += 1
    cocktail_lot.last_renewed_at = datetime.now(timezone.utc)

    log_audit(
        db,
        lab_id=cocktail_lot.lab_id,
        user_id=user.id,
        action="cocktail_lot.renewed",
        entity_type="cocktail_lot",
        entity_id=cocktail_lot.id,
        before_state=before,
        after_state=_snapshot_cocktail_lot(cocktail_lot),
        note=f"Renewal #{cocktail_lot.renewal_count}. New expiration: {cocktail_lot.expiration_date}",
        is_support_action=getattr(user, "_is_impersonating", False),
    )

    return cocktail_lot


def deplete_cocktail_lot(db: Session, *, cocktail_lot: CocktailLot, user) -> CocktailLot:
    if cocktail_lot.status == CocktailLotStatus.DEPLETED:
        raise HTTPException(status_code=409, detail="Cocktail lot is already depleted")

    before = _snapshot_cocktail_lot(cocktail_lot)
    cocktail_lot.status = CocktailLotStatus.DEPLETED
    # Remove from storage if stored
    if cocktail_lot.location_cell_id:
        cocktail_lot.location_cell_id = None

    log_audit(
        db,
        lab_id=cocktail_lot.lab_id,
        user_id=user.id,
        action="cocktail_lot.depleted",
        entity_type="cocktail_lot",
        entity_id=cocktail_lot.id,
        before_state=before,
        after_state=_snapshot_cocktail_lot(cocktail_lot),
        is_support_action=getattr(user, "_is_impersonating", False),
    )

    return cocktail_lot


def store_cocktail_lot(
    db: Session, *, cocktail_lot: CocktailLot, cell_id: UUID, user
) -> CocktailLot:
    cell = db.get(StorageCell, cell_id)
    if not cell:
        raise HTTPException(status_code=404, detail="Storage cell not found")

    # Check cell is not occupied by a vial
    existing_vial = db.query(Vial).filter(
        Vial.location_cell_id == cell_id,
    ).first()
    if existing_vial:
        raise HTTPException(status_code=409, detail="Cell is occupied by a vial")

    # Check cell is not occupied by another active cocktail lot
    existing_cl = db.query(CocktailLot).filter(
        CocktailLot.location_cell_id == cell_id,
        CocktailLot.id != cocktail_lot.id,
        CocktailLot.status != CocktailLotStatus.DEPLETED,
    ).first()
    if existing_cl:
        raise HTTPException(status_code=409, detail="Cell is occupied by another cocktail lot")

    before = _snapshot_cocktail_lot(cocktail_lot)
    cocktail_lot.location_cell_id = cell_id

    log_audit(
        db,
        lab_id=cocktail_lot.lab_id,
        user_id=user.id,
        action="cocktail_lot.stored",
        entity_type="cocktail_lot",
        entity_id=cocktail_lot.id,
        before_state=before,
        after_state=_snapshot_cocktail_lot(cocktail_lot),
        is_support_action=getattr(user, "_is_impersonating", False),
    )

    return cocktail_lot


def unstore_cocktail_lot(db: Session, *, cocktail_lot: CocktailLot, user) -> CocktailLot:
    if not cocktail_lot.location_cell_id:
        raise HTTPException(status_code=409, detail="Cocktail lot is not stored")

    before = _snapshot_cocktail_lot(cocktail_lot)
    cocktail_lot.location_cell_id = None

    log_audit(
        db,
        lab_id=cocktail_lot.lab_id,
        user_id=user.id,
        action="cocktail_lot.unstored",
        entity_type="cocktail_lot",
        entity_id=cocktail_lot.id,
        before_state=before,
        after_state=_snapshot_cocktail_lot(cocktail_lot),
        is_support_action=getattr(user, "_is_impersonating", False),
    )

    return cocktail_lot
