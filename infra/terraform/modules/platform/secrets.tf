# Every secret the services read, as Secret Manager secrets replicated in the region only.
# Terraform writes the values it generates (the two database URLs, REDIS_URL, REDIS_TLS_CA) as
# write-only data; the operator adds the rest with `gcloud secrets versions add` (README). Each service's
# identity can read only the secrets it uses.

locals {
  generated_secrets = ["DATABASE_URL", "DATABASE_MIGRATION_URL", "REDIS_URL", "REDIS_TLS_CA"]
  operator_secrets = [
    "JWT_PRIVATE_KEY",
    "JWT_PUBLIC_KEY",
    "FIELD_ENCRYPTION_KEY",
    "HMAC_SECRET",
    "INTERNAL_API_TOKEN",
    "TURNSTILE_SECRET_KEY",
    "CARS_TICKET_SIGNING_KEY",
    "OBJECT_STORAGE_ACCESS_KEY_ID",
    "OBJECT_STORAGE_SECRET_ACCESS_KEY",
  ]
  secret_names = toset(concat(local.generated_secrets, local.operator_secrets, var.extra_secrets))

  # Which service reads which secret (environment variable of the same name, except the migrate
  # job's, run.tf). Only the migrate job can act as the schema owner.
  secret_readers = {
    api     = setsubtract(local.secret_names, ["DATABASE_MIGRATION_URL"])
    worker  = toset(["REDIS_URL", "REDIS_TLS_CA", "INTERNAL_API_TOKEN"])
    migrate = toset(["DATABASE_URL", "DATABASE_MIGRATION_URL"])
  }
  secret_grants = merge([
    for service, names in local.secret_readers : {
      for name in names : "${service}/${name}" => { service = service, name = name }
    }
  ]...)
}

resource "google_secret_manager_secret" "app" {
  for_each  = local.secret_names
  project   = var.project_id
  secret_id = each.value
  labels    = local.labels

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_iam_member" "readers" {
  for_each  = local.secret_grants
  project   = var.project_id
  secret_id = google_secret_manager_secret.app[each.value.name].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.runtime[each.value.service].member
}

# Every read of a secret value is logged (Data Access audit logs), so an unexpected reader of a key
# shows up in Cloud Logging with its identity.
resource "google_project_iam_audit_config" "secret_access" {
  project = var.project_id
  service = "secretmanager.googleapis.com"
  audit_log_config {
    log_type = "DATA_READ"
  }
  audit_log_config {
    log_type = "ADMIN_READ"
  }
}
