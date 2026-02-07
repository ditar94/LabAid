"""add audit_log indexes

Revision ID: a5b6c7d8e9f0
Revises: f4a5b6c7d8e9
Create Date: 2026-02-07 22:00:00.000000
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a5b6c7d8e9f0'
down_revision: Union[str, None] = 'f4a5b6c7d8e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index('ix_audit_log_lab_created', 'audit_log', ['lab_id', 'created_at'])
    op.create_index('ix_audit_log_entity', 'audit_log', ['entity_type', 'entity_id'])
    op.create_index('ix_audit_log_action', 'audit_log', ['action'])


def downgrade() -> None:
    op.drop_index('ix_audit_log_action', table_name='audit_log')
    op.drop_index('ix_audit_log_entity', table_name='audit_log')
    op.drop_index('ix_audit_log_lab_created', table_name='audit_log')
