"""add is_active to fluorochromes

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6, cec6ddb3878a
Create Date: 2026-02-01 12:10:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, None] = ('a1b2c3d4e5f6', 'cec6ddb3878a')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('fluorochromes', sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'))


def downgrade() -> None:
    op.drop_column('fluorochromes', 'is_active')
