-- ============================================================================
-- Database Security Hardening — Phase 1: Separate Database Users
-- ============================================================================
-- Run this script ONCE per database (labaid, labaid_staging, labaid_beta).
-- Connect as the postgres superuser or current labaid admin user.
--
-- Usage:
--   psql -h <host> -U postgres -d labaid -f setup_db_users.sql
--   psql -h <host> -U postgres -d labaid_staging -f setup_db_users.sql
--   psql -h <host> -U postgres -d labaid_beta -f setup_db_users.sql
--
-- After running, set passwords via:
--   ALTER ROLE labaid_app PASSWORD '<generated>';
--   ALTER ROLE labaid_migrate PASSWORD '<generated>';
--   ALTER ROLE labaid_readonly PASSWORD '<generated>';
--
-- Then update secrets in GCP Secret Manager.
-- ============================================================================

-- ── App user (Cloud Run runtime — SELECT/INSERT/UPDATE/DELETE only) ──────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'labaid_app') THEN
    CREATE ROLE labaid_app WITH LOGIN;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE current_database() TO labaid_app;
GRANT USAGE ON SCHEMA public TO labaid_app;

-- Existing tables
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO labaid_app;

-- Future tables (created by migrations)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO labaid_app;

-- Sequences (for serial/identity columns)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO labaid_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO labaid_app;


-- ── Migration user (Alembic — full DDL for schema changes) ──────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'labaid_migrate') THEN
    CREATE ROLE labaid_migrate WITH LOGIN;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE current_database() TO labaid_migrate;
GRANT ALL PRIVILEGES ON SCHEMA public TO labaid_migrate;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO labaid_migrate;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO labaid_migrate;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO labaid_migrate;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON SEQUENCES TO labaid_migrate;


-- ── Read-only user (support queries, reporting, debugging) ──────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'labaid_readonly') THEN
    CREATE ROLE labaid_readonly WITH LOGIN;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE current_database() TO labaid_readonly;
GRANT USAGE ON SCHEMA public TO labaid_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO labaid_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO labaid_readonly;
