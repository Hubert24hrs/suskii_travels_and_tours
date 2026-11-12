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

variable "sites" {
  description = "Run the website and the admin console on the machine too. Off: the backend alone, and their names are placeholders in links and CORS."
  type        = bool
  default     = true
}

variable "web_host" {
  description = "The website's own name once the owner has a domain. Empty: web.endpoints.<project>.cloud.goog."
  type        = string
  default     = ""
}

variable "admin_host" {
  description = "The console's own name once the owner has a domain. Empty: admin.endpoints.<project>.cloud.goog."
  type        = string
  default     = ""
}

variable "turnstile_site_key" {
  description = "The public key of the website's Turnstile widget, built into the website's image by the deploy script. Empty: the forms it protects stay closed. Its secret goes in the secret TURNSTILE_SECRET_KEY."
  type        = string
  default     = ""
}

variable "sample_catalogue" {
  description = "A testing backend only: sample packages, tours, add-ons, visa products, a Prime plan, buses and rental cars, every row marked as a sample, with buses and car rental switched on. Refused in an environment named production."
  type        = bool
  default     = false
}

variable "mailbox" {
  description = "A testing backend only (ADR-113): every email the API sends lands in a mailbox on the machine and goes no further, read at mail.endpoints.<project>.cloud.goog with the password in the secret MAILBOX_PASSWORD. Refused in an environment named production."
  type        = bool
  default     = false
}

variable "assistant_enabled" {
  description = "AGENT_ENABLED on the API. False takes Ask Suskii out of the picture; nothing else changes."
  type        = bool
  default     = true
}

variable "assistant_model" {
  description = "What answers for Ask Suskii: vertex (Gemini on Vertex AI as the machine's own identity, no key, ADR-112), gemini or anthropic with the key in LLM_API_KEY, or mock, the stand-in that calls no provider."
  type        = string
  default     = "mock"
  validation {
    condition     = contains(["vertex", "gemini", "anthropic", "mock"], var.assistant_model)
    error_message = "Use vertex, gemini, anthropic or mock."
  }
}

variable "assistant_location" {
  description = "With vertex: where Vertex AI processes the assistant's requests, a region or global. Empty: the machine's own region."
  type        = string
  default     = ""
  validation {
    condition     = var.assistant_location == "" || can(regex("^(global|[a-z]+-[a-z]+[0-9]+)$", var.assistant_location))
    error_message = "Use a region such as europe-west2, or global."
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
