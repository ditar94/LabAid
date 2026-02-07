"""ivd overhaul: nullable target/fluorochrome, add short_code and color

Revision ID: d3e4f5a6b7c8
Revises: c2d3e4f5a6b7
Create Date: 2026-02-06 18:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd3e4f5a6b7c8'
down_revision: Union[str, None] = 'c2d3e4f5a6b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('antibodies', 'target', existing_type=sa.String(100), nullable=True)
    op.alter_column('antibodies', 'fluorochrome', existing_type=sa.String(100), nullable=True)
    op.add_column('antibodies', sa.Column('short_code', sa.String(10), nullable=True))
    op.add_column('antibodies', sa.Column('color', sa.String(7), nullable=True))


def downgrade() -> None:
    op.drop_column('antibodies', 'color')
    op.drop_column('antibodies', 'short_code')
    op.alter_column('antibodies', 'fluorochrome', existing_type=sa.String(100), nullable=False)
    op.alter_column('antibodies', 'target', existing_type=sa.String(100), nullable=False)
