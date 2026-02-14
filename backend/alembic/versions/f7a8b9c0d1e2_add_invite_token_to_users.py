"""add invite_token to users

Revision ID: f7a8b9c0d1e2
Revises: e0bbc6aac9c0
Create Date: 2026-02-13

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'f7a8b9c0d1e2'
down_revision: Union[str, None] = 'e0bbc6aac9c0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('invite_token', sa.String(64), nullable=True))
    op.add_column('users', sa.Column('invite_token_expires_at', sa.DateTime(timezone=True), nullable=True))
    op.create_index('ix_users_invite_token', 'users', ['invite_token'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_users_invite_token', table_name='users')
    op.drop_column('users', 'invite_token_expires_at')
    op.drop_column('users', 'invite_token')
