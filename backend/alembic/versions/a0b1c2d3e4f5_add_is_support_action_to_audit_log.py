"""add is_support_action to audit_log

Revision ID: a0b1c2d3e4f5
Revises: f1a2b3c4d5e6
Create Date: 2026-02-06 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a0b1c2d3e4f5'
down_revision: Union[str, None] = 'f1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'audit_log',
        sa.Column('is_support_action', sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column('audit_log', 'is_support_action')
