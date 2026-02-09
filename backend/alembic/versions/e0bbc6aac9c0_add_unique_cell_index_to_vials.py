"""add unique cell index to vials

Revision ID: e0bbc6aac9c0
Revises: e6f7a8b9c0d1
Create Date: 2026-02-09

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'e0bbc6aac9c0'
down_revision: Union[str, None] = 'e6f7a8b9c0d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Prevent two vials from occupying the same cell.
    # Partial index: only applies when location_cell_id IS NOT NULL.
    op.create_index(
        'ix_vials_location_cell_unique',
        'vials',
        ['location_cell_id'],
        unique=True,
        postgresql_where='location_cell_id IS NOT NULL',
    )


def downgrade() -> None:
    op.drop_index('ix_vials_location_cell_unique', table_name='vials')
