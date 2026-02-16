# Disaster Recovery Playbook

> Last verified: _not yet tested — run the restore test procedure below and record the date here._

## RPO / RTO Targets

| Metric | Target | Current Capability |
|--------|--------|--------------------|
| **RPO** (max data loss) | 15 minutes | 7-day PITR with WAL archiving (continuous) |
| **RTO** (max downtime) | 4 hours | Cloud SQL restore ~20 min, Cloud Run redeploy ~5 min |

## Backup Configuration

### Database (Cloud SQL)

- **Production instance**: `labaid-db-prod` (PostgreSQL 16, `us-central1`, HA REGIONAL)
- **Nonprod instance**: `labaid-db-nonprod` (PostgreSQL 16, `us-central1`, ZONAL)
- **Databases**: `labaid` (prod, on `labaid-db-prod`), `labaid_beta` (on `labaid-db-nonprod`)
- **Automated backups**: Daily at 03:00 UTC
- **Retention**: 7 most recent backups
- **Point-in-time recovery (PITR)**: Enabled, 7-day WAL retention
- **Transaction log storage**: Cloud Storage (external to instance)
- **Maintenance window**: Sunday 04:00 UTC
- **Deletion protection**: Enabled

### Document Storage (GCS)

- **Bucket**: `gs://labaid-documents-prod` (`us-central1`)
- **Versioning**: Enabled (previous versions recoverable)
- **Soft delete**: 7-day retention (deleted objects recoverable for 7 days)
- **Lifecycle**: Objects move to Nearline storage after 365 days
- **Uniform bucket-level access**: Enabled

### Pre-Deploy Backups

The CI/CD pipeline creates an on-demand Cloud SQL backup before every production deployment (see `.github/workflows/deploy.yml`, `prod-backend` job).

---

## Restore Procedures

### Scenario 1: Restore database to a point in time

Use this when data was corrupted or accidentally deleted and you know approximately when.

```bash
# 1. Identify the target timestamp (UTC)
TARGET="2026-02-15T02:00:00.000Z"

# 2. Restore to a new temporary instance
gcloud sql instances clone labaid-db-prod labaid-db-restore \
  --point-in-time="$TARGET" \
  --project=labaid-prod

# 3. Verify the restored data (connect via Cloud SQL Proxy)
cloud-sql-proxy labaid-prod:us-central1:labaid-db-restore &
psql "host=127.0.0.1 port=5433 user=labaid_readonly dbname=labaid sslmode=disable"

# 4. Run validation queries (see below)

# 5. If data looks good, promote the restore:
#    Option A: Export/import specific tables
#    Option B: Update DATABASE_URL secret to point to restored instance

# 6. Clean up temporary instance when done
gcloud sql instances delete labaid-db-restore --project=labaid-prod
```

### Scenario 2: Restore from a daily backup

Use this when the entire database needs to be rolled back to a daily snapshot.

```bash
# 1. List available backups
gcloud sql backups list --instance=labaid-db-prod --project=labaid-prod

# 2. Note the backup ID from the list
BACKUP_ID="1707955200000"

# 3. Restore to a new instance
gcloud sql instances clone labaid-db-prod labaid-db-restore \
  --backup-id="$BACKUP_ID" \
  --project=labaid-prod

# 4. Verify and promote (same as Scenario 1, steps 3-6)
```

### Scenario 3: Restore deleted documents from GCS

```bash
# 1. List object versions (including deleted)
gcloud storage ls --all-versions "gs://labaid-documents-prod/path/to/file"

# 2. Restore a specific version
gcloud storage cp "gs://labaid-documents-prod/path/to/file#VERSION_NUMBER" \
  "gs://labaid-documents-prod/path/to/file"

# 3. Or restore all soft-deleted objects in a prefix
gcloud storage ls --soft-deleted "gs://labaid-documents-prod/prefix/"
gcloud storage restore "gs://labaid-documents-prod/prefix/**"
```

### Scenario 4: Full disaster (instance destroyed)

```bash
# 1. Create a new Cloud SQL instance (or use Terraform)
cd terraform && terraform apply -var-file=environments/prod.tfvars

# 2. Restore from the most recent backup
gcloud sql backups list --instance=labaid-db-prod --project=labaid-prod
gcloud sql backups restore BACKUP_ID \
  --restore-instance=labaid-db-prod \
  --project=labaid-prod

# 3. Verify DATABASE_URL secret still points to correct instance
gcloud secrets versions access latest --secret=DATABASE_URL --project=labaid-prod

# 4. Redeploy backend (picks up the restored database)
gcloud run deploy labaid-backend \
  --image us-central1-docker.pkg.dev/labaid-prod/labaid/backend:latest \
  --region us-central1 \
  --project labaid-prod

# 5. Run validation queries
```

---

## Validation Queries

Run these after any restore to verify data integrity.

```sql
-- 1. Basic counts (compare against expected values)
SELECT 'labs' AS entity, COUNT(*) FROM labs
UNION ALL SELECT 'users', COUNT(*) FROM users
UNION ALL SELECT 'antibodies', COUNT(*) FROM antibodies
UNION ALL SELECT 'lots', COUNT(*) FROM lots
UNION ALL SELECT 'vials', COUNT(*) FROM vials
UNION ALL SELECT 'audit_log', COUNT(*) FROM audit_log
UNION ALL SELECT 'documents', COUNT(*) FROM documents;

-- 2. Verify no orphaned records
SELECT 'orphaned_lots' AS check, COUNT(*)
FROM lots l LEFT JOIN antibodies a ON l.antibody_id = a.id
WHERE a.id IS NULL
UNION ALL
SELECT 'orphaned_vials', COUNT(*)
FROM vials v LEFT JOIN lots l ON v.lot_id = l.id
WHERE l.id IS NULL
UNION ALL
SELECT 'orphaned_documents', COUNT(*)
FROM documents d LEFT JOIN lots l ON d.lot_id = l.id
WHERE l.id IS NULL;

-- 3. Verify audit log integrity (should be non-zero, always growing)
SELECT MIN(created_at) AS earliest, MAX(created_at) AS latest, COUNT(*) AS total
FROM audit_log;

-- 4. Verify active labs have users
SELECT l.id, l.name, COUNT(u.id) AS user_count
FROM labs l LEFT JOIN users u ON u.lab_id = l.id
WHERE l.is_active = true
GROUP BY l.id, l.name
HAVING COUNT(u.id) = 0;

-- 5. Verify vial status consistency
SELECT status, COUNT(*) FROM vials GROUP BY status;
```

---

## Restore Test Procedure

Run quarterly. Record results below.

1. Create a PITR clone: `gcloud sql instances clone labaid-db-prod labaid-db-test-restore --point-in-time="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" --project=labaid-prod`
2. Connect to the clone via Cloud SQL Proxy
3. Run all validation queries above
4. Verify row counts match production
5. Delete the test clone: `gcloud sql instances delete labaid-db-test-restore --project=labaid-prod`
6. Record the result below

### Test History

| Date | Type | Result | Notes |
|------|------|--------|-------|
| _TBD_ | PITR clone | _pending_ | First test |

---

## Contacts

| Role | Contact |
|------|---------|
| Infrastructure | [CONTACT_EMAIL] |
| Database | [CONTACT_EMAIL] |
| On-call | [CONTACT_EMAIL] |
