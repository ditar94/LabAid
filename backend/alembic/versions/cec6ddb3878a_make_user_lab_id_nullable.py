"""make_user_lab_id_nullable

Revision ID: cec6ddb3878a
Revises: f3c93dd140c1
Create Date: 2026-02-01 03:26:53.185169
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'cec6ddb3878a'
down_revision: Union[str, None] = 'f3c93dd140c1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('users', 'lab_id', existing_type=sa.UUID(), nullable=True)


def downgrade() -> None:
    op.alter_column('users', 'lab_id', existing_type=sa.UUID(), nullable=False)
