# Every secret the services read, as Secret Manager secrets replicated in the region only.
# Terraform writes the values it generates (the two database URLs, REDIS_URL, REDIS_TLS_CA) as
# write-only data; the operator adds the rest with `gcloud secrets versions add` (README). Each service's
# identity can read only the secrets it uses.

locals {
  generated_secrets = concat(
    ["DATABASE_URL", "DATABASE_MIGRATION_URL", "REDIS_URL", "REDIS_TLS_CA"],
    var.deploy_agent ? ["AGENT_DATABASE_URL"] : [],
  )
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
  # What the agent service reads besides its database URL (ADR-101): the token the API presents
  # to start a run, the token it presents to the tool gateway, and the model provider's key. The
  # API reads the two tokens as well; it never reads the agent's database URL.
  agent_secrets = var.deploy_agent ? ["AGENT_RUN_TOKEN", "AGENT_TOOLS_TOKEN", "LLM_API_KEY"] : []
  secret_names = toset(concat(
    local.generated_secrets,
    local.operator_secrets,
    local.agent_secrets,
    var.extra_secrets,
  ))

  # The migrate job also sets the agent role's password, so it reads that URL too.
  migrate_secrets = concat(["DATABASE_URL", "DATABASE_MIGRATION_URL"], var.deploy_agent ? ["AGENT_DATABASE_URL"] : [])

  # Which service reads which secret (environment variable of the same name, except the migrate
  # job's, run.tf). Only the migrate job can act as the schema owner.
  secret_readers = merge(
    {
      api     = setsubtract(local.secret_names, ["DATABASE_MIGRATION_URL", "AGENT_DATABASE_URL"])
      worker  = toset(["REDIS_URL", "REDIS_TLS_CA", "INTERNAL_API_TOKEN"])
      migrate = toset(local.migrate_secrets)
    },
    {
      for service in local.agent_services :
      service => toset(concat(local.agent_secrets, ["AGENT_DATABASE_URL"]))
    },
  )
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
