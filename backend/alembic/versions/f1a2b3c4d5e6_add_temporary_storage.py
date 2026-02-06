"""add is_temporary to storage_units and create temp storage for labs

Revision ID: f1a2b3c4d5e6
Revises: 1ef45561a6a5
Create Date: 2026-02-03 10:00:00.000000
"""
from typing import Sequence, Union
import uuid
import math

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers, used by Alembic.
revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, None] = '1ef45561a6a5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add is_temporary column to storage_units
    op.add_column('storage_units', sa.Column('is_temporary', sa.Boolean(), server_default='false', nullable=False))

    # Create temporary storage unit for each existing lab
    conn = op.get_bind()
    labs = conn.execute(sa.text("SELECT id FROM labs")).fetchall()

    for (lab_id,) in labs:
        unit_id = uuid.uuid4()
        # Create the temporary storage unit with initial 1x1 size (will be computed dynamically)
        conn.execute(
            sa.text("""
                INSERT INTO storage_units (id, lab_id, name, rows, cols, temperature, is_active, is_temporary)
                VALUES (:id, :lab_id, 'Temporary Storage', 1, 1, NULL, true, true)
            """),
            {"id": str(unit_id), "lab_id": str(lab_id)}
        )
        # Create the initial cell (A1)
        cell_id = uuid.uuid4()
        conn.execute(
            sa.text("""
                INSERT INTO storage_cells (id, storage_unit_id, row, col, label)
                VALUES (:id, :unit_id, 0, 0, 'A1')
            """),
            {"id": str(cell_id), "unit_id": str(unit_id)}
        )


def downgrade() -> None:
    # Delete all temporary storage units and their cells
    conn = op.get_bind()
    conn.execute(sa.text("""
        DELETE FROM storage_cells WHERE storage_unit_id IN (
            SELECT id FROM storage_units WHERE is_temporary = true
        )
    """))
    conn.execute(sa.text("DELETE FROM storage_units WHERE is_temporary = true"))

    # Remove the column
    op.drop_column('storage_units', 'is_temporary')
