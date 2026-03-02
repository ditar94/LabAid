# ── Cloud Scheduler Service Account ──────────────────────────────────────────

resource "google_service_account" "scheduler" {
  account_id   = "cloud-scheduler"
  display_name = "Cloud Scheduler"
  description  = "Service account for Cloud Scheduler jobs"
}

# ── Scheduled Jobs ──────────────────────────────────────────────────────────

resource "google_cloud_scheduler_job" "stripe_cleanup" {
  name        = "stripe-event-cleanup"
  description = "Clean up processed Stripe events older than 30 days"
  schedule    = "0 3 * * 0" # Every Sunday at 3 AM
  time_zone   = "America/New_York"
  region      = var.region

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.backend.uri}/api/internal/stripe-cleanup"

    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience              = google_cloud_run_v2_service.backend.uri
    }
  }

  retry_config {
    retry_count          = 3
    min_backoff_duration = "5s"
    max_backoff_duration = "300s"
  }

  depends_on = [google_project_service.apis]
}
