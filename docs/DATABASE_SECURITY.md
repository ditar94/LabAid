# Database Security

## Architecture

### Two Cloud SQL instances

| Instance | Databases | Purpose |
|----------|-----------|---------|
| `labaid-db-nonprod` | `labaid_beta` | Beta and staging (shared database) |
| `labaid-db-prod` | `labaid` | Production only |

Production data lives on a physically separate instance. Even with full access to the nonprod instance, you cannot reach production data.

### Three database users per instance

| User | Used by | Privileges |
|------|---------|-----------|
| `labaid_app` | Cloud Run (runtime) | `SELECT, INSERT, UPDATE, DELETE` — no DDL |
| `labaid_migrate` | Alembic (container startup) | Full DDL (`CREATE, ALTER, DROP TABLE`, etc.) |
| `labaid_readonly` | Support queries, debugging | `SELECT` only |

The running application operates as `labaid_app` — it can read/write data but cannot alter schema, even if compromised. Migrations run as `labaid_migrate` during container startup, then the env var is unset before the app server starts.

### Network restrictions

Cloud SQL public IP access is restricted to `authorized_networks` defined in Terraform variables. Cloud Run connects via the Cloud SQL Auth Proxy sidecar (unix socket), which uses IAM — not IP-based auth.

### IAM database authentication (production)

The production instance has `cloudsql.iam_authentication` enabled. The Cloud Run service account (`cloud-run-backend@labaid-prod.iam`) is registered as an IAM database user, allowing passwordless authentication backed by GCP identity. This eliminates password rotation as a concern for production and provides per-identity audit trails in Cloud SQL logs.

---

## Secret Manager layout

| Secret | Environment | Instance | Connects as |
|--------|-------------|----------|-------------|
| `DATABASE_URL` | Production | `labaid-db-prod` | `labaid_app` |
| `DATABASE_URL_MIGRATE` | Production | `labaid-db-prod` | `labaid_migrate` |
| `DATABASE_URL_BETA` | Beta + Staging | `labaid-db-nonprod` | `labaid_app` |
| `DATABASE_URL_BETA_MIGRATE` | Beta + Staging | `labaid-db-nonprod` | `labaid_migrate` |

Format: `postgresql://labaid_app:<password>@/<db_name>?host=/cloudsql/<instance_connection_name>`

---

## Setup instructions

### 1. Apply Terraform

```bash
cd terraform
terraform plan   # Review: 2 instances, 6 users, IAM bindings
terraform apply
```

This creates the instances, databases, users (with placeholder passwords), and IAM bindings.

### 2. Set real passwords

**Important**: Passwords must be URL-safe (no `+`, `/`, `=`) because they're embedded in PostgreSQL connection strings. Use `openssl rand -hex 24` (hex-only) instead of `openssl rand -base64`.

```bash
# Nonprod instance (labaid-db-nonprod)
gcloud sql users set-password labaid_app     --instance=labaid-db-nonprod --password="$(openssl rand -hex 24)"
gcloud sql users set-password labaid_migrate --instance=labaid-db-nonprod --password="$(openssl rand -hex 24)"
gcloud sql users set-password labaid_readonly --instance=labaid-db-nonprod --password="$(openssl rand -hex 24)"

# Prod instance (labaid-db-prod)
gcloud sql users set-password labaid_app     --instance=labaid-db-prod --password="$(openssl rand -hex 24)"
gcloud sql users set-password labaid_migrate --instance=labaid-db-prod --password="$(openssl rand -hex 24)"
gcloud sql users set-password labaid_readonly --instance=labaid-db-prod --password="$(openssl rand -hex 24)"
```

### 3. Grant SQL privileges

Connect to each database and run the setup script:

```bash
# Via Cloud SQL Proxy or Cloud SQL Studio
psql -h <host> -U postgres -d labaid      -f scripts/setup_db_users.sql   # labaid-db-prod
psql -h <host> -U postgres -d labaid_beta -f scripts/setup_db_users.sql   # labaid-db-nonprod
```

### 4. Update secrets

```bash
# Production (labaid-db-prod)
echo -n "postgresql://labaid_app:<password>@/labaid?host=/cloudsql/labaid-prod:us-central1:labaid-db-prod" | \
  gcloud secrets versions add DATABASE_URL --data-file=-

echo -n "postgresql://labaid_migrate:<password>@/labaid?host=/cloudsql/labaid-prod:us-central1:labaid-db-prod" | \
  gcloud secrets versions add DATABASE_URL_MIGRATE --data-file=-

# Beta/Staging (labaid-db-nonprod)
echo -n "postgresql://labaid_app:<password>@/labaid_beta?host=/cloudsql/labaid-prod:us-central1:labaid-db-nonprod" | \
  gcloud secrets versions add DATABASE_URL_BETA --data-file=-

echo -n "postgresql://labaid_migrate:<password>@/labaid_beta?host=/cloudsql/labaid-prod:us-central1:labaid-db-nonprod" | \
  gcloud secrets versions add DATABASE_URL_BETA_MIGRATE --data-file=-
```

### 5. Deploy and verify

Deploy to beta first, verify health check passes, then promote through staging to production.

---

## Operational rules

1. **Never share production database credentials in chat, `.env` files, or scripts.** Production credentials only exist in GCP Secret Manager.
2. **All production data changes go through code** — Alembic migrations via the deploy pipeline. No ad-hoc SQL against production.
3. **Use Cloud SQL Studio for production debugging** — It requires Google login + MFA, logs all queries, and can't be scripted accidentally.
4. **Beta/staging are fair game** — Direct database access for testing, seeding, and debugging is expected.
5. **Use `labaid_readonly` for manual queries.** Only use `labaid_migrate` when you need DDL, and never against production outside the deploy pipeline.

---

## How it works in the Dockerfile

```dockerfile
CMD ["bash", "-c", "alembic upgrade head && unset DATABASE_URL_MIGRATE && uvicorn app.main:app ..."]
```

1. Container starts — both `DATABASE_URL` and `DATABASE_URL_MIGRATE` are set
2. Alembic runs using `DATABASE_URL_MIGRATE` (the `labaid_migrate` user with DDL privileges)
3. `DATABASE_URL_MIGRATE` is unset — the migration credentials are no longer in the process environment
4. Uvicorn starts using `DATABASE_URL` (the `labaid_app` user with DML-only privileges)
