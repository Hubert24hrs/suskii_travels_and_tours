variable "project_id" {
  description = "GCP project of this environment (one project per environment)."
  type        = string
}

variable "environment" {
  description = "staging or production."
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "region" {
  description = "Region for every regional resource (Cloud Run, Cloud SQL, Memorystore, GCS, secrets)."
  type        = string
}

variable "hosts" {
  description = "Public host names served behind Cloudflare and the load balancer."
  type = object({
    web   = string
    api   = string
    admin = string
  })
}

variable "github_repository" {
  description = "owner/name of the repository whose workflows may deploy (Workload Identity Federation)."
  type        = string
}

variable "github_environment" {
  description = "GitHub environment whose jobs may deploy here (its protection rules apply)."
  type        = string
}

variable "deploy_services" {
  description = <<-EOT
    False for the first apply: foundations only (network, database, cache, bucket, registry, secret
    containers, identities). Add the secret values and push the first images, then apply with true
    to create the Cloud Run services, the migration job and the load balancer.
  EOT
  type        = bool
  default     = false
}

variable "images" {
  description = <<-EOT
    Initial images for the services and the migration job. The pipelines deploy new revisions
    afterwards; Terraform ignores image changes so it never rolls a deployment back.
  EOT
  type = object({
    api     = string
    migrate = string
    worker  = string
    web     = string
    admin   = string
  })
  default = {
    api     = "us-docker.pkg.dev/cloudrun/container/hello"
    migrate = "us-docker.pkg.dev/cloudrun/container/hello"
    worker  = "us-docker.pkg.dev/cloudrun/container/hello"
    web     = "us-docker.pkg.dev/cloudrun/container/hello"
    admin   = "us-docker.pkg.dev/cloudrun/container/hello"
  }
}

variable "database" {
  description = "Cloud SQL sizing and protection."
  type = object({
    tier                = string
    availability_type   = string # ZONAL (staging) or REGIONAL (production)
    disk_size_gb        = number
    backup_retention    = number # automated backups kept
    log_retention_days  = number # point-in-time recovery window
    deletion_protection = bool
  })
}

variable "database_password_version" {
  description = <<-EOT
    Increase to generate new passwords for both database roles (written only, never stored in
    state). The migrator's changes at once; the app role's when the next migrate job runs, so
    deploy straight after the apply (infra/terraform/README.md).
  EOT
  type        = number
  default     = 1
}

variable "cache" {
  description = "Memorystore sizing: BASIC (staging) or STANDARD_HA (production)."
  type = object({
    tier           = string
    memory_size_gb = number
  })
}

variable "scaling" {
  description = "Instance limits per service."
  type = map(object({
    min = number
    max = number
  }))
  default = {
    api    = { min = 1, max = 10 }
    worker = { min = 1, max = 2 }
    web    = { min = 1, max = 10 }
    admin  = { min = 0, max = 2 }
  }
}

variable "api_env" {
  description = <<-EOT
    Extra non-secret API settings: provider choices and business settings (FLIGHT_SUPPLIERS,
    PAYMENT_PROVIDERS, CARS_*_ENABLED, ...). Secrets never go here; list their names in
    extra_secrets.
  EOT
  type        = map(string)
  default     = {}
  validation {
    # Secrets belong in Secret Manager (extra_secrets): a plain value shows in the console and state.
    condition = alltrue([
      for key in keys(var.api_env) :
      !can(regex("(SECRET|TOKEN|PASSWORD|PRIVATE|HMAC|ENCRYPTION_KEY$|ENCRYPTION_PREVIOUS_KEYS|_HASH$|_KEY$|_APP_ID$)", key))
    ])
    error_message = "api_env must not hold secrets; add their names to extra_secrets and set the values in Secret Manager."
  }
}

variable "extra_secrets" {
  description = "Names of additional API secrets (PAYSTACK_SECRET_KEY, DUFFEL_API_TOKEN, SMTP_PASSWORD, ...)."
  type        = list(string)
  default     = []
}

variable "allow_mock_providers" {
  description = "Staging escape hatch (ALLOW_MOCK_PROVIDERS): mock suppliers and payments in a production build."
  type        = bool
  default     = false
}

variable "origin_auth_secret" {
  description = <<-EOT
    Shared value Cloudflare adds to every request it forwards (header x-suskii-origin-auth) and
    Cloud Armor requires, so only this zone's Cloudflare traffic reaches the origin, not another
    Cloudflare account pointed at the load balancer. 32+ random characters, rotated with the edge.
  EOT
  type        = string
  sensitive   = true
  validation {
    condition     = can(regex("^[A-Za-z0-9_-]{32,128}$", var.origin_auth_secret))
    error_message = "origin_auth_secret must be 32 to 128 URL-safe characters."
  }
}

variable "cloudflare_ip_ranges" {
  description = "Cloudflare egress ranges allowed through Cloud Armor (https://www.cloudflare.com/ips/)."
  type        = list(string)
  default = [
    "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
    "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
    "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
    "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
    "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32",
    "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
  ]
}

variable "labels" {
  description = "Labels added to every resource that takes them."
  type        = map(string)
  default     = {}
}

variable "worker_env" {
  description = "Extra non-secret worker settings (refresh intervals, SENTRY_DSN, ...)."
  type        = map(string)
  default     = {}
}

variable "web_env" {
  description = "Runtime settings of the website server (MOBILE_ANDROID_PACKAGE, MOBILE_IOS_APP_IDS, ...)."
  type        = map(string)
  default     = {}
}

variable "log_retention_days" {
  description = "Days Cloud Logging keeps application and request logs (_Default bucket; over 30 is billed)."
  type        = number
  default     = 30
}

variable "registry_readers" {
  description = <<-EOT
    IAM members allowed to pull from this environment's image repository. Staging lists the
    production deployer, so a release promotes the exact images staging tested (by digest).
  EOT
  type        = list(string)
  default     = []
}
