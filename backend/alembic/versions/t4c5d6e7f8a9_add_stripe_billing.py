"""Add Stripe billing

Revision ID: t4c5d6e7f8a9
Revises: s3b4c5d6e7f8
Create Date: 2026-02-26

Changes:
- Add stripe_customer_id, stripe_subscription_id, billing_email to labs
- Create stripe_events table for webhook deduplication
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "t4c5d6e7f8a9"
down_revision = "s3b4c5d6e7f8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("labs", sa.Column("stripe_customer_id", sa.String(255), nullable=True))
    op.add_column("labs", sa.Column("stripe_subscription_id", sa.String(255), nullable=True))
    op.add_column("labs", sa.Column("billing_email", sa.String(255), nullable=True))
    op.create_index("ix_labs_stripe_customer_id", "labs", ["stripe_customer_id"], unique=True)

    op.create_table(
        "stripe_events",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("stripe_event_id", sa.String(255), nullable=False),
        sa.Column("event_type", sa.String(100), nullable=False),
        sa.Column("processed_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_stripe_events_stripe_event_id", "stripe_events", ["stripe_event_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_stripe_events_stripe_event_id", table_name="stripe_events")
    op.drop_table("stripe_events")
    op.drop_index("ix_labs_stripe_customer_id", table_name="labs")
    op.drop_column("labs", "billing_email")
    op.drop_column("labs", "stripe_subscription_id")
    op.drop_column("labs", "stripe_customer_id")
