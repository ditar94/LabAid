from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.middleware.auth import get_current_user, require_role
from app.models.models import Fluorochrome, User, UserRole
from app.schemas.schemas import FluorochromeCreate, FluorochromeOut
from app.services.audit import log_audit, snapshot_fluorochrome

router = APIRouter(prefix="/api/fluorochromes", tags=["fluorochromes"])


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

    fluoro = Fluorochrome(lab_id=target_lab_id, **body.model_dump())
    db.add(fluoro)
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
