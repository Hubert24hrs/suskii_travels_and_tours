# The backend on one Compute Engine VM (ADR-111): the budget shape. The same release images as
# everywhere else (the API, the worker, the agent service) run in containers beside PostgreSQL,
# Redis and Caddy, on one machine with one public address. Keys stay in Secret Manager; data on
# a disk of its own that outlives the machine; a dump of the database goes to a bucket nightly.
#
# What it gives up against `backend/` and `live/`: no second machine, no managed database, no
# load balancer, no WAF. Moving up later is a data copy and a change of address, not of code.
#
# Applied by scripts/gcp/deploy-vm.sh, as the owner.

provider "google" {
  project = var.project_id
  region  = var.region
  zone    = var.zone
}

locals {
  prefix   = "suskii-${var.environment}"
  api_host = var.api_host != "" ? var.api_host : "api.endpoints.${var.project_id}.cloud.goog"
  # With the website and the console off, their names are placeholders nothing answers on.
  web_host = var.web_host != "" ? var.web_host : (
    var.sites ? "web.endpoints.${var.project_id}.cloud.goog" : "suskii.example"
  )
  admin_host = var.admin_host != "" ? var.admin_host : (
    var.sites ? "admin.endpoints.${var.project_id}.cloud.goog" : "admin.suskii.example"
  )
  # Google's free names for the address, one for each name the owner has not given.
  free_names = merge(
    var.sites && var.web_host == "" ? { web = local.web_host } : {},
    var.sites && var.admin_host == "" ? { admin = local.admin_host } : {},
  )
  registry = "${var.region}-docker.pkg.dev/${var.project_id}/suskii"
  labels   = merge({ app = "suskii", environment = var.environment, managed_by = "terraform" }, var.labels)

  apis = toset([
    # Ask Suskii's model, Gemini on Vertex AI (ADR-112), called only while assistant_model is vertex.
    "aiplatform.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "compute.googleapis.com",
    "endpoints.googleapis.com",
    "iam.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "secretmanager.googleapis.com",
    "servicecontrol.googleapis.com",
    "servicemanagement.googleapis.com",
    "storage.googleapis.com",
  ])

  # Containers only: scripts/gcp/seed-secrets.mjs gives each its value, the VM reads them.
  secrets = toset([
    "AGENT_RUN_TOKEN",
    "AGENT_TOOLS_TOKEN",
    "CARS_TICKET_SIGNING_KEY",
    "FIELD_ENCRYPTION_KEY",
    "HMAC_SECRET",
    "INTERNAL_API_TOKEN",
    "JWT_PRIVATE_KEY",
    "JWT_PUBLIC_KEY",
    "LLM_API_KEY",
    "OBJECT_STORAGE_ACCESS_KEY_ID",
    "OBJECT_STORAGE_SECRET_ACCESS_KEY",
    "POSTGRES_AGENT_PASSWORD",
    "POSTGRES_APP_PASSWORD",
    "POSTGRES_OWNER_PASSWORD",
    "REDIS_PASSWORD",
    "TURNSTILE_SECRET_KEY",
  ])
}

resource "google_project_service" "apis" {
  for_each           = local.apis
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# --- Network: one subnet, the web ports open, SSH only through Google's own tunnel --------------

resource "google_compute_network" "vpc" {
  project                 = var.project_id
  name                    = "${local.prefix}-vm"
  auto_create_subnetworks = false
  depends_on              = [google_project_service.apis]
}

resource "google_compute_subnetwork" "vm" {
  project                  = var.project_id
  name                     = "${local.prefix}-vm"
  region                   = var.region
  network                  = google_compute_network.vpc.id
  ip_cidr_range            = "10.30.0.0/24"
  private_ip_google_access = true
}

resource "google_compute_firewall" "web" {
  project       = var.project_id
  name          = "${local.prefix}-vm-web"
  network       = google_compute_network.vpc.id
  description   = "HTTPS for the API, and port 80 for the certificate and the redirect."
  direction     = "INGRESS"
  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["suskii-backend"]

  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }
  allow {
    protocol = "udp"
    ports    = ["443"]
  }
}

resource "google_compute_firewall" "iap_ssh" {
  project       = var.project_id
  name          = "${local.prefix}-vm-iap-ssh"
  network       = google_compute_network.vpc.id
  description   = "SSH only through Identity-Aware Proxy, for people the project lets in."
  direction     = "INGRESS"
  source_ranges = ["35.235.240.0/20"]
  target_tags   = ["suskii-backend"]

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}

resource "google_compute_address" "backend" {
  project    = var.project_id
  name       = "${local.prefix}-backend"
  region     = var.region
  labels     = local.labels
  depends_on = [google_project_service.apis]
}

# Google's free name for the address, until the owner has a domain.
resource "google_endpoints_service" "api_host" {
  count        = var.api_host == "" ? 1 : 0
  project      = var.project_id
  service_name = local.api_host
  openapi_config = yamlencode({
    swagger = "2.0"
    info    = { title = "Suskii API address", version = "1.0.0" }
    host    = local.api_host
    paths   = {}
    "x-google-endpoints" = [{
      name   = local.api_host
      target = google_compute_address.backend.address
    }]
  })
  depends_on = [google_project_service.apis]
}

resource "google_endpoints_service" "site_host" {
  for_each     = local.free_names
  project      = var.project_id
  service_name = each.value
  openapi_config = yamlencode({
    swagger = "2.0"
    info    = { title = "Suskii ${each.key} address", version = "1.0.0" }
    host    = each.value
    paths   = {}
    "x-google-endpoints" = [{
      name   = each.value
      target = google_compute_address.backend.address
    }]
  })
  depends_on = [google_project_service.apis]
}

# --- Identities: the VM's, and a storage-only one for documents --------------------------------

resource "google_service_account" "vm" {
  project      = var.project_id
  account_id   = "${local.prefix}-vm"
  display_name = "Suskii backend VM (${var.environment})"
  depends_on   = [google_project_service.apis]
}

resource "google_service_account" "documents" {
  project      = var.project_id
  account_id   = "${local.prefix}-documents"
  display_name = "Suskii documents bucket access (${var.environment})"
  depends_on   = [google_project_service.apis]
}

resource "google_project_iam_member" "vm" {
  for_each = toset(["roles/logging.logWriter", "roles/monitoring.metricWriter"])
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.vm.email}"
}

# Ask Suskii's model (ADR-112): one permission, to call a model on Vertex AI, and nothing else of
# Vertex AI (no datasets, endpoints, training or tuning). The machine holds it only while the
# assistant answers with Vertex AI; scripts/gcp/deploy-vm.sh also gives it to the build identity,
# which runs the evals against the model (infra/gcp/cloudbuild.agent-eval.yaml).
resource "google_project_iam_custom_role" "model_caller" {
  project     = var.project_id
  role_id     = "suskiiModelCaller"
  title       = "Suskii model caller"
  description = "Calls a model on Vertex AI for Ask Suskii, and nothing else (ADR-112)."
  permissions = ["aiplatform.endpoints.predict"]
  depends_on  = [google_project_service.apis]
}

resource "google_project_iam_member" "vm_model_caller" {
  count   = var.assistant_model == "vertex" ? 1 : 0
  project = var.project_id
  role    = google_project_iam_custom_role.model_caller.id
  member  = "serviceAccount:${google_service_account.vm.email}"
}

# --- Images -------------------------------------------------------------------------------------

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
    id     = "delete-old-releases"
    action = "DELETE"
    condition {
      tag_state  = "TAGGED"
      older_than = "2592000s"
    }
  }

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 5
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_artifact_registry_repository_iam_member" "vm" {
  project    = var.project_id
  location   = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.vm.email}"
}

# --- Buckets: documents, and the nightly database dumps -----------------------------------------

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

  depends_on = [google_project_service.apis]
}

resource "google_storage_bucket_iam_member" "documents" {
  bucket = google_storage_bucket.documents.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.documents.email}"
}

resource "google_storage_bucket" "backups" {
  project                     = var.project_id
  name                        = "${var.project_id}-backups"
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = local.labels

  lifecycle_rule {
    condition {
      age = 30
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.apis]
}

# The VM may add a dump. It cannot read, replace or delete one.
resource "google_storage_bucket_iam_member" "backups" {
  bucket = google_storage_bucket.backups.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.vm.email}"
}

# --- Secrets: the containers, with no value here ------------------------------------------------

resource "google_secret_manager_secret" "this" {
  for_each  = local.secrets
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

resource "google_secret_manager_secret_iam_member" "vm" {
  for_each  = local.secrets
  project   = var.project_id
  secret_id = google_secret_manager_secret.this[each.value].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.vm.email}"
}

# --- The machine --------------------------------------------------------------------------------

resource "google_compute_disk" "data" {
  project = var.project_id
  name    = "${local.prefix}-backend-data"
  zone    = var.zone
  type    = "pd-balanced"
  size    = var.data_disk_gb
  labels  = local.labels

  depends_on = [google_project_service.apis]
}

# Trivy flags a machine with a public address (GCP-0031). Here it is the design: the one
# machine is its own front door, because the load balancer that would stand in front of it
# costs about as much again (ADR-111). What faces the internet is Caddy on ports 80 and 443;
# SSH is reachable through Identity-Aware Proxy only. The expiry makes the scan fail again, so
# the move to the managed shape behind a load balancer is looked at by then.
#trivy:ignore:GCP-0031:exp:2027-04-30
resource "google_compute_instance" "backend" {
  project                   = var.project_id
  name                      = "${local.prefix}-backend"
  zone                      = var.zone
  machine_type              = var.machine_type
  tags                      = ["suskii-backend"]
  labels                    = local.labels
  deletion_protection       = var.deletion_protection
  allow_stopping_for_update = true

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
      size  = var.boot_disk_gb
      type  = "pd-balanced"
    }
  }

  attached_disk {
    source      = google_compute_disk.data.id
    device_name = "suskii-data"
  }

  network_interface {
    subnetwork = google_compute_subnetwork.vm.id
    access_config {
      nat_ip = google_compute_address.backend.address
    }
  }

  service_account {
    email  = google_service_account.vm.email
    scopes = ["cloud-platform"]
  }

  shielded_instance_config {
    enable_secure_boot          = true
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }

  # The stack's files travel as metadata, so a change reaches the machine without a login and
  # without replacing it. None holds a secret. `suskii-release` (the image tag to run) is set
  # by the deploy script.
  metadata = {
    enable-oslogin          = "TRUE"
    enable-guest-attributes = "TRUE"
    block-project-ssh-keys  = "TRUE"
    startup-script          = file("${path.module}/../../gcp/vm/startup.sh")
    suskii-compose          = file("${path.module}/../../gcp/vm/compose.yml")
    suskii-caddyfile        = file("${path.module}/../../gcp/vm/Caddyfile")
    suskii-caddyfile-sites  = file("${path.module}/../../gcp/vm/Caddyfile.sites")
    suskii-deploy           = file("${path.module}/../../gcp/vm/deploy.sh")
    suskii-backup           = file("${path.module}/../../gcp/vm/backup.sh")
    suskii-settings = jsonencode({
      project_id         = var.project_id
      environment        = var.environment
      registry           = local.registry
      api_host           = local.api_host
      sites              = var.sites
      web_host           = local.web_host
      admin_host         = local.admin_host
      documents_bucket   = google_storage_bucket.documents.name
      backups_bucket     = google_storage_bucket.backups.name
      assistant_enabled  = var.assistant_enabled
      assistant_model    = var.assistant_model
      assistant_location = var.assistant_location != "" ? var.assistant_location : var.region
      sample_catalogue   = var.sample_catalogue
    })
  }

  lifecycle {
    precondition {
      condition     = !(var.sample_catalogue && var.environment == "production")
      error_message = "Sample inventory never goes into production: turn sample_catalogue off."
    }
    ignore_changes = [
      metadata["suskii-release"],
      boot_disk[0].initialize_params[0].image,
    ]
  }

  depends_on = [
    google_project_iam_member.vm,
    google_artifact_registry_repository_iam_member.vm,
    google_secret_manager_secret_iam_member.vm,
  ]
}
