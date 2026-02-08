from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.middleware.auth import get_current_user, require_role
from app.models.models import Antibody, Fluorochrome, User, UserRole
from app.schemas.schemas import FluorochromeCreate, FluorochromeOut, FluorochromeUpdate
from app.services.audit import log_audit, snapshot_fluorochrome

router = APIRouter(prefix="/api/fluorochromes", tags=["fluorochromes"])

_DEFAULT_COLOR = "#9ca3af"


def _normalize_name(name: str) -> str:
    return name.strip().lower()


def _ensure_fluorochromes_for_lab(db: Session, lab_id: UUID) -> None:
    antibody_names = [
        row[0]
        for row in (
            db.query(Antibody.fluorochrome)
            .filter(Antibody.lab_id == lab_id, Antibody.is_active.is_(True))
            .distinct()
            .all()
        )
    ]
    if not antibody_names:
        return
    existing = {
        _normalize_name(f.name): f
        for f in db.query(Fluorochrome)
        .filter(Fluorochrome.lab_id == lab_id)
        .all()
    }
    created = False
    reactivated = False
    for name in antibody_names:
        if not name:
            continue
        key = _normalize_name(name)
        if key not in existing:
            db.add(
                Fluorochrome(
                    lab_id=lab_id,
                    name=name,
                    color=_DEFAULT_COLOR,
                )
            )
            created = True
        else:
            fluoro = existing[key]
            if not fluoro.is_active:
                fluoro.is_active = True
                reactivated = True
    if created or reactivated:
        db.commit()


@router.get("/", response_model=list[FluorochromeOut])
def list_fluorochromes(
    lab_id: UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Fluorochrome)
    if current_user.role == UserRole.SUPER_ADMIN and lab_id:
        q = q.filter(Fluorochrome.lab_id == lab_id)
    else:
        q = q.filter(Fluorochrome.lab_id == current_user.lab_id)
    target_lab_id = lab_id if current_user.role == UserRole.SUPER_ADMIN and lab_id else current_user.lab_id
    if target_lab_id:
        _ensure_fluorochromes_for_lab(db, target_lab_id)
    q = q.filter(Fluorochrome.is_active.is_(True))
    return q.all()


@router.post("/", response_model=FluorochromeOut)
def create_fluorochrome(
    body: FluorochromeCreate,
    lab_id: UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    target_lab_id = current_user.lab_id
    if current_user.role == UserRole.SUPER_ADMIN and lab_id:
        target_lab_id = lab_id

    existing = (
        db.query(Fluorochrome)
        .filter(Fluorochrome.lab_id == target_lab_id)
        .filter(func.lower(Fluorochrome.name) == func.lower(body.name))
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="Fluorochrome already exists")

    fluoro = Fluorochrome(lab_id=target_lab_id, **body.model_dump())
    db.add(fluoro)
    db.commit()
    db.refresh(fluoro)
    return fluoro


@router.patch("/{fluorochrome_id}", response_model=FluorochromeOut)
def update_fluorochrome(
    fluorochrome_id: UUID,
    body: FluorochromeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)
    ),
):
    q = db.query(Fluorochrome).filter(Fluorochrome.id == fluorochrome_id)
    if current_user.role != UserRole.SUPER_ADMIN:
        q = q.filter(Fluorochrome.lab_id == current_user.lab_id)
    fluoro = q.first()
    if not fluoro:
        raise HTTPException(status_code=404, detail="Fluorochrome not found")

    before = snapshot_fluorochrome(fluoro)
    old_color = fluoro.color
    fluoro.color = body.color

    log_audit(
        db,
        lab_id=fluoro.lab_id,
        user_id=current_user.id,
        action="fluorochrome.updated",
        entity_type="fluorochrome",
        entity_id=fluoro.id,
        before_state=before,
        after_state=snapshot_fluorochrome(fluoro),
        note=f"{fluoro.name}: color {old_color} → {body.color}",
    )

    db.commit()
    db.refresh(fluoro)
    return fluoro


@router.delete("/{fluorochrome_id}")
def delete_fluorochrome(
    fluorochrome_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    q = db.query(Fluorochrome).filter(Fluorochrome.id == fluorochrome_id)
    if current_user.role != UserRole.SUPER_ADMIN:
        q = q.filter(Fluorochrome.lab_id == current_user.lab_id)
    
    fluoro = q.first()
    if not fluoro:
        raise HTTPException(status_code=404, detail="Fluorochrome not found")

    before = snapshot_fluorochrome(fluoro)
    fluoro.is_active = False

    log_audit(
        db,
        lab_id=fluoro.lab_id,
        user_id=current_user.id,
        action="fluorochrome.archived",
        entity_type="fluorochrome",
        entity_id=fluoro.id,
        before_state=before,
        after_state=snapshot_fluorochrome(fluoro),
    )

    db.commit()
    return {"detail": "Fluorochrome archived"}
