"""add soft delete to labs

Revision ID: f1a2b3c4d5e6
Revises: eb9991c11a0b
Create Date: 2026-03-07 01:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'g2b3c4d5e6f7'
down_revision: Union[str, None] = 'eb9991c11a0b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('labs', sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('labs', sa.Column('deletion_requested_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('labs', 'deletion_requested_at')
    op.drop_column('labs', 'deleted_at')
