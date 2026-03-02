#!/usr/bin/env bash
set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────
# Override these with environment variables or edit directly.

GCP_PROJECT="${GCP_PROJECT:-labaid-prod}"
GCP_REGION="${GCP_REGION:-us-central1}"
REPO_NAME="${REPO_NAME:-labaid}"

# ─── Helpers ──────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail()  { echo -e "${RED}[FAIL]${NC} $*"; exit 1; }

usage() {
  cat <<EOF
Usage: ./deploy.sh [COMMAND]

Commands:
  all                Deploy backend + frontend to PRODUCTION (default)
  backend            Build & deploy backend to Cloud Run (production)
  frontend           Build & deploy frontend to Firebase Hosting (production)
  staging            Deploy backend + frontend to STAGING environment
  staging-backend    Deploy only backend to staging
  staging-frontend   Deploy only frontend to staging
  setup              One-time GCP project setup (APIs, Artifact Registry)

Environments:
  Production:  labaid-backend         → labaid.io        (Terraform-managed config)
  Staging:     labaid-backend-staging → staging.labaid.io (Terraform-managed config)

Terraform manages all Cloud Run service config (env vars, secrets, scaling, etc.).
This script only builds and pushes a new container image — matching CI/CD behavior.

CI/CD deploys automatically via GitHub Actions. This script is a manual fallback.

Environment variables:
  GCP_PROJECT          GCP project ID (default: labaid-prod)
  GCP_REGION           GCP region (default: us-central1)
EOF
  exit 0
}

# ─── Commands ─────────────────────────────────────────────────────────────────

setup() {
  info "Enabling required GCP APIs..."
  gcloud services enable \
    run.googleapis.com \
    sqladmin.googleapis.com \
    artifactregistry.googleapis.com \
    secretmanager.googleapis.com \
    storage.googleapis.com \
    cloudbuild.googleapis.com \
    --project="${GCP_PROJECT}"

  info "Creating Artifact Registry repository..."
  gcloud artifacts repositories create "${REPO_NAME}" \
    --repository-format=docker \
    --location="${GCP_REGION}" \
    --project="${GCP_PROJECT}" \
    2>/dev/null || info "Repository already exists"

  info "Configuring Docker auth for Artifact Registry..."
  gcloud auth configure-docker "${GCP_REGION}-docker.pkg.dev" --quiet

  ok "GCP setup complete"
}

deploy_backend() {
  local service_name="${1:-labaid-backend}"
  local image_tag="${2:-latest}"
  local image="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT}/${REPO_NAME}/backend:${image_tag}"

  info "Building backend Docker image (tag: ${image_tag})..."
  docker build \
    --platform linux/amd64 \
    -f backend/Dockerfile.prod \
    -t "${image}" \
    backend/

  info "Pushing image to Artifact Registry..."
  docker push "${image}"

  info "Updating Cloud Run image (${service_name})..."
  gcloud run services update "${service_name}" \
    --image "${image}" \
    --region "${GCP_REGION}" \
    --project="${GCP_PROJECT}"

  ok "Backend image updated (${service_name})"

  local backend_url
  backend_url=$(gcloud run services describe "${service_name}" \
    --region="${GCP_REGION}" \
    --project="${GCP_PROJECT}" \
    --format='value(status.url)')
  info "Backend URL: ${backend_url}"
  info "Health check: curl ${backend_url}/api/health"
}

deploy_frontend() {
  local site="${1:-labaid-prod}"

  info "Building frontend..."
  (cd frontend && npm ci && npm run build)

  info "Deploying to Firebase Hosting (${site})..."
  firebase deploy --only "hosting:${site}" --project="${GCP_PROJECT}"

  ok "Frontend deployed to ${site}.web.app"
}

# ─── Main ─────────────────────────────────────────────────────────────────────

COMMAND="${1:-all}"

case "${COMMAND}" in
  -h|--help|help) usage ;;
  setup)          setup ;;
  backend)        deploy_backend "labaid-backend" "latest" ;;
  frontend)       deploy_frontend "labaid-prod" ;;
  all)            deploy_backend "labaid-backend" "latest"
                  deploy_frontend "labaid-prod" ;;
  staging)        warn "Deploying to STAGING environment"
                  deploy_backend "labaid-backend-staging" "staging"
                  deploy_frontend "labaid-staging" ;;
  staging-backend) warn "Deploying backend to STAGING"
                  deploy_backend "labaid-backend-staging" "staging" ;;
  staging-frontend) warn "Deploying frontend to STAGING"
                  deploy_frontend "labaid-staging" ;;
  *)              fail "Unknown command: ${COMMAND}. Run './deploy.sh help' for usage." ;;
esac
