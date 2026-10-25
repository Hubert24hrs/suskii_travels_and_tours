# Images by digest (ADR-058): tags are immutable, so a tag always names the image that was scanned
# and signed; untagged and old images are cleaned up.

resource "google_artifact_registry_repository" "images" {
  project       = var.project_id
  location      = var.region
  repository_id = "suskii"
  format        = "DOCKER"
  description   = "Suskii ${var.environment} images"
  labels        = local.labels

  docker_config {
    immutable_tags = true
  }

  cleanup_policies {
    id     = "delete-untagged"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "604800s"
    }
  }

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 30
    }
  }

  depends_on = [google_project_service.apis]
}
