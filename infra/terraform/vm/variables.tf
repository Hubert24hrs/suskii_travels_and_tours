# Everything has a default but the project: the first deployment asks the owner for nothing else.

variable "project_id" {
  description = "The Google Cloud project that holds the backend."
  type        = string
}

variable "environment" {
  description = "Names the resources: suskii-<environment>-..."
  type        = string
  default     = "staging"
}

variable "region" {
  type    = string
  default = "europe-west2" # London: the main route out of Lagos (ADR-059)
}

variable "zone" {
  type    = string
  default = "europe-west2-a"
}

variable "machine_type" {
  description = "The VM's size. e2-medium (4 GB) holds the five containers with room to deploy; e2-small (2 GB) runs them on swap."
  type        = string
  default     = "e2-medium"
}

variable "boot_disk_gb" {
  description = "The system disk: the operating system and the images of the last releases."
  type        = number
  default     = 30
}

variable "data_disk_gb" {
  description = "The data disk: PostgreSQL, Redis and the certificate. It outlives the VM."
  type        = number
  default     = 20
}

variable "api_host" {
  description = "The API's own name once the owner has a domain (its DNS record points at the address in the outputs). Empty: Google's free name for the project, api.endpoints.<project>.cloud.goog."
  type        = string
  default     = ""
}

variable "hosts" {
  description = "The website's and the console's names, for links in messages and for CORS. Placeholders until they exist."
  type = object({
    web   = string
    admin = string
  })
  default = {
    web   = "suskii.example"
    admin = "admin.suskii.example"
  }
}

variable "assistant_enabled" {
  description = "AGENT_ENABLED on the API. False takes Ask Suskii out of the picture; nothing else changes."
  type        = bool
  default     = true
}

variable "assistant_model" {
  description = "What answers for Ask Suskii: gemini or anthropic with the key in LLM_API_KEY, or mock, the stand-in that calls no provider."
  type        = string
  default     = "mock"
  validation {
    condition     = contains(["gemini", "anthropic", "mock"], var.assistant_model)
    error_message = "Use gemini, anthropic or mock."
  }
}

variable "deletion_protection" {
  description = "Refuses to delete the VM. Turn off, apply, then destroy."
  type        = bool
  default     = true
}

variable "labels" {
  type    = map(string)
  default = {}
}
