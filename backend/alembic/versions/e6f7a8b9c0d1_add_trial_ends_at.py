"""add trial_ends_at to labs

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
Create Date: 2026-02-08 14:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e6f7a8b9c0d1'
down_revision: Union[str, None] = 'd5e6f7a8b9c0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'labs',
        sa.Column('trial_ends_at', sa.DateTime(timezone=True), nullable=True),
    )
    # Backfill: set trial_ends_at = created_at + 7 days for existing trial labs
    op.execute(
        "UPDATE labs SET trial_ends_at = created_at + interval '7 days' "
        "WHERE billing_status = 'trial'"
    )


def downgrade() -> None:
    op.drop_column('labs', 'trial_ends_at')
