# LabAid — Flow Cytometry Inventory System

Full-stack web application for Flow Cytometry labs to track antibody inventory, lots, and QC status.

## Tech Stack

- **Backend**: Python / FastAPI / SQLAlchemy / Alembic
- **Database**: PostgreSQL 16
- **Frontend**: React / TypeScript / Vite
- **Auth**: JWT (lab_id derived from token, never trusted from frontend)
- **Infra**: GCP (Cloud Run, Cloud SQL, Firebase Hosting), Terraform, GitHub Actions CI/CD

## Environments & CI/CD

All deployment details, branch strategy, and workflow instructions are in [CONTRIBUTING.md](CONTRIBUTING.md).

| Environment | URL | Email | DB | Max Instances |
|---|---|---|---|---|
| Beta | beta.labaid.io | console | labaid_beta | 1 |
| Staging | staging.labaid.io | resend | labaid_beta (shared) | 1 |
| Production | labaid.io | resend | labaid | 3 |

**Deploy flow**: Push to `beta` -> tests (auto) -> beta deploy (auto) -> staging deploy (approval) -> production deploy (approval) -> main synced.

## Getting Started

```bash
# Start all containers (database, backend, frontend)
# Migrations run automatically on backend startup
docker compose up -d --build
```

### Common Commands

```bash
# View logs (all services)
docker compose logs -f

# View logs (specific service)
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f db

# Restart everything
docker compose restart

# Stop everything
docker compose down

# Full rebuild (use after major changes or if things break)
docker compose down && docker compose up -d --build && docker compose exec backend alembic upgrade head && docker compose restart backend

# Check migration status
docker compose exec backend alembic current
docker compose exec backend alembic history

# Reset admin password to 'admin' (if locked out)
docker compose exec db psql -U labaid -d labaid -c "UPDATE users SET hashed_password = '\$2b\$12\$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.G5j8kFqMwNxmPC' WHERE email = 'admin@labaid.com';"
```

### Troubleshooting

Migrations now run automatically on backend startup. If you still see database errors:
```bash
# Check migration status
docker compose exec backend alembic current
docker compose exec backend alembic history

# Force re-run migrations
docker compose exec backend alembic upgrade head
docker compose restart backend
```

If login doesn't work after a restart:
```bash
# Check backend logs for errors
docker compose logs backend | grep -i error

# Verify the database has users
docker compose exec db psql -U labaid -d labaid -c "SELECT email FROM users;"
```

## Testing the App

| What | URL |
|------|-----|
| **Desktop browser** | https://localhost:5173 |
| **Mobile / other device** (same Wi-Fi) | https://\<your-mac-ip\>:5173 |
| **API docs (Swagger)** | http://localhost:8000/docs |

**First-time setup:** Visit `/setup` to create your first lab and admin account, then log in at `/login`.

**Mobile testing notes:**
- The dev server uses a self-signed HTTPS certificate (required for camera access). Accept the browser's certificate warning when prompted.
- Find your Mac's local IP with `ipconfig getifaddr en0` (e.g. `192.168.1.218`).
- API requests are proxied through Vite — no need to expose port 8000 to the network.

---

## Hosting & Data Architecture

- **Model**: Site-managed SaaS — LabAid hosts and manages the platform on behalf of labs
- **Compute**: Cloud Run (autoscaling containers, 0-3 instances per environment)
- **Database**: Cloud SQL for PostgreSQL with automated daily backups, 7-day PITR, WAL archiving
- **File storage**: GCS via `ObjectStorageService` (S3-compatible interface, local filesystem fallback for dev). Bucket versioning enabled, 30-day retention policy.
- **Secrets**: GCP Secret Manager (JWT key, DB creds, API keys, storage keys)
- **Monitoring**: Cloud Logging + Cloud Monitoring + Error Reporting
- **Auth**: JWT in HttpOnly cookies, rate-limited login, bcrypt password hashing

### Data Retention

- Active labs: documents in Hot tier
- Older docs: lifecycle rules move to Nearline after 365 days
- Inactive labs: data preserved (read-only access on suspension), never deleted
- Audit logs: append-only, immutable (PostgreSQL trigger prevents UPDATE/DELETE)

---

## Original Vision

> A program for use in Flow Cytometry labs where I can scan an antibody vial and
> track inventory (vials on hand, vials opened, vials per lot, which lot is
> newer/older). Store information indefinitely with no risk of it disappearing.
> Scan a vial using a barcode/QR scanner and it tells me whether the lot is
> registered, whether it's been QC'd, and lets me "open" a vial so inventory
> updates. The scan screen should be convenient — if the lot isn't registered yet,
> let the user register it inline (with quantity received) and store it in a
> storage container. Labs can create storage racks and scan antibodies into
> specific spots so users can quickly find each antibody/lot. Multiple vials per
> lot are stored individually, each in its own cell.

---

## Development Checklist

### Pending: Ops Hardening

- [x] Persist blob metadata in DB (file_size, content_type, checksum_sha256 on lot_documents)
- [x] Store document checksums + integrity check endpoint (`GET /api/admin/integrity`)
- [x] Request size limits (50MB, configurable) + rate limiting for uploads (10/min) and login (5/min)
- [x] Tag releases and keep a mapping of schema version to app version for restores/rollbacks
- [x] Use backward-compatible migrations — [docs/DATABASE_GUIDE.md](docs/DATABASE_GUIDE.md)
- [x] Add automated integrity checks that validate the full graph after migrations/restores
- [x] Verify foreign keys and cascading rules — audited, all correct (RESTRICT by default, soft-delete pattern)

### Pending: Documentation & Compliance

- [x] Document backup/restore process and run periodic restore tests — [docs/DISASTER_RECOVERY.md](docs/DISASTER_RECOVERY.md)
- [x] Define RPO/RTO targets (15 min RPO / 4 hr RTO) and align backup cadence
- [x] Write and rehearse a restore playbook (DB restore + blob restore + validation queries)
- [ ] Run first scheduled restore test and record results
- [x] Incident response plan + basic status/communication plan — [docs/INCIDENT_RESPONSE.md](docs/INCIDENT_RESPONSE.md)
- [x] Legal baseline: Terms of Service, Privacy Policy — [docs/TERMS_OF_SERVICE.md](docs/TERMS_OF_SERVICE.md), [docs/PRIVACY_POLICY.md](docs/PRIVACY_POLICY.md) (DRAFT — needs legal review)
- [x] Security vulnerability disclosure policy — [SECURITY.md](SECURITY.md)

### Pending: Account Creation & Password Reset — Remaining Items

> Backend and frontend implementation is complete. Email-based invite/reset flow is live. These are the remaining ops and testing tasks.

- [x] Add SPF record for `labaid.io` allowing Resend
- [x] Add DKIM record for `labaid.io` from Resend dashboard
- [x] Verify domain in Resend dashboard
- [x] Create Resend account and generate API key -> store in GCP Secret Manager
- [x] Integration test: create user -> token stored -> accept-invite -> password set, token cleared, user logged in
- [x] Integration test: expired token -> reject with 400
- [x] Integration test: used token -> reject with 400
- [x] Integration test: reset password -> old token invalidated, new token works
- [x] Integration test: console email backend logs email content to stdout
- [x] Manual test: full flow on beta with console backend
- [x] Manual test: full flow on staging with Resend

### Pending: AUTH Overhaul — Pluggable Enterprise Authentication

> Full plan in [docs/AUTH_OVERHAUL.md](docs/AUTH_OVERHAUL.md). Adds per-lab SSO (Microsoft Entra ID, Google Workspace, future SAML) while keeping all authorization internal.

- [ ] Phase 1 — Auth Provider Infrastructure (DB tables, provider management API, admin UI)
- [ ] Phase 2 — OIDC Integration (Microsoft + Google SSO login flow)
- [ ] Phase 3 — Login Flow Overhaul (email-first discovery, SSO buttons, password-only gating)
- [ ] Phase 4 — Hardening & Security Audit
- [ ] Phase 5 — SAML Support (future, only when a customer requires it)

### Pending: Compliance Exports

> Formatted reports for lab inspections and audits. Builds on the existing audit log infrastructure.

- [ ] Audit trail export (CSV + PDF) — filterable by date range, entity, action
- [ ] Lot lifecycle report — full history of a lot from receipt to depletion with all events
- [ ] QC history export — all QC approvals/failures with documents, approvers, dates
- [ ] Inspection export — combined report (inventory snapshot + QC status + audit trail)

### Pending: Email Notifications

> Scheduled alerts via Cloud Scheduler + daily digest endpoint. Uses existing Resend integration.

- [ ] Low stock alerts — notify lab admins when antibody inventory drops below threshold
- [ ] Expiring reagent alerts — daily digest of lots expiring within configurable window
- [ ] QC pending alerts — notify supervisors of lots awaiting QC approval

### Backlog

- [ ] Catalog number auto-lookup — auto-populate vendor/catalog fields by querying vendor databases (BD, Cytek, Sysmex, BioLegend) during antibody registration; deferred due to fragile web scraping dependencies

---

## Completed Features

<details>
<summary>Click to expand full list of completed work</summary>

### Code Efficiency
- N+1 query fixes (storage grids, scan lookup, audit log, move_vials)
- Database indexes on audit_log
- React.lazy code splitting, SharedDataContext, stabilized props

### Production Readiness
- HTTPS, CORS lockdown, secrets management, database backups
- Rate limiting (login endpoint), health checks (DB + storage)
- Staging environment, deployment automation, integration tests
- Billing automation (trial/active/past_due/cancelled)

### Core Features
- Barcode/QR scanning with GS1 DataMatrix parsing and AccessGUDID enrichment
- Full vial lifecycle tracking (sealed -> opened -> depleted)
- Storage racks with visual grid, hover popouts, fluorochrome tinting
- Temporary storage with auto-sizing grid
- Move vials between containers (Storage page + Scan screen)
- Intent-based scan actions (Open, Return, Receive, Deplete)
- Older-lot enforcement (FEFO prompts)
- QC verification with document upload and configurable requirements
- Antibody stability expiration tracking
- Reagent designations (IVD/RUO/ASR) with multi-antibody cocktail support
- Lot archiving, bulk operations, audit log export

### Auth & Multi-Tenancy
- Role-based access (super_admin, lab_admin, supervisor, tech, read_only)
- Super admin impersonation with audit attribution
- Support ticket system, global search
- Lab setup wizard, support access toggle
- Email-based invite/password reset flow (invite tokens, Resend integration)

### UI/UX
- Full visual redesign (design tokens, typography, color palette, animations)
- Responsive layout with mobile bottom nav, tablet breakpoints
- Dark mode, skeleton loading, toast notifications, pull-to-refresh
- Storage grid compact cells with hover popouts and fluorochrome tinting
- Fullscreen mobile scanner with corner marks and scanning animation
- WCAG AA accessibility audit, print stylesheet, reduced motion support

### Code Quality
- Shared components (QcBadge, LotAgeBadge, CapacityBar, GridLegend, AntibodyCard, etc.)
- Shared hooks (useVialActions, useLotBarcodeCopy, useViewPreference, useMoveVials)
- Extracted modules (StorageGridPanel, MovePanel, AntibodyForm, LotRegistrationForm, LotStorageDrilldown)

### Infrastructure
- GitHub Actions CI/CD (unified pipeline with approval gates)
- Three environments (beta/staging/production)
- Cloud SQL with SSL, pgAudit, password policies, deletion protection
- Dedicated Cloud Run service account with minimal permissions
- Terraform IaC for all GCP resources

</details>
