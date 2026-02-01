from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.middleware.auth import get_current_user
from app.models.models import AuditLog, User, UserRole
from app.schemas.schemas import AuditLogOut

router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("/", response_model=list[AuditLogOut])
def list_audit_logs(
    entity_type: str | None = None,
    entity_id: UUID | None = None,
    lab_id: UUID | None = None,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(AuditLog)
    if current_user.role == UserRole.SUPER_ADMIN and lab_id:
        q = q.filter(AuditLog.lab_id == lab_id)
    elif current_user.role != UserRole.SUPER_ADMIN:
        q = q.filter(AuditLog.lab_id == current_user.lab_id)

    if entity_type:
        q = q.filter(AuditLog.entity_type == entity_type)
    if entity_id:
        q = q.filter(AuditLog.entity_id == entity_id)
    return q.order_by(AuditLog.created_at.desc()).offset(offset).limit(limit).all()

