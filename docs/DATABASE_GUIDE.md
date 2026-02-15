# Database Guide

## Schema Overview

### Entity Relationship Graph

```
Lab
├── User (lab_id → labs.id, nullable for super_admin)
├── Antibody (lab_id → labs.id)
│   ├── ReagentComponent (antibody_id → antibodies.id, CASCADE)
│   └── Lot (antibody_id → antibodies.id)
│       ├── Vial (lot_id → lots.id)
│       │   └── StorageCell (location_cell_id → storage_cells.id, nullable)
│       └── LotDocument (lot_id → lots.id)
├── StorageUnit (lab_id → labs.id)
│   └── StorageCell (storage_unit_id → storage_units.id)
├── Fluorochrome (lab_id → labs.id)
├── SupportTicket (lab_id → labs.id)
│   └── TicketReply (ticket_id → support_tickets.id)
├── LotRequest (lab_id → labs.id)
└── AuditLog (lab_id → labs.id, immutable)
```

### Foreign Key Rules

All foreign keys use **RESTRICT** (PostgreSQL default) unless noted. This is intentional — RESTRICT prevents accidental data loss by blocking deletes when child records exist.

| FK Constraint | On Delete | Rationale |
|---|---|---|
| `ReagentComponent.antibody_id → antibodies.id` | **CASCADE** | Components are dependent on their parent antibody |
| `StorageCell → StorageUnit` | ORM cascade (`delete-orphan`) | Cells are dependent, but units are soft-deleted in practice |
| All other FKs | RESTRICT (default) | Prevents orphaned records |

### Soft Delete Pattern

The following entities use soft-delete (`is_active = False`) and are **never hard-deleted**:

- **Labs** — suspended labs retain read-only access
- **Users** — deactivated users can't log in but their audit trail remains
- **Antibodies** — archived antibodies remain visible in historical records
- **StorageUnits** — deactivated units are hidden from active views

This means RESTRICT on user/lab FKs is always safe — the FK constraint will never fire because the parent is never actually deleted.

### Immutable Tables

- **audit_log** — PostgreSQL trigger prevents UPDATE and DELETE. All mutations are append-only.

---

## Writing Migrations

### Backward-Compatible Migration Process

All migrations must be backward-compatible so the previous version of the application can still run while the migration is being applied. This enables zero-downtime deployments.

#### Rules

1. **Add columns as nullable (or with a server_default)**
   ```python
   # GOOD — old code ignores the new column
   op.add_column("lots", sa.Column("new_field", sa.String(100), nullable=True))

   # GOOD — old code ignores it, new rows get a default
   op.add_column("lots", sa.Column("status_v2", sa.String(20),
       nullable=False, server_default="active"))

   # BAD — old code will fail on INSERT (missing required column)
   op.add_column("lots", sa.Column("new_field", sa.String(100), nullable=False))
   ```

2. **Never rename or drop columns in a single step**
   ```
   # Instead, use a 3-step process across 2+ deploys:

   Deploy 1: Migration adds new column, code writes to both old and new
   Deploy 2: Migration backfills new column from old, code reads from new
   Deploy 3: Migration drops old column (after verifying all reads use new)
   ```

3. **Never change column types in place**
   ```python
   # BAD — may fail or lose data
   op.alter_column("lots", "quantity", type_=sa.BigInteger())

   # GOOD — add new column, backfill, swap
   op.add_column("lots", sa.Column("quantity_big", sa.BigInteger(), nullable=True))
   op.execute("UPDATE lots SET quantity_big = quantity")
   # (next deploy: drop old column)
   ```

4. **Adding indexes: use `concurrently` for large tables**
   ```python
   # For tables with >100k rows, create indexes concurrently to avoid locking
   op.execute("CREATE INDEX CONCURRENTLY ix_vials_status ON vials (status)")
   ```

5. **Adding NOT NULL constraints: two-step process**
   ```python
   # Deploy 1: Add column as nullable, code starts writing non-null values
   op.add_column("lots", sa.Column("region", sa.String(50), nullable=True))

   # Deploy 2: Backfill + add constraint (after all rows have values)
   op.execute("UPDATE lots SET region = 'default' WHERE region IS NULL")
   op.alter_column("lots", "region", nullable=False)
   ```

6. **Adding FK constraints: always include `ondelete` behavior**
   ```python
   # Specify explicitly — don't rely on database defaults
   sa.ForeignKeyConstraint(["parent_id"], ["parents.id"], ondelete="RESTRICT")
   ```

### Migration File Conventions

- Revision IDs: Use Alembic auto-generation or short hex strings (e.g., `a1b2c3d4e5f6`)
- File names: `{revision_id}_{description}.py` (description uses underscores)
- Always include both `upgrade()` and `downgrade()` functions
- Test migrations locally: `docker compose exec backend alembic upgrade head`
- Check current state: `docker compose exec backend alembic current`

### Pre-Deploy Backups

The CI/CD pipeline automatically creates a Cloud SQL backup before every production deployment. If a migration causes issues, restore from the pre-deploy backup (see [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md)).

---

## Integrity Checks

A super-admin-only endpoint validates database integrity:

```
GET /api/admin/integrity
Authorization: Bearer <super_admin_token>
```

Checks performed:
- Orphaned lots (lot references non-existent antibody)
- Orphaned vials (vial references non-existent lot)
- Orphaned documents (document references non-existent lot)
- Missing blobs (document record exists but S3 object is missing)
- Documents without checksums (uploaded before metadata tracking)
- Entity counts and audit log span

Run this after restores, migrations, or periodically to verify data health.

---

## Document Storage

### Blob Metadata

Every uploaded document tracks:
- `file_size` — bytes (validated against `MAX_UPLOAD_SIZE_MB` setting, default 50 MB)
- `content_type` — MIME type (validated against allowlist)
- `checksum_sha256` — SHA-256 hash computed at upload time

### Allowed MIME Types

```
application/pdf
image/jpeg, image/png, image/gif, image/webp
text/csv
application/vnd.openxmlformats-officedocument.spreadsheetml.sheet (.xlsx)
application/vnd.ms-excel (.xls)
application/msword (.doc)
application/vnd.openxmlformats-officedocument.wordprocessingml.document (.docx)
```

### Storage Path Convention

S3 key format: `{lab_id}/{lot_id}/{document_id}_{filename}`

This groups documents by lab and lot for easy browsing and lifecycle management.
