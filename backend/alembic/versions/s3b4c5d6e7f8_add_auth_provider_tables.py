"""Add auth provider tables

Revision ID: s3b4c5d6e7f8
Revises: r2a3b4c5d6e7
Create Date: 2026-02-25

Changes:
- Create lab_auth_providers table (per-lab identity provider config)
- Create external_identities table (SSO identity linking)
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "s3b4c5d6e7f8"
down_revision = "r2a3b4c5d6e7"
branch_labels = None
depends_on = None

auth_provider_type = sa.Enum(
    "password", "oidc_microsoft", "oidc_google", "saml",
    name="authprovidertype",
)


def upgrade() -> None:
    op.create_table(
        "lab_auth_providers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("lab_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("labs.id"), nullable=False, index=True),
        sa.Column("provider_type", auth_provider_type, nullable=False),
        sa.Column("config", postgresql.JSON(), nullable=False, server_default="{}"),
        sa.Column("email_domain", sa.String(255), nullable=True),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("lab_id", "provider_type", name="uq_lab_auth_provider_type"),
    )

    op.create_table(
        "external_identities",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("provider_type", sa.String(50), nullable=False),
        sa.Column("provider_subject", sa.String(255), nullable=False),
        sa.Column("provider_email", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("provider_type", "provider_subject", name="uq_external_identity_provider_subject"),
    )


def downgrade() -> None:
    op.drop_table("external_identities")
    op.drop_table("lab_auth_providers")
    auth_provider_type.drop(op.get_bind(), checkfirst=True)
