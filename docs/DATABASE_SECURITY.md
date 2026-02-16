# Database Security Hardening Plan

## Current State

### What's in place
- **Environment separation**: Three databases (`labaid`, `labaid_staging`, `labaid_beta`) with separate `DATABASE_URL` secrets in GCP Secret Manager
- **Deploy gates**: Beta (auto) -> Staging (approval) -> Production (approval) with pre-deploy backups
- **Audit immutability**: PostgreSQL trigger (`audit_log_immutable`) prevents UPDATE/DELETE on `audit_log`
- **Workload Identity Federation**: GitHub Actions authenticates via OIDC (no static service account keys)
- **Deletion protection**: `deletion_protection = true` on Cloud SQL instance
- **Automated migrations**: `alembic upgrade head` runs on container startup — all schema changes go through code -> PR -> deploy pipeline

### What's missing
- All three databases share a single Cloud SQL instance (`labaid-db`)
- One database user (`labaid`) with full superuser access to all environments
- Cloud SQL has public IP enabled with no authorized network restrictions
- No separation between app, migration, and admin database privileges
- Developer machines can connect to any database (including production) via Cloud SQL Proxy with the same credentials

**Risk**: A developer, script, or AI assistant connecting via Cloud SQL Proxy could accidentally target the production database. The only safeguard is typing the correct database name in the connection string.

---

## Phase 1 — Separate Database Users (no infra changes)

Create restricted database users so the application and CI/CD pipeline operate with least-privilege access.

### Users to create

| User | Purpose | Privileges |
|---|---|---|
| `labaid_app` | Cloud Run application | `SELECT, INSERT, UPDATE, DELETE` on all data tables. No DDL. |
| `labaid_migrate` | Alembic migrations (container startup) | Full DDL (`CREATE, ALTER, DROP TABLE`, etc.) on the app schema. Used only during `alembic upgrade head`. |
| `labaid_readonly` | Reporting, debugging, support queries | `SELECT` only on all tables. |

### SQL to execute (per database)

```sql
-- App user (used by Cloud Run for normal operations)
CREATE ROLE labaid_app WITH LOGIN PASSWORD '<generated>';
GRANT CONNECT ON DATABASE labaid TO labaid_app;
GRANT USAGE ON SCHEMA public TO labaid_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO labaid_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO labaid_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO labaid_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO labaid_app;

-- Migration user (used only during alembic upgrade head)
CREATE ROLE labaid_migrate WITH LOGIN PASSWORD '<generated>';
GRANT CONNECT ON DATABASE labaid TO labaid_migrate;
GRANT ALL PRIVILEGES ON SCHEMA public TO labaid_migrate;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO labaid_migrate;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO labaid_migrate;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO labaid_migrate;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO labaid_migrate;

-- Read-only user (for support queries and reporting)
CREATE ROLE labaid_readonly WITH LOGIN PASSWORD '<generated>';
GRANT CONNECT ON DATABASE labaid TO labaid_readonly;
GRANT USAGE ON SCHEMA public TO labaid_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO labaid_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO labaid_readonly;
```

### Application changes

Split the single `DATABASE_URL` into two secrets:

| Secret | Used by | Format |
|---|---|---|
| `DATABASE_URL` | Uvicorn (app runtime) | `postgresql+asyncpg://labaid_app:...` |
| `DATABASE_URL_MIGRATE` | Alembic (startup migration) | `postgresql+asyncpg://labaid_migrate:...` |

Update `Dockerfile.prod`:
```dockerfile
CMD ["bash", "-c", "DATABASE_URL=$DATABASE_URL_MIGRATE alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --workers 2"]
```

This way the running application cannot execute DDL, even if compromised.

### Terraform changes

Add new secrets to `secret_manager.tf`:
```hcl
locals {
  secrets = [
    "SECRET_KEY",
    "DATABASE_URL",
    "DATABASE_URL_MIGRATE",  # new
    "DATABASE_URL_BETA",
    "DATABASE_URL_BETA_MIGRATE",  # new
    # ... etc
  ]
}
```

Add `DATABASE_URL_MIGRATE` to Cloud Run env in `cloud_run.tf` and `deploy.yml`.

---

## Phase 2 — Network Restrictions

### Authorized networks

Restrict Cloud SQL to only accept connections from known sources:

```hcl
ip_configuration {
  ipv4_enabled = true

  authorized_networks {
    name  = "office"
    value = "<your-office-ip>/32"
  }
  # Cloud Run connects via unix socket (/cloudsql/...), not IP,
  # so no entry needed for Cloud Run.
}
```

This blocks Cloud SQL Proxy connections from unknown IPs. Cloud Run is unaffected because it connects via the Cloud SQL Auth Proxy sidecar (unix socket), which uses IAM — not IP-based auth.

### Optional: Private IP only (stronger)

Remove public IP entirely and use a VPC connector:

```hcl
ip_configuration {
  ipv4_enabled    = false
  private_network = google_compute_network.main.id
}
```

This makes the database unreachable from the internet. Developer access would go through Cloud SQL Studio (GCP Console, requires Google login + MFA) or a bastion host.

---

## Phase 3 — Separate Production Instance

The strongest safeguard: production data lives on a physically separate database instance.

### Terraform

```hcl
# Non-production instance (beta + staging)
resource "google_sql_database_instance" "nonprod" {
  name                = "labaid-db-nonprod"
  database_version    = "POSTGRES_16"
  region              = var.region
  deletion_protection = true

  settings {
    tier = "db-f1-micro"
    # ... same config as current instance
  }
}

resource "google_sql_database" "beta" {
  name     = "labaid_beta"
  instance = google_sql_database_instance.nonprod.name
}

resource "google_sql_database" "staging" {
  name     = "labaid_staging"
  instance = google_sql_database_instance.nonprod.name
}

# Production instance (separate)
resource "google_sql_database_instance" "prod" {
  name                = "labaid-db-prod"
  database_version    = "POSTGRES_16"
  region              = var.region
  deletion_protection = true

  settings {
    tier              = "db-f1-micro"  # upgrade when needed
    availability_type = "REGIONAL"     # HA for production

    backup_configuration {
      enabled                        = true
      start_time                     = "03:00"
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7
    }
  }
}

resource "google_sql_database" "prod" {
  name     = "labaid"
  instance = google_sql_database_instance.prod.name
}
```

**Cost**: ~$10/month for a second `db-f1-micro`. Upgrade to `db-g1-small` (~$30/month) when you have paying customers.

**Effect**: Even if someone runs Cloud SQL Proxy and connects to the non-prod instance, they physically cannot reach production data. Different instance = different connection string = different IAM bindings.

---

## Phase 4 — IAM Database Authentication (optional, advanced)

Replace password-based auth with GCP IAM authentication. The Cloud Run service account authenticates directly — no database password in secrets.

```hcl
resource "google_sql_database_instance" "prod" {
  settings {
    database_flags {
      name  = "cloudsql.iam_authentication"
      value = "on"
    }
  }
}

resource "google_sql_user" "app" {
  name     = "cloud-run-backend@labaid-prod.iam"
  instance = google_sql_database_instance.prod.name
  type     = "CLOUD_IAM_SERVICE_ACCOUNT"
}
```

This gives you per-identity audit trails in Cloud SQL logs and eliminates password rotation as a concern.

---

## Implementation Priority

| Priority | Phase | Effort | Impact |
|---|---|---|---|
| **Do first** | Phase 1 — Separate DB users | 1-2 hours | Limits blast radius of app compromise |
| **Do before customers** | Phase 3 — Separate prod instance | 2-3 hours | Eliminates accidental prod access |
| **Do soon** | Phase 2 — Network restrictions | 1 hour | Blocks unauthorized proxy connections |
| **Do later** | Phase 4 — IAM auth | Half day | Eliminates passwords entirely |

---

## Operational Rules

1. **Never share production database credentials in chat sessions, `.env` files, or scripts.** Production credentials should only exist in GCP Secret Manager.
2. **All production data changes go through code** — Alembic migrations via the deploy pipeline. No ad-hoc SQL against production.
3. **Use Cloud SQL Studio for production debugging** — It requires Google login + MFA, logs all queries, and can't be scripted accidentally.
4. **Beta/staging are fair game** — Direct database access for testing, seeding, and debugging is expected and encouraged in non-production environments.
5. **The `labaid_readonly` user should be the default for any manual queries.** Only escalate to `labaid_migrate` when you need DDL, and never against production outside the deploy pipeline.
