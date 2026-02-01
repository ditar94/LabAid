"""add_supervisor_role_and_must_change_password

Revision ID: faaf1700fa72
Revises: c2ba90e55bb3
Create Date: 2026-01-31 04:46:55.217675
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'faaf1700fa72'
down_revision: Union[str, None] = 'c2ba90e55bb3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add 'supervisor' to the userrole enum
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'supervisor'")
    # Add must_change_password column
    op.add_column('users', sa.Column('must_change_password', sa.Boolean(), nullable=False, server_default='false'))


def downgrade() -> None:
    op.drop_column('users', 'must_change_password')
    # Note: PostgreSQL does not support removing enum values; supervisor will remain in the enum
