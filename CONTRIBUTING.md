# Contributing to LabAid

## Prerequisites

- **Node.js** 20+ (frontend)
- **Python** 3.12+ (backend)
- **Docker** & Docker Compose (local development)
- **gcloud CLI** (deployments)
- **Terraform** 1.5+ (infrastructure changes)

## Local Development

```bash
# Start all services (backend, frontend, PostgreSQL, MinIO)
docker compose up

# Backend runs at http://localhost:8000
# Frontend runs at http://localhost:5173
```

### Environment Files

Copy the example files and fill in your local values:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Never commit `.env` files. Secrets belong in Secret Manager, not in code.

### Running Tests

```bash
# Backend (uses SQLite in-memory — no Postgres needed)
cd backend && python -m pytest tests/ -v

# Frontend type check
cd frontend && npx tsc --noEmit -p tsconfig.app.json
```

## Branch Strategy

| Branch | Purpose |
|--------|---------|
| `beta` | Active development — all work happens here |
| `main` | Mirror of production — auto-synced after prod deploy, never push directly |

### Daily Workflow

1. Work on `beta` branch, push to trigger the deploy pipeline
2. Beta auto-deploys — test your changes on beta.labaid.io
3. Approve **"Staging"** in GitHub Actions — deploys to staging.labaid.io
4. Test staging, then approve **"Production"** in GitHub Actions — deploys to labaid.io
5. After production deploys, `main` is automatically synced to match `beta`

### Versioning

The app version is in `frontend/package.json`. Bump it on `beta` when you're ready for a new release. The version, environment label, and git SHA are displayed on the login page and sidebar — injected automatically by CI during the build.

## CI/CD Pipeline

Everything is triggered by `git push origin beta`. One unified pipeline with approval gates.

| Stage | What happens | Trigger |
|-------|-------------|---------|
| Tests | Backend pytest + frontend typecheck | Auto |
| Beta | Deploy to beta.labaid.io | Auto (after tests pass) |
| Staging | Deploy to staging.labaid.io | Manual approval in GitHub Actions |
| Production | DB backup, then deploy to labaid.io | Manual approval in GitHub Actions |
| Sync main | Fast-forward `main` to match `beta` | Auto (after production) |

PRs still run `ci.yml` (tests + typecheck) as a safety check.

### Manual Fallback

`deploy.sh` remains fully functional if CI/CD is unavailable:

```bash
./deploy.sh all              # Production
./deploy.sh staging          # Staging
./deploy.sh beta             # Beta
```

## Environments

| Environment | URL | Backend Service | Cloud SQL Instance | Database | Email | Max Instances |
|---|---|---|---|---|---|---|
| Beta | beta.labaid.io | labaid-backend-beta | `labaid-db-nonprod` | `labaid_beta` | console | 1 |
| Staging | staging.labaid.io | labaid-backend-staging | `labaid-db-nonprod` | `labaid_beta` (shared with beta) | resend | 1 |
| Production | labaid.io | labaid-backend | `labaid-db-prod` | `labaid` | resend | 3 |

Beta and staging share the same database (`labaid_beta`) on `labaid-db-nonprod`. Production has its own isolated instance (`labaid-db-prod`). See [docs/DATABASE_SECURITY.md](docs/DATABASE_SECURITY.md) for full security architecture.

## Infrastructure Rules

- **Never create GCP resources manually** — use Terraform. All infrastructure is defined in `terraform/`.
- **Secret values go in Secret Manager**, never in code, env files, or Terraform state.
- **Never share production database credentials** in chat sessions, `.env` files, or scripts. See [docs/DATABASE_SECURITY.md](docs/DATABASE_SECURITY.md).
- **All production data changes go through code** — Alembic migrations via the deploy pipeline. No ad-hoc SQL against production.
- **`deploy.sh` is the manual fallback**, CI/CD is the primary deployment path.
- **Terraform manages service config**, CI/CD manages which Docker image is deployed.

### Terraform Usage

```bash
cd terraform

# Plan changes for an environment
terraform plan -var-file=environments/prod.tfvars

# Apply changes
terraform apply -var-file=environments/prod.tfvars
```

## Architecture Invariants

These rules apply to all code changes:

1. **Multi-tenancy**: All database queries must be scoped by `lab_id`. Never return data across lab boundaries.
2. **Audit trail**: All mutations must be logged via `log_audit()`. The audit log is append-only and immutable.
3. **RBAC**: Role hierarchy (`super_admin > lab_admin > supervisor > tech > read_only`) is enforced in every endpoint. Use `require_role()` decorators.
4. **Auth**: JWT tokens are stored in HttpOnly cookies, never in localStorage. Cookie settings are environment-specific.

## Code Standards

### Backend (Python)

- FastAPI routers -> services -> SQLAlchemy models
- Pydantic schemas for request/response validation
- Syntax check: `python3 -c "import ast; ast.parse(open('file.py').read())"`
- Tests: `cd backend && python -m pytest tests/ -v`

### Frontend (TypeScript)

- React 19 + Vite
- Type check: `cd frontend && npx tsc --noEmit -p tsconfig.app.json`
  - Note: The root `tsconfig.json` uses project references — bare `npx tsc --noEmit` checks nothing.
- All API types live in `src/api/types.ts`

## PR Checklist

Before merging, verify:

- [ ] Backend tests pass (`python -m pytest tests/ -v`)
- [ ] Frontend compiles (`npx tsc --noEmit -p tsconfig.app.json`)
- [ ] No secrets in code (no API keys, passwords, connection strings)
- [ ] New mutations include `log_audit()` calls
- [ ] New endpoints enforce role-based access
- [ ] Database queries are scoped by `lab_id`
