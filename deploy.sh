#!/usr/bin/env bash
set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────
# Override these with environment variables or edit directly.

GCP_PROJECT="${GCP_PROJECT:-labaid-prod}"
GCP_REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-labaid-backend}"
REPO_NAME="${REPO_NAME:-labaid}"
CLOUD_SQL_INSTANCE="${CLOUD_SQL_INSTANCE:-${GCP_PROJECT}:${GCP_REGION}:labaid-db}"
IMAGE="us-central1-docker.pkg.dev/${GCP_PROJECT}/${REPO_NAME}/backend:latest"

# ─── Helpers ──────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
fail()  { echo -e "${RED}[FAIL]${NC} $*"; exit 1; }

usage() {
  cat <<EOF
Usage: ./deploy.sh [COMMAND]

Commands:
  all         Deploy backend + frontend (default)
  backend     Build & deploy backend to Cloud Run
  frontend    Build & deploy frontend to Firebase Hosting
  setup       One-time GCP project setup (APIs, Artifact Registry)

Environment variables:
  GCP_PROJECT          GCP project ID (default: labaid-prod)
  GCP_REGION           GCP region (default: us-central1)
  SERVICE_NAME         Cloud Run service name (default: labaid-backend)
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
  info "Building backend Docker image..."
  docker build \
    --platform linux/amd64 \
    -f backend/Dockerfile.prod \
    -t "${IMAGE}" \
    backend/

  info "Pushing image to Artifact Registry..."
  docker push "${IMAGE}"

  info "Deploying to Cloud Run..."
  gcloud run deploy "${SERVICE_NAME}" \
    --image "${IMAGE}" \
    --region "${GCP_REGION}" \
    --platform managed \
    --allow-unauthenticated \
    --add-cloudsql-instances "${CLOUD_SQL_INSTANCE}" \
    --set-env-vars "COOKIE_SECURE=True,COOKIE_SAMESITE=lax,S3_ENDPOINT_URL=https://storage.googleapis.com,S3_USE_PATH_STYLE=False,GCP_PROJECT=${GCP_PROJECT}" \
    --set-secrets "SECRET_KEY=SECRET_KEY:latest,DATABASE_URL=DATABASE_URL:latest,S3_ACCESS_KEY=S3_ACCESS_KEY:latest,S3_SECRET_KEY=S3_SECRET_KEY:latest,S3_BUCKET=S3_BUCKET:latest,CORS_ORIGINS=CORS_ORIGINS:latest,COOKIE_DOMAIN=COOKIE_DOMAIN:latest" \
    --memory 512Mi \
    --cpu 1 \
    --min-instances 0 \
    --max-instances 3 \
    --port 8080 \
    --project="${GCP_PROJECT}"

  ok "Backend deployed to Cloud Run"

  BACKEND_URL=$(gcloud run services describe "${SERVICE_NAME}" \
    --region="${GCP_REGION}" \
    --project="${GCP_PROJECT}" \
    --format='value(status.url)')
  info "Backend URL: ${BACKEND_URL}"
  info "Health check: curl ${BACKEND_URL}/api/health"
}

deploy_frontend() {
  info "Building frontend..."
  (cd frontend && npm ci && npm run build)

  info "Deploying to Firebase Hosting..."
  firebase deploy --only hosting --project="${GCP_PROJECT}"

  ok "Frontend deployed to Firebase Hosting"
}

# ─── Main ─────────────────────────────────────────────────────────────────────

COMMAND="${1:-all}"

case "${COMMAND}" in
  -h|--help|help) usage ;;
  setup)    setup ;;
  backend)  deploy_backend ;;
  frontend) deploy_frontend ;;
  all)      deploy_backend; deploy_frontend ;;
  *)        fail "Unknown command: ${COMMAND}. Run './deploy.sh help' for usage." ;;
esac
