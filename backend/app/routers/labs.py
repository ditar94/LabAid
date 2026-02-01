from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models import models
from app.schemas import schemas
from app.middleware.auth import get_current_user

router = APIRouter(
    prefix="/api/labs",
    tags=["labs"],
    responses={404: {"description": "Not found"}},
)


@router.post("/", response_model=schemas.Lab, status_code=status.HTTP_201_CREATED)
def create_lab(
    lab: schemas.LabCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role != models.UserRole.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions",
        )
    db_lab = models.Lab(name=lab.name)
    db.add(db_lab)
    db.commit()
    db.refresh(db_lab)
    return db_lab


@router.get("/", response_model=List[schemas.Lab])
def read_labs(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role != models.UserRole.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions",
        )
    labs = db.query(models.Lab).all()
    return labs
