# One identity per service with only what it needs, and a deployer for GitHub Actions through
# Workload Identity Federation: no service account keys exist. Only workflows of this repository
# running in the matching GitHub environment (with its protection rules) can deploy here.

resource "google_service_account" "runtime" {
  for_each     = toset(["api", "worker", "web", "admin", "migrate"])
  project      = var.project_id
  account_id   = "${local.name}-${each.value}"
  display_name = "Suskii ${var.environment} ${each.value}"
}

resource "google_project_iam_member" "sql_clients" {
  for_each = toset(["api", "migrate"])
  project  = var.project_id
  role     = "roles/cloudsql.client"
  member   = google_service_account.runtime[each.value].member
}

resource "google_project_iam_member" "telemetry" {
  for_each = {
    for pair in setproduct(["api", "worker", "web", "admin", "migrate"], ["roles/logging.logWriter", "roles/monitoring.metricWriter", "roles/cloudtrace.agent"]) :
    "${pair[0]}/${pair[1]}" => { service = pair[0], role = pair[1] }
  }
  project = var.project_id
  role    = each.value.role
  member  = google_service_account.runtime[each.value.service].member
}

resource "google_service_account" "deployer" {
  project      = var.project_id
  account_id   = "${local.name}-deployer"
  display_name = "Suskii ${var.environment} deployer (GitHub Actions)"
}

# Deploy revisions and run jobs; read request metrics for the canary gate (ADR-060).
resource "google_project_iam_member" "deployer" {
  for_each = toset(["roles/run.developer", "roles/monitoring.viewer"])
  project  = var.project_id
  role     = each.value
  member   = google_service_account.deployer.member
}

resource "google_artifact_registry_repository_iam_member" "deployer" {
  project    = var.project_id
  location   = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.writer"
  member     = google_service_account.deployer.member
}

# Deploying a revision that runs as a runtime identity needs permission to act as it.
resource "google_service_account_iam_member" "deployer_acts_as" {
  for_each           = google_service_account.runtime
  service_account_id = each.value.name
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.deployer.member
}

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
  depends_on                = [google_project_service.apis]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-actions"
  display_name                       = "GitHub Actions OIDC"
  attribute_mapping = {
    "google.subject"         = "assertion.sub"
    "attribute.repository"   = "assertion.repository"
    "attribute.environment"  = "assertion.environment"
    "attribute.workflow_ref" = "assertion.job_workflow_ref"
  }
  attribute_condition = "assertion.repository == '${var.github_repository}' && assertion.environment == '${var.github_environment}'"
  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "deployer_federation" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.environment/${var.github_environment}"
}
