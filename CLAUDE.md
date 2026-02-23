# LabAid

Flow cytometry lab inventory system. Multi-tenant SaaS.

## Stack

- **Backend**: FastAPI + SQLAlchemy + PostgreSQL + Alembic migrations
- **Frontend**: React 19 + TypeScript + Vite (single `App.css` for styles)
- **Infra**: GCP (Cloud Run, Cloud SQL, Secret Manager, GCS). Terraform in `terraform/`.
- **CI/CD**: GitHub Actions — auto-deploy on push to `beta`, manual approval for staging/prod

## Local Dev

```bash
docker compose up -d --build
# Frontend: https://localhost:5173
# Backend API docs: http://localhost:8000/docs
```

## Commands

```bash
# TypeScript check (MUST use -p flag — bare tsc checks nothing due to root tsconfig)
cd frontend && npx tsc --noEmit -p tsconfig.app.json

# Python tests
SECRET_KEY=test-secret-key DATABASE_URL="sqlite://" .venv/bin/python -m pytest

# Python syntax check
python3 -c "import ast; ast.parse(open('file.py').read())"

# Migrations
cd backend && alembic revision --autogenerate -m "description"
cd backend && alembic upgrade head
```

## Architecture Rules

- **Multi-tenant**: Every DB query MUST be scoped by `lab_id`. Never trust `lab_id` from the frontend — it comes from the JWT.
- **Audit log**: Immutable append-only. All data mutations must go through `log_audit()` in services.
- **Routers → Services → Models**: Business logic lives in `services/`, not in routers. Routers handle HTTP concerns only.
- **Auth**: JWT with roles (super_admin, lab_admin, supervisor, tech, read_only). Super admin impersonation sets `lab_id` in JWT.
- **`storage_enabled` setting**: Gates all storage UI. Check `labSettings.storage_enabled` before adding storage features.

## Gotchas

- Auth middleware `get_current_user` expunges user before overriding `lab_id` to avoid DB flush of impersonated lab_id onto the user row.
- DB passwords must be URL-safe (`openssl rand -hex 24`, NOT `-base64`).
- `terraform apply` is blocked by a hook — use `./scripts/tf-apply.sh` instead.
- Frontend CSS is one large `App.css` file (~7700 lines). Search carefully before adding new styles to avoid duplicates.

## Code Style

- Don't add comments, docstrings, or type annotations to code you didn't change.
- Don't add error handling for scenarios that can't happen.
- Keep changes minimal and focused on what was asked.
- Always read files before modifying them — never assume you know the current state.
