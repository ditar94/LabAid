"""add current_period_end to labs

Revision ID: u5e6f7a8b9c0
Revises: t4d5e6f7a8b9
Create Date: 2026-03-01 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'u5e6f7a8b9c0'
down_revision: Union[str, None] = 't4d5e6f7a8b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('labs', sa.Column('current_period_end', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('labs', 'current_period_end')
