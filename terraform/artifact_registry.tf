resource "google_artifact_registry_repository" "labaid" {
  location      = var.region
  repository_id = "labaid"
  format        = "DOCKER"
  description   = "LabAid Docker images"

  depends_on = [google_project_service.apis]
}
