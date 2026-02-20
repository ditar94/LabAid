from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func as sa_func
from sqlalchemy.orm import Session, subqueryload

from app.core.database import get_db
from app.middleware.auth import get_current_user, require_role
from app.models.models import (
    Antibody,
    CocktailLot,
    CocktailLotDocument,
    CocktailLotSource,
    CocktailLotStatus,
    CocktailRecipe,
    CocktailRecipeComponent,
    Lab,
    QCStatus,
    StorageCell,
    StorageUnit,
    User,
    UserRole,
)
from app.schemas.schemas import (
    CocktailLotArchiveRequest,
    CocktailLotCreate,
    CocktailLotOut,
    CocktailLotSourceOut,
    CocktailLotStoreRequest,
    CocktailLotUpdateQC,
    CocktailLotWithDetails,
    CocktailRecipeCreate,
    CocktailRecipeComponentOut,
    CocktailRecipeOut,
    CocktailRecipeUpdate,
    CocktailRecipeWithLots,
)
from app.services.audit import log_audit
from app.services.cocktail_service import (
    create_cocktail_lot,
    deplete_cocktail_lot,
    renew_cocktail_lot,
    store_cocktail_lot,
    unstore_cocktail_lot,
)

router = APIRouter(prefix="/api/cocktails", tags=["cocktails"])

_WRITE_ROLES = (UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR, UserRole.TECH)
_ADMIN_ROLES = (UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)


def _resolve_lab_id(current_user: User, lab_id: UUID | None = None) -> UUID:
    if current_user.role == UserRole.SUPER_ADMIN and lab_id:
        return lab_id
    return current_user.lab_id


def _enrich_recipe_out(recipe: CocktailRecipe, ab_map: dict) -> CocktailRecipeOut:
    components = []
    for c in recipe.components:
        ab = ab_map.get(c.antibody_id) if c.antibody_id else None
        components.append(CocktailRecipeComponentOut(
            id=c.id,
            antibody_id=c.antibody_id,
            free_text_name=c.free_text_name,
            volume_ul=c.volume_ul,
            ordinal=c.ordinal,
            antibody_target=ab.target if ab else (c.free_text_name or None),
            antibody_fluorochrome=ab.fluorochrome if ab else None,
        ))
    return CocktailRecipeOut(
        id=recipe.id,
        lab_id=recipe.lab_id,
        name=recipe.name,
        description=recipe.description,
        shelf_life_days=recipe.shelf_life_days,
        max_renewals=recipe.max_renewals,
        is_active=recipe.is_active,
        components=components,
        created_at=recipe.created_at,
    )


def _enrich_lot_details(
    lot: CocktailLot,
    recipe_map: dict,
    ab_map: dict,
    lot_map: dict,
    user_map: dict,
) -> CocktailLotWithDetails:
    recipe = recipe_map.get(lot.recipe_id)
    sources = []
    for s in (lot.source_lots or []):
        comp = None
        if recipe:
            for c in recipe.components:
                if c.id == s.component_id:
                    comp = c
                    break
        src_lot = lot_map.get(s.source_lot_id)
        ab = ab_map.get(comp.antibody_id) if comp and comp.antibody_id else None
        sources.append(CocktailLotSourceOut(
            id=s.id,
            component_id=s.component_id,
            source_lot_id=s.source_lot_id,
            source_lot_number=src_lot.lot_number if src_lot else None,
            antibody_target=ab.target if ab else None,
            antibody_fluorochrome=ab.fluorochrome if ab else None,
        ))

    docs = [d for d in (lot.documents or []) if not d.is_deleted]
    has_qc = any(d.is_qc_document for d in docs)

    # Resolve storage location
    storage_unit_name = None
    storage_cell_label = None
    if lot.location_cell_id and lot.location_cell:
        cell = lot.location_cell
        storage_cell_label = cell.label or f"R{cell.row + 1}C{cell.col + 1}"
        if cell.storage_unit:
            storage_unit_name = cell.storage_unit.name

    creator = user_map.get(lot.created_by)

    return CocktailLotWithDetails(
        id=lot.id,
        recipe_id=lot.recipe_id,
        lab_id=lot.lab_id,
        lot_number=lot.lot_number,
        vendor_barcode=lot.vendor_barcode,
        preparation_date=lot.preparation_date,
        expiration_date=lot.expiration_date,
        status=lot.status,
        qc_status=lot.qc_status,
        qc_approved_by=lot.qc_approved_by,
        qc_approved_at=lot.qc_approved_at,
        created_by=lot.created_by,
        renewal_count=lot.renewal_count,
        last_renewed_at=lot.last_renewed_at,
        location_cell_id=lot.location_cell_id,
        is_archived=lot.is_archived,
        archive_note=lot.archive_note,
        created_at=lot.created_at,
        recipe_name=recipe.name if recipe else None,
        sources=sources,
        documents=docs,
        has_qc_document=has_qc,
        storage_unit_name=storage_unit_name,
        storage_cell_label=storage_cell_label,
        created_by_name=creator.full_name if creator else None,
    )


# ── Recipe Endpoints ──────────────────────────────────────────────────────


@router.get("/recipes", response_model=list[CocktailRecipeWithLots])
def list_recipes(
    include_lots: bool = False,
    include_inactive: bool = False,
    lab_id: UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    target_lab_id = _resolve_lab_id(current_user, lab_id)

    q = db.query(CocktailRecipe).filter(CocktailRecipe.lab_id == target_lab_id)
    if not include_inactive:
        q = q.filter(CocktailRecipe.is_active.is_(True))
    q = q.options(subqueryload(CocktailRecipe.components))

    if include_lots:
        q = q.options(
            subqueryload(CocktailRecipe.lots)
            .subqueryload(CocktailLot.source_lots),
            subqueryload(CocktailRecipe.lots)
            .subqueryload(CocktailLot.documents),
            subqueryload(CocktailRecipe.lots)
            .subqueryload(CocktailLot.location_cell)
            .subqueryload(StorageCell.storage_unit),
        )

    recipes = q.order_by(CocktailRecipe.name).all()

    # Batch-load antibodies for component resolution
    all_ab_ids = set()
    for r in recipes:
        for c in r.components:
            if c.antibody_id:
                all_ab_ids.add(c.antibody_id)
    ab_map = {}
    if all_ab_ids:
        abs_ = db.query(Antibody).filter(Antibody.id.in_(all_ab_ids)).all()
        ab_map = {a.id: a for a in abs_}

    results = []
    for recipe in recipes:
        enriched = _enrich_recipe_out(recipe, ab_map)

        lots_out = []
        if include_lots:
            # Batch-load source lots and users for lot enrichment
            all_source_lot_ids = set()
            all_user_ids = set()
            for lot in recipe.lots:
                for s in (lot.source_lots or []):
                    all_source_lot_ids.add(s.source_lot_id)
                if lot.created_by:
                    all_user_ids.add(lot.created_by)

            from app.models.models import Lot as LotModel
            lot_map = {}
            if all_source_lot_ids:
                src_lots = db.query(LotModel).filter(LotModel.id.in_(all_source_lot_ids)).all()
                lot_map = {l.id: l for l in src_lots}

            user_map = {}
            if all_user_ids:
                users = db.query(User).filter(User.id.in_(all_user_ids)).all()
                user_map = {u.id: u for u in users}

            recipe_map = {recipe.id: recipe}
            for lot in recipe.lots:
                lots_out.append(_enrich_lot_details(lot, recipe_map, ab_map, lot_map, user_map))

        active_count = sum(1 for l in recipe.lots if l.status == CocktailLotStatus.ACTIVE and not l.is_archived)

        results.append(CocktailRecipeWithLots(
            **enriched.model_dump(),
            lots=lots_out,
            active_lot_count=active_count,
        ))

    return results


@router.post("/recipes", response_model=CocktailRecipeOut)
def create_recipe(
    body: CocktailRecipeCreate,
    lab_id: UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(*_ADMIN_ROLES)),
):
    target_lab_id = _resolve_lab_id(current_user, lab_id)

    if body.shelf_life_days < 1:
        raise HTTPException(status_code=400, detail="Shelf life must be at least 1 day")

    if not body.components:
        raise HTTPException(status_code=400, detail="At least one component is required")

    # Validate: each component must have antibody_id or free_text_name
    for c in body.components:
        if not c.antibody_id and not c.free_text_name:
            raise HTTPException(
                status_code=400,
                detail="Each component must have either antibody_id or free_text_name",
            )

    # Validate antibody_ids belong to the lab (only for components with antibody_id)
    ab_ids = [c.antibody_id for c in body.components if c.antibody_id]
    ab_map = {}
    if ab_ids:
        abs_ = db.query(Antibody).filter(
            Antibody.id.in_(ab_ids), Antibody.lab_id == target_lab_id
        ).all()
        ab_map = {a.id: a for a in abs_}

        for c in body.components:
            if c.antibody_id and c.antibody_id not in ab_map:
                raise HTTPException(
                    status_code=400,
                    detail=f"Antibody {c.antibody_id} not found in lab",
                )

    recipe = CocktailRecipe(
        lab_id=target_lab_id,
        name=body.name.strip(),
        description=body.description.strip() if body.description else None,
        shelf_life_days=body.shelf_life_days,
        max_renewals=body.max_renewals,
    )
    db.add(recipe)
    db.flush()

    for c in body.components:
        db.add(CocktailRecipeComponent(
            recipe_id=recipe.id,
            antibody_id=c.antibody_id,
            free_text_name=c.free_text_name,
            volume_ul=c.volume_ul,
            ordinal=c.ordinal,
        ))
    db.flush()

    log_audit(
        db,
        lab_id=target_lab_id,
        user_id=current_user.id,
        action="cocktail_recipe.created",
        entity_type="cocktail_recipe",
        entity_id=recipe.id,
        after_state={
            "name": recipe.name,
            "shelf_life_days": recipe.shelf_life_days,
            "max_renewals": recipe.max_renewals,
            "components": [
                {"antibody_id": str(c.antibody_id), "volume_ul": c.volume_ul, "ordinal": c.ordinal}
                for c in body.components
            ],
        },
        is_support_action=getattr(current_user, "_is_impersonating", False),
    )

    db.commit()
    db.refresh(recipe)
    return _enrich_recipe_out(recipe, ab_map)


@router.patch("/recipes/{recipe_id}", response_model=CocktailRecipeOut)
def update_recipe(
    recipe_id: UUID,
    body: CocktailRecipeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(*_ADMIN_ROLES)),
):
    target_lab_id = _resolve_lab_id(current_user)

    recipe = db.query(CocktailRecipe).filter(
        CocktailRecipe.id == recipe_id,
        CocktailRecipe.lab_id == target_lab_id,
    ).options(subqueryload(CocktailRecipe.components)).first()

    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    before = {
        "name": recipe.name,
        "shelf_life_days": recipe.shelf_life_days,
        "max_renewals": recipe.max_renewals,
        "is_active": recipe.is_active,
    }

    if body.name is not None:
        recipe.name = body.name.strip()
    if body.description is not None:
        recipe.description = body.description.strip() if body.description else None
    if body.shelf_life_days is not None:
        if body.shelf_life_days < 1:
            raise HTTPException(status_code=400, detail="Shelf life must be at least 1 day")
        recipe.shelf_life_days = body.shelf_life_days
    if body.max_renewals is not None:
        recipe.max_renewals = body.max_renewals
    if body.is_active is not None:
        recipe.is_active = body.is_active

    ab_map = {}
    if body.components is not None:
        # Validate: each component must have antibody_id or free_text_name
        for c in body.components:
            if not c.antibody_id and not c.free_text_name:
                raise HTTPException(
                    status_code=400,
                    detail="Each component must have either antibody_id or free_text_name",
                )

        # Replace components — only validate antibody_ids that are provided
        ab_ids = [c.antibody_id for c in body.components if c.antibody_id]
        if ab_ids:
            abs_ = db.query(Antibody).filter(
                Antibody.id.in_(ab_ids), Antibody.lab_id == target_lab_id
            ).all()
            ab_map = {a.id: a for a in abs_}

            for c in body.components:
                if c.antibody_id and c.antibody_id not in ab_map:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Antibody {c.antibody_id} not found in lab",
                    )

        # Delete old components
        db.query(CocktailRecipeComponent).filter(
            CocktailRecipeComponent.recipe_id == recipe.id
        ).delete(synchronize_session="fetch")

        for c in body.components:
            db.add(CocktailRecipeComponent(
                recipe_id=recipe.id,
                antibody_id=c.antibody_id,
                free_text_name=c.free_text_name,
                volume_ul=c.volume_ul,
                ordinal=c.ordinal,
            ))
        db.flush()
    else:
        # Load existing antibodies for enrichment
        comp_ab_ids = [c.antibody_id for c in recipe.components if c.antibody_id]
        if comp_ab_ids:
            abs_ = db.query(Antibody).filter(Antibody.id.in_(comp_ab_ids)).all()
            ab_map = {a.id: a for a in abs_}

    log_audit(
        db,
        lab_id=target_lab_id,
        user_id=current_user.id,
        action="cocktail_recipe.updated",
        entity_type="cocktail_recipe",
        entity_id=recipe.id,
        before_state=before,
        after_state={
            "name": recipe.name,
            "shelf_life_days": recipe.shelf_life_days,
            "max_renewals": recipe.max_renewals,
            "is_active": recipe.is_active,
        },
        is_support_action=getattr(current_user, "_is_impersonating", False),
    )

    db.commit()
    db.refresh(recipe)
    return _enrich_recipe_out(recipe, ab_map)


@router.get("/recipes/{recipe_id}", response_model=CocktailRecipeOut)
def get_recipe(
    recipe_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    target_lab_id = _resolve_lab_id(current_user)

    recipe = db.query(CocktailRecipe).filter(
        CocktailRecipe.id == recipe_id,
        CocktailRecipe.lab_id == target_lab_id,
    ).options(subqueryload(CocktailRecipe.components)).first()

    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    ab_ids = [c.antibody_id for c in recipe.components if c.antibody_id]
    abs_ = db.query(Antibody).filter(Antibody.id.in_(ab_ids)).all() if ab_ids else []
    ab_map = {a.id: a for a in abs_}

    return _enrich_recipe_out(recipe, ab_map)


# ── Lot Endpoints ─────────────────────────────────────────────────────────


@router.get("/lots", response_model=list[CocktailLotWithDetails])
def list_lots(
    recipe_id: UUID | None = None,
    include_archived: bool = False,
    lab_id: UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    target_lab_id = _resolve_lab_id(current_user, lab_id)

    q = db.query(CocktailLot).filter(CocktailLot.lab_id == target_lab_id)
    if recipe_id:
        q = q.filter(CocktailLot.recipe_id == recipe_id)
    if not include_archived:
        q = q.filter(CocktailLot.is_archived.is_(False))

    q = q.options(
        subqueryload(CocktailLot.source_lots),
        subqueryload(CocktailLot.documents),
        subqueryload(CocktailLot.location_cell).subqueryload(StorageCell.storage_unit),
    )

    lots = q.order_by(CocktailLot.created_at.desc()).all()
    if not lots:
        return []

    # Batch-load recipes
    recipe_ids = list({l.recipe_id for l in lots})
    recipes = db.query(CocktailRecipe).filter(
        CocktailRecipe.id.in_(recipe_ids)
    ).options(subqueryload(CocktailRecipe.components)).all()
    recipe_map = {r.id: r for r in recipes}

    # Batch-load antibodies
    all_ab_ids = set()
    for r in recipes:
        for c in r.components:
            if c.antibody_id:
                all_ab_ids.add(c.antibody_id)
    ab_map = {}
    if all_ab_ids:
        abs_ = db.query(Antibody).filter(Antibody.id.in_(all_ab_ids)).all()
        ab_map = {a.id: a for a in abs_}

    # Batch-load source lots
    all_source_lot_ids = set()
    all_user_ids = set()
    for lot in lots:
        for s in (lot.source_lots or []):
            all_source_lot_ids.add(s.source_lot_id)
        if lot.created_by:
            all_user_ids.add(lot.created_by)

    from app.models.models import Lot as LotModel
    lot_obj_map = {}
    if all_source_lot_ids:
        src_lots = db.query(LotModel).filter(LotModel.id.in_(all_source_lot_ids)).all()
        lot_obj_map = {l.id: l for l in src_lots}

    user_map = {}
    if all_user_ids:
        users = db.query(User).filter(User.id.in_(all_user_ids)).all()
        user_map = {u.id: u for u in users}

    return [_enrich_lot_details(lot, recipe_map, ab_map, lot_obj_map, user_map) for lot in lots]


@router.post("/lots", response_model=CocktailLotWithDetails)
def prepare_lot(
    body: CocktailLotCreate,
    lab_id: UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(*_WRITE_ROLES)),
):
    target_lab_id = _resolve_lab_id(current_user, lab_id)

    recipe = db.query(CocktailRecipe).filter(
        CocktailRecipe.id == body.recipe_id,
        CocktailRecipe.lab_id == target_lab_id,
    ).options(subqueryload(CocktailRecipe.components)).first()

    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    # Prevent duplicate lot numbers within the same recipe
    existing_lot = db.query(CocktailLot).filter(
        CocktailLot.recipe_id == body.recipe_id,
        sa_func.lower(CocktailLot.lot_number) == body.lot_number.strip().lower(),
    ).first()
    if existing_lot:
        raise HTTPException(
            status_code=409,
            detail="A lot with this number already exists for this recipe",
        )

    sources = [s.model_dump() for s in body.sources]
    lot = create_cocktail_lot(
        db,
        recipe=recipe,
        lot_number=body.lot_number,
        vendor_barcode=body.vendor_barcode,
        preparation_date=body.preparation_date,
        expiration_date=body.expiration_date,
        sources=sources,
        user=current_user,
        lab_id=target_lab_id,
    )

    db.commit()
    db.refresh(lot)

    # Reload with relationships for enrichment
    lot = db.query(CocktailLot).filter(CocktailLot.id == lot.id).options(
        subqueryload(CocktailLot.source_lots),
        subqueryload(CocktailLot.documents),
        subqueryload(CocktailLot.location_cell).subqueryload(StorageCell.storage_unit),
    ).first()

    # Build maps for enrichment
    ab_ids = [c.antibody_id for c in recipe.components if c.antibody_id]
    abs_ = db.query(Antibody).filter(Antibody.id.in_(ab_ids)).all() if ab_ids else []
    ab_map = {a.id: a for a in abs_}

    from app.models.models import Lot as LotModel
    src_lot_ids = [s.source_lot_id for s in lot.source_lots]
    src_lots = db.query(LotModel).filter(LotModel.id.in_(src_lot_ids)).all() if src_lot_ids else []
    lot_map = {l.id: l for l in src_lots}

    user_map = {}
    if lot.created_by:
        u = db.get(User, lot.created_by)
        if u:
            user_map[u.id] = u

    return _enrich_lot_details(lot, {recipe.id: recipe}, ab_map, lot_map, user_map)


@router.get("/lots/{lot_id}", response_model=CocktailLotWithDetails)
def get_lot(
    lot_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    target_lab_id = _resolve_lab_id(current_user)

    lot = db.query(CocktailLot).filter(
        CocktailLot.id == lot_id,
        CocktailLot.lab_id == target_lab_id,
    ).options(
        subqueryload(CocktailLot.source_lots),
        subqueryload(CocktailLot.documents),
        subqueryload(CocktailLot.location_cell).subqueryload(StorageCell.storage_unit),
    ).first()

    if not lot:
        raise HTTPException(status_code=404, detail="Cocktail lot not found")

    recipe = db.query(CocktailRecipe).filter(
        CocktailRecipe.id == lot.recipe_id
    ).options(subqueryload(CocktailRecipe.components)).first()

    ab_ids = [c.antibody_id for c in recipe.components if c.antibody_id] if recipe else []
    abs_ = db.query(Antibody).filter(Antibody.id.in_(ab_ids)).all() if ab_ids else []
    ab_map = {a.id: a for a in abs_}

    from app.models.models import Lot as LotModel
    src_lot_ids = [s.source_lot_id for s in lot.source_lots]
    src_lots = db.query(LotModel).filter(LotModel.id.in_(src_lot_ids)).all() if src_lot_ids else []
    lot_obj_map = {l.id: l for l in src_lots}

    user_map = {}
    if lot.created_by:
        u = db.get(User, lot.created_by)
        if u:
            user_map[u.id] = u

    return _enrich_lot_details(lot, {recipe.id: recipe} if recipe else {}, ab_map, lot_obj_map, user_map)


@router.patch("/lots/{lot_id}/qc", response_model=CocktailLotOut)
def update_qc_status(
    lot_id: UUID,
    body: CocktailLotUpdateQC,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(*_ADMIN_ROLES)),
):
    target_lab_id = _resolve_lab_id(current_user)

    lot = db.query(CocktailLot).filter(
        CocktailLot.id == lot_id,
        CocktailLot.lab_id == target_lab_id,
    ).first()
    if not lot:
        raise HTTPException(status_code=404, detail="Cocktail lot not found")

    # Enforce QC document requirement
    if body.qc_status == QCStatus.APPROVED:
        lab = db.get(Lab, lot.lab_id)
        if lab and (lab.settings or {}).get("qc_doc_required", False):
            has_qc_doc = db.query(CocktailLotDocument.id).filter(
                CocktailLotDocument.cocktail_lot_id == lot_id,
                CocktailLotDocument.is_qc_document.is_(True),
                CocktailLotDocument.is_deleted == False,  # noqa: E712
            ).first() is not None
            if not has_qc_doc:
                raise HTTPException(
                    status_code=409,
                    detail="A QC document must be uploaded before this cocktail lot can be approved.",
                )

    from app.services.cocktail_service import _snapshot_cocktail_lot
    before = _snapshot_cocktail_lot(lot)

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
        action=f"cocktail_lot.qc_{body.qc_status.value}",
        entity_type="cocktail_lot",
        entity_id=lot.id,
        before_state=before,
        after_state=_snapshot_cocktail_lot(lot),
        is_support_action=getattr(current_user, "_is_impersonating", False),
    )

    db.commit()
    db.refresh(lot)
    return lot


@router.post("/lots/{lot_id}/renew", response_model=CocktailLotOut)
def renew_lot(
    lot_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(*_ADMIN_ROLES)),
):
    target_lab_id = _resolve_lab_id(current_user)

    lot = db.query(CocktailLot).filter(
        CocktailLot.id == lot_id,
        CocktailLot.lab_id == target_lab_id,
    ).first()
    if not lot:
        raise HTTPException(status_code=404, detail="Cocktail lot not found")

    if lot.status == CocktailLotStatus.DEPLETED:
        raise HTTPException(status_code=409, detail="Cannot renew a depleted cocktail lot")

    lot = renew_cocktail_lot(db, cocktail_lot=lot, user=current_user)
    db.commit()
    db.refresh(lot)
    return lot


@router.post("/lots/{lot_id}/deplete", response_model=CocktailLotOut)
def deplete_lot(
    lot_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(*_WRITE_ROLES)),
):
    target_lab_id = _resolve_lab_id(current_user)

    lot = db.query(CocktailLot).filter(
        CocktailLot.id == lot_id,
        CocktailLot.lab_id == target_lab_id,
    ).first()
    if not lot:
        raise HTTPException(status_code=404, detail="Cocktail lot not found")

    lot = deplete_cocktail_lot(db, cocktail_lot=lot, user=current_user)
    db.commit()
    db.refresh(lot)
    return lot


@router.patch("/lots/{lot_id}/archive", response_model=CocktailLotOut)
def archive_lot(
    lot_id: UUID,
    body: CocktailLotArchiveRequest | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(*_ADMIN_ROLES)),
):
    target_lab_id = _resolve_lab_id(current_user)

    lot = db.query(CocktailLot).filter(
        CocktailLot.id == lot_id,
        CocktailLot.lab_id == target_lab_id,
    ).first()
    if not lot:
        raise HTTPException(status_code=404, detail="Cocktail lot not found")

    from app.services.cocktail_service import _snapshot_cocktail_lot
    before = _snapshot_cocktail_lot(lot)

    lot.is_archived = not lot.is_archived
    if lot.is_archived:
        lot.archive_note = body.note if body else None
    else:
        lot.archive_note = None

    log_audit(
        db,
        lab_id=lot.lab_id,
        user_id=current_user.id,
        action="cocktail_lot.archived" if lot.is_archived else "cocktail_lot.unarchived",
        entity_type="cocktail_lot",
        entity_id=lot.id,
        before_state=before,
        after_state=_snapshot_cocktail_lot(lot),
        note=body.note if body else None,
        is_support_action=getattr(current_user, "_is_impersonating", False),
    )

    db.commit()
    db.refresh(lot)
    return lot


@router.post("/lots/{lot_id}/store", response_model=CocktailLotOut)
def store_lot(
    lot_id: UUID,
    body: CocktailLotStoreRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(*_WRITE_ROLES)),
):
    target_lab_id = _resolve_lab_id(current_user)

    lot = db.query(CocktailLot).filter(
        CocktailLot.id == lot_id,
        CocktailLot.lab_id == target_lab_id,
    ).first()
    if not lot:
        raise HTTPException(status_code=404, detail="Cocktail lot not found")

    lot = store_cocktail_lot(db, cocktail_lot=lot, cell_id=body.cell_id, user=current_user)
    db.commit()
    db.refresh(lot)
    return lot


@router.post("/lots/{lot_id}/unstore", response_model=CocktailLotOut)
def unstore_lot(
    lot_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(*_WRITE_ROLES)),
):
    target_lab_id = _resolve_lab_id(current_user)

    lot = db.query(CocktailLot).filter(
        CocktailLot.id == lot_id,
        CocktailLot.lab_id == target_lab_id,
    ).first()
    if not lot:
        raise HTTPException(status_code=404, detail="Cocktail lot not found")

    lot = unstore_cocktail_lot(db, cocktail_lot=lot, user=current_user)
    db.commit()
    db.refresh(lot)
    return lot
