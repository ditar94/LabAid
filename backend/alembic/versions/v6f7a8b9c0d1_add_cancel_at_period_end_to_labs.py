"""add cancel_at_period_end to labs

Revision ID: v6f7a8b9c0d1
Revises: u5e6f7a8b9c0
Create Date: 2026-03-02 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'v6f7a8b9c0d1'
down_revision: Union[str, None] = 'u5e6f7a8b9c0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('labs', sa.Column('cancel_at_period_end', sa.Boolean(), nullable=False, server_default='false'))


def downgrade() -> None:
    op.drop_column('labs', 'cancel_at_period_end')
