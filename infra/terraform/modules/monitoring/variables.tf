variable "project_id" {
  description = "GCP project of the environment; the checks and alert policies live there."
  type        = string
}

variable "environment" {
  description = "staging or production; part of every display name."
  type        = string
}

variable "hosts" {
  description = "Public host names, checked through the Cloudflare edge as travellers reach them."
  type = object({
    web   = string
    api   = string
    admin = string
  })
}

variable "regions" {
  description = "Checker regions (Cloud Monitoring needs at least three). Africa has none yet."
  type        = list(string)
  default     = ["EUROPE", "USA", "ASIA_PACIFIC"]
  validation {
    condition     = length(var.regions) >= 3
    error_message = "Cloud Monitoring needs at least three checker regions."
  }
}

variable "alert_emails" {
  description = "Addresses told when a check fails from two regions (an email channel each)."
  type        = list(string)
  default     = []
}

variable "notification_channels" {
  description = "Existing notification channel ids (PagerDuty, Opsgenie, SMS) told as well."
  type        = list(string)
  default     = []
}

variable "labels" {
  description = "User labels on the alert policies."
  type        = map(string)
  default     = {}
}
