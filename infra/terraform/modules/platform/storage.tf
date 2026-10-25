# Private documents bucket for tickets, vouchers and uploads (ADR-057): uniform access, public
# access prevented, versioned with old versions pruned. The API reaches it through the S3 API with
# an HMAC key of a storage-only identity. That key is created out of band (README) so its secret
# never enters the Terraform state.

resource "google_storage_bucket" "documents" {
  project                     = var.project_id
  name                        = "${var.project_id}-documents"
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = local.labels

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      days_since_noncurrent_time = 30
    }
    action {
      type = "Delete"
    }
  }

  soft_delete_policy {
    retention_duration_seconds = 604800
  }
}

resource "google_service_account" "documents" {
  project      = var.project_id
  account_id   = "${local.name}-documents"
  display_name = "Suskii ${var.environment} documents (S3 HMAC key only)"
}

resource "google_storage_bucket_iam_member" "documents" {
  bucket = google_storage_bucket.documents.name
  role   = "roles/storage.objectUser"
  member = google_service_account.documents.member
}
