"""Add demo environment

Revision ID: q1f2a3b4c5d6
Revises: p0e1f2a3b4c5
Create Date: 2026-02-23

Changes:
- Add demo columns to labs table (is_demo, demo_status, etc.)
- Create demo_leads table for prospect email capture
- Add partial index for fast available demo lab lookup
- Create SECURITY DEFINER function for demo audit log cleanup
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID


revision: str = "q1f2a3b4c5d6"
down_revision: Union[str, None] = "p0e1f2a3b4c5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # -- Demo columns on labs --
    op.add_column("labs", sa.Column("is_demo", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("labs", sa.Column("demo_status", sa.String(20), nullable=True))
    op.add_column("labs", sa.Column("demo_assigned_email", sa.String(255), nullable=True))
    op.add_column("labs", sa.Column("demo_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("labs", sa.Column("demo_assigned_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("labs", sa.Column("demo_reset_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("labs", sa.Column("demo_cycle_count", sa.Integer(), nullable=False, server_default="0"))

    # Partial index: fast lookup for available demo labs
    op.create_index(
        "ix_labs_demo_available",
        "labs",
        ["is_demo"],
        postgresql_where=sa.text("is_demo = true AND demo_status = 'available'"),
    )

    # -- demo_leads table --
    op.create_table(
        "demo_leads",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="claimed"),
        sa.Column("demo_lab_id", UUID(as_uuid=True), sa.ForeignKey("labs.id"), nullable=True),
        sa.Column("source", sa.String(100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("claimed_ip", sa.String(45), nullable=True),
        sa.Column("notified_at", sa.DateTime(timezone=True), nullable=True),
    )

    # -- SECURITY DEFINER function for demo audit log wipe --
    op.execute("""
        CREATE OR REPLACE FUNCTION wipe_demo_audit_logs(target_lab_id UUID)
        RETURNS void AS $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM labs WHERE id = target_lab_id AND is_demo = true) THEN
                RAISE EXCEPTION 'Cannot wipe audit logs for non-demo labs';
            END IF;

            ALTER TABLE audit_log DISABLE TRIGGER audit_log_immutable;
            DELETE FROM audit_log WHERE lab_id = target_lab_id;
            ALTER TABLE audit_log ENABLE TRIGGER audit_log_immutable;
        END;
        $$ LANGUAGE plpgsql SECURITY DEFINER;
    """)

    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'labaid_app') THEN
                GRANT EXECUTE ON FUNCTION wipe_demo_audit_logs(UUID) TO labaid_app;
            END IF;
        END $$;
    """)


def downgrade() -> None:
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'labaid_app') THEN
                REVOKE EXECUTE ON FUNCTION wipe_demo_audit_logs(UUID) FROM labaid_app;
            END IF;
        END $$;
    """)
    op.execute("DROP FUNCTION IF EXISTS wipe_demo_audit_logs(UUID);")

    op.drop_table("demo_leads")

    op.drop_index("ix_labs_demo_available", table_name="labs")
    op.drop_column("labs", "demo_cycle_count")
    op.drop_column("labs", "demo_reset_at")
    op.drop_column("labs", "demo_assigned_at")
    op.drop_column("labs", "demo_expires_at")
    op.drop_column("labs", "demo_assigned_email")
    op.drop_column("labs", "demo_status")
    op.drop_column("labs", "is_demo")
