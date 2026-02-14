output "cloud_run_url" {
  description = "Cloud Run service URL"
  value       = google_cloud_run_v2_service.backend.uri
}

output "wif_provider" {
  description = "Workload Identity Federation provider resource name"
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "github_sa_email" {
  description = "GitHub Actions service account email"
  value       = google_service_account.github_actions.email
}
