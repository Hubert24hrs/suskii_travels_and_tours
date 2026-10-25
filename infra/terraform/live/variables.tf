# See ../environments/<environment>.tfvars.example. Secrets never go in tfvars: the origin secret
# comes from TF_VAR_origin_auth_secret and application secrets from Secret Manager.

variable "project_id" {
  type = string
}

variable "environment" {
  type = string
}

variable "region" {
  type    = string
  default = "europe-west2" # London: the main route out of Lagos (ADR-059)
}

variable "hosts" {
  type = object({
    web   = string
    api   = string
    admin = string
  })
}

variable "redirect_hosts" {
  type    = list(string)
  default = []
}

variable "github_repository" {
  type    = string
  default = "Hubert24hrs/suskii_travels_and_tours"
}

variable "deploy_services" {
  type    = bool
  default = false
}

variable "images" {
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
  type = object({
    tier                = string
    availability_type   = string
    disk_size_gb        = number
    backup_retention    = number
    log_retention_days  = number
    deletion_protection = bool
  })
}

variable "database_password_version" {
  type    = number
  default = 1
}

variable "cache" {
  type = object({
    tier           = string
    memory_size_gb = number
  })
}

variable "scaling" {
  type = map(object({
    min = number
    max = number
  }))
}

variable "api_env" {
  type    = map(string)
  default = {}
}

variable "worker_env" {
  type    = map(string)
  default = {}
}

variable "web_env" {
  type    = map(string)
  default = {}
}

variable "extra_secrets" {
  type    = list(string)
  default = []
}

variable "allow_mock_providers" {
  type    = bool
  default = false
}

variable "origin_auth_secret" {
  type      = string
  sensitive = true
}

variable "cloudflare_zone_id" {
  type = string
}

variable "admin_allowed_ips" {
  type    = list(string)
  default = []
}

variable "managed_waf" {
  type    = bool
  default = true
}

variable "labels" {
  type    = map(string)
  default = {}
}
