# Everything has a default but the project: the first deployment asks the owner for nothing else.
# Secrets never go here: they live in Secret Manager (scripts/gcp/deploy-backend.sh).

variable "project_id" {
  description = "The Google Cloud project that holds this backend. Billing must be on."
  type        = string
}

variable "environment" {
  description = "staging until real providers and a domain exist; names every resource."
  type        = string
  default     = "staging"
}

variable "region" {
  type    = string
  default = "europe-west2" # London: the main route out of Lagos (ADR-059)
}

variable "hosts" {
  description = <<-EOT
    Where the website and the console will live once the domain exists. The API puts the
    website's address in the links of its emails and allows these origins to call it from a
    browser. Placeholders are fine while only the app uses this backend.
  EOT
  type = object({
    web   = string
    api   = string
    admin = string
  })
  default = {
    web   = "suskii.example"
    api   = "api.suskii.example"
    admin = "admin.suskii.example"
  }
}

variable "github_repository" {
  type    = string
  default = "Hubert24hrs/suskii_travels_and_tours"
}

variable "deploy_services" {
  description = "False for the first apply (foundations), true once the secrets have values."
  type        = bool
  default     = false
}

variable "deploy_agent" {
  description = "Creates the agent service, Ask Suskii's own (ADR-101), beside the API and the worker."
  type        = bool
  default     = true
}

variable "agent_url" {
  description = "The agent service's address (the agent_internal_url output), once it exists."
  type        = string
  default     = ""
}

variable "assistant_enabled" {
  description = <<-EOT
    AGENT_ENABLED: whether the clients offer Ask Suskii. Turning it off is the fastest way to
    take the assistant out of the picture; nothing else on the platform changes.
  EOT
  type        = bool
  default     = true
}

variable "assistant_model" {
  description = <<-EOT
    AGENT_MODEL_PROVIDER: gemini (needs LLM_API_KEY in Secret Manager, the Gemini API key),
    anthropic, or mock, which calls no provider and says one fixed sentence.
  EOT
  type        = string
  default     = "mock"
  validation {
    condition     = contains(["gemini", "anthropic", "mock"], var.assistant_model)
    error_message = "assistant_model must be gemini, anthropic or mock."
  }
}

variable "allow_mock_providers" {
  type    = bool
  default = true
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
  default = {
    tier                = "db-custom-1-3840"
    availability_type   = "ZONAL"
    disk_size_gb        = 20
    backup_retention    = 7
    log_retention_days  = 7
    deletion_protection = true
  }
}

variable "cache" {
  type = object({
    tier           = string
    memory_size_gb = number
  })
  default = {
    tier           = "BASIC"
    memory_size_gb = 1
  }
}

variable "scaling" {
  type = map(object({
    min = number
    max = number
  }))
  default = {
    api    = { min = 1, max = 3 } # one warm instance: the app's first call does not wait
    worker = { min = 1, max = 1 }
    web    = { min = 0, max = 1 } # not created without the edge
    admin  = { min = 0, max = 1 }
    agent  = { min = 0, max = 2 } # starts on the first conversation
  }
}

variable "api_env" {
  description = "Extra or replacement API settings (never secrets)."
  type        = map(string)
  default     = {}
}

variable "worker_env" {
  type    = map(string)
  default = {}
}

variable "agent_env" {
  description = "Extra or replacement settings of the agent service (never secrets)."
  type        = map(string)
  default     = {}
}

variable "extra_secrets" {
  description = "Names of further API secrets, as real providers are connected."
  type        = list(string)
  default     = []
}

variable "labels" {
  type    = map(string)
  default = {}
}
