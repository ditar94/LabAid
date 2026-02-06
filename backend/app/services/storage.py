"""Storage-related service functions."""

import math
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.models import StorageCell, StorageUnit


def create_temporary_storage(db: Session, lab_id: UUID) -> StorageUnit:
    """Create a temporary storage unit for a lab with initial 1x1 size."""
    unit = StorageUnit(
        lab_id=lab_id,
        name="Temporary Storage",
        rows=1,
        cols=1,
        temperature=None,
        is_active=True,
        is_temporary=True,
    )
    db.add(unit)
    db.flush()

    # Create initial cell
    cell = StorageCell(
        storage_unit_id=unit.id,
        row=0,
        col=0,
        label="A1",
    )
    db.add(cell)

    return unit


def get_temporary_storage(db: Session, lab_id: UUID) -> StorageUnit | None:
    """Get the temporary storage unit for a lab."""
    return (
        db.query(StorageUnit)
        .filter(StorageUnit.lab_id == lab_id, StorageUnit.is_temporary == True)
        .first()
    )


def ensure_temporary_storage_capacity(db: Session, unit: StorageUnit, required_cells: int) -> None:
    """
    Ensure the temporary storage has enough cells for the required count.
    Expands the grid to be square: ceil(sqrt(required_cells)) x ceil(sqrt(required_cells))
    """
    if not unit.is_temporary:
        return

    # Calculate required grid size (always square)
    size = max(1, math.ceil(math.sqrt(required_cells)))

    if size <= unit.rows and size <= unit.cols:
        return  # Already big enough

    # Get existing cells
    existing_cells = {(c.row, c.col) for c in unit.cells}

    # Add new cells as needed
    for r in range(size):
        for c in range(size):
            if (r, c) not in existing_cells:
                label = f"{chr(65 + r)}{c + 1}"
                cell = StorageCell(
                    storage_unit_id=unit.id,
                    row=r,
                    col=c,
                    label=label,
                )
                db.add(cell)

    # Update unit dimensions
    unit.rows = size
    unit.cols = size


def get_next_empty_cell(db: Session, unit: StorageUnit) -> StorageCell | None:
    """Get the next empty cell in a storage unit (row-major order)."""
    occupied_cells = {c.id for c in unit.cells if c.vial is not None}

    for cell in sorted(unit.cells, key=lambda c: (c.row, c.col)):
        if cell.id not in occupied_cells and cell.vial is None:
            return cell

    return None


def count_vials_in_temp_storage(db: Session, lab_id: UUID) -> int:
    """Count the number of vials currently in temporary storage for a lab."""
    unit = get_temporary_storage(db, lab_id)
    if not unit:
        return 0

    return sum(1 for cell in unit.cells if cell.vial is not None)
