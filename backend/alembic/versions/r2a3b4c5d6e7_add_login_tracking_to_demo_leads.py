"""Add login tracking to demo_leads

Revision ID: r2a3b4c5d6e7
Revises: q1f2a3b4c5d6
Create Date: 2026-02-24

Changes:
- Add login_count (integer, default 0) to demo_leads
- Add last_login_at (timestamptz, nullable) to demo_leads
"""

from alembic import op
import sqlalchemy as sa

revision = "r2a3b4c5d6e7"
down_revision = "q1f2a3b4c5d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("demo_leads", sa.Column("login_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("demo_leads", sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("demo_leads", "last_login_at")
    op.drop_column("demo_leads", "login_count")
