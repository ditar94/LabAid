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

| Branch | Purpose | Deploys to |
|--------|---------|------------|
| `beta` | Active development | Beta (auto) |
| `main` | Staging + Production | Staging (auto), Production (manual approval) |

### Daily Workflow

1. Work on `beta` branch, push to trigger beta deploy
2. Create PR `beta` -> `main`, CI runs tests + typecheck
3. Merge PR -> staging auto-deploys with production settings
4. Test staging, then approve production deploy in GitHub Actions

## CI/CD Pipeline

All deployments are triggered by `git push`. No manual scripts needed.

| Trigger | What happens |
|---------|-------------|
| PR opened | `ci.yml` — backend tests + frontend typecheck in parallel |
| Push to `beta` | `deploy-beta.yml` — tests, then deploy to beta |
| Push to `main` | `deploy-prod.yml` — tests, deploy to staging, then await manual approval for production |

### Manual Fallback

`deploy.sh` remains fully functional if CI/CD is unavailable:

```bash
./deploy.sh all              # Production
./deploy.sh staging          # Staging
./deploy.sh beta             # Beta
```

## Environments

| Environment | URL | Backend Service | Email | DB | Max Instances |
|---|---|---|---|---|---|
| Beta | labaid-beta.web.app | labaid-backend-beta | console | labaid_beta | 1 |
| Staging | labaid-staging.web.app | labaid-backend-staging | resend | labaid_staging | 1 |
| Production | labaid-prod.web.app | labaid-backend | resend | labaid | 3 |

All three databases live on the same Cloud SQL instance (`labaid-db`).

## Infrastructure Rules

- **Never create GCP resources manually** — use Terraform. All infrastructure is defined in `terraform/`.
- **Secret values go in Secret Manager**, never in code, env files, or Terraform state.
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
