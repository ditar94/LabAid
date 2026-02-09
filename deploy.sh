#!/usr/bin/env bash
set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────
# Override these with environment variables or edit directly.

GCP_PROJECT="${GCP_PROJECT:-labaid-prod}"
GCP_REGION="${GCP_REGION:-us-central1}"
REPO_NAME="${REPO_NAME:-labaid}"
CLOUD_SQL_INSTANCE="${CLOUD_SQL_INSTANCE:-${GCP_PROJECT}:${GCP_REGION}:labaid-db}"

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
  all         Deploy backend + frontend to PRODUCTION (default)
  backend     Build & deploy backend to Cloud Run (production)
  frontend    Build & deploy frontend to Firebase Hosting (production)
  beta        Build & deploy backend + frontend to BETA environment
  beta-backend   Deploy only backend to beta
  beta-frontend  Deploy only frontend to beta
  setup       One-time GCP project setup (APIs, Artifact Registry)

Environments:
  Production:  labaid-backend  → labaid-prod.web.app
  Beta:        labaid-backend-beta → labaid-beta.web.app

Environment variables:
  GCP_PROJECT          GCP project ID (default: labaid-prod)
  GCP_REGION           GCP region (default: us-central1)
  CLOUD_SQL_INSTANCE   Cloud SQL instance connection name
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
  local db_secret="${2:-DATABASE_URL}"
  local image_tag="${3:-latest}"
  local max_instances="${4:-3}"
  local image="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT}/${REPO_NAME}/backend:${image_tag}"

  info "Building backend Docker image (tag: ${image_tag})..."
  docker build \
    --platform linux/amd64 \
    -f backend/Dockerfile.prod \
    -t "${image}" \
    backend/

  info "Pushing image to Artifact Registry..."
  docker push "${image}"

  info "Deploying to Cloud Run (${service_name})..."
  gcloud run deploy "${service_name}" \
    --image "${image}" \
    --region "${GCP_REGION}" \
    --platform managed \
    --allow-unauthenticated \
    --add-cloudsql-instances "${CLOUD_SQL_INSTANCE}" \
    --set-env-vars "COOKIE_SECURE=True,COOKIE_SAMESITE=lax,S3_ENDPOINT_URL=https://storage.googleapis.com,S3_USE_PATH_STYLE=False,GCP_PROJECT=${GCP_PROJECT}" \
    --set-secrets "SECRET_KEY=SECRET_KEY:latest,DATABASE_URL=${db_secret}:latest,S3_ACCESS_KEY=S3_ACCESS_KEY:latest,S3_SECRET_KEY=S3_SECRET_KEY:latest,S3_BUCKET=S3_BUCKET:latest,CORS_ORIGINS=CORS_ORIGINS:latest,COOKIE_DOMAIN=COOKIE_DOMAIN:latest" \
    --memory 512Mi \
    --cpu 1 \
    --min-instances 0 \
    --max-instances "${max_instances}" \
    --port 8080 \
    --project="${GCP_PROJECT}"

  ok "Backend deployed to Cloud Run (${service_name})"

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
  backend)        deploy_backend "labaid-backend" "DATABASE_URL" "latest" "3" ;;
  frontend)       deploy_frontend "labaid-prod" ;;
  all)            deploy_backend "labaid-backend" "DATABASE_URL" "latest" "3"
                  deploy_frontend "labaid-prod" ;;
  beta)           warn "Deploying to BETA environment"
                  deploy_backend "labaid-backend-beta" "DATABASE_URL_BETA" "beta" "1"
                  deploy_frontend "labaid-beta" ;;
  beta-backend)   warn "Deploying backend to BETA"
                  deploy_backend "labaid-backend-beta" "DATABASE_URL_BETA" "beta" "1" ;;
  beta-frontend)  warn "Deploying frontend to BETA"
                  deploy_frontend "labaid-beta" ;;
  *)              fail "Unknown command: ${COMMAND}. Run './deploy.sh help' for usage." ;;
esac
