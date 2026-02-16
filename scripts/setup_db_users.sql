-- ============================================================================
-- Database Security Hardening — Privilege Grants
-- ============================================================================
-- Run this script ONCE per database after the users are created by Terraform.
-- Connect as the postgres superuser.
--
-- Usage (via Cloud SQL Proxy):
--   psql -h 127.0.0.1 -U postgres -d labaid -f setup_db_users.sql
--   psql -h 127.0.0.1 -U postgres -d labaid_beta -f setup_db_users.sql
-- ============================================================================

-- ── App user (Cloud Run runtime — SELECT/INSERT/UPDATE/DELETE only) ──────────

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

GRANT ALL PRIVILEGES ON SCHEMA public TO labaid_migrate;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO labaid_migrate;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO labaid_migrate;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO labaid_migrate;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON SEQUENCES TO labaid_migrate;


-- ── Read-only user (support queries, reporting, debugging) ──────────────────

GRANT USAGE ON SCHEMA public TO labaid_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO labaid_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO labaid_readonly;
