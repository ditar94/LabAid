"""add cancellation_reason to labs

Revision ID: w7a8b9c0d1e2
Revises: v6f7a8b9c0d1
Create Date: 2026-03-03 22:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'w7a8b9c0d1e2'
down_revision: Union[str, None] = 'v6f7a8b9c0d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('labs', sa.Column('cancellation_reason', sa.String(50), nullable=True))


def downgrade() -> None:
    op.drop_column('labs', 'cancellation_reason')
