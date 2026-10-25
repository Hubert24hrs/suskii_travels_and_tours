variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "name" {
  description = "Cloud Run service name."
  type        = string
}

variable "image" {
  description = "Image of the first revision; the pipelines deploy later ones (ignored afterwards)."
  type        = string
}

variable "service_account" {
  description = "Email of the identity the revision runs as."
  type        = string
}

variable "ingress" {
  description = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER (behind the load balancer) or INGRESS_TRAFFIC_INTERNAL_ONLY."
  type        = string
  validation {
    condition     = contains(["INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER", "INGRESS_TRAFFIC_INTERNAL_ONLY"], var.ingress)
    error_message = "Services are never directly public: use the load balancer or internal ingress."
  }
}

variable "public" {
  description = "Served to anonymous callers through the load balancer (no invoker IAM check)."
  type        = bool
}

variable "env" {
  description = "Plain environment variables (never secrets)."
  type        = map(string)
  default     = {}
}

variable "secrets" {
  description = "Secret Manager secret ids exposed as environment variables of the same name."
  type        = set(string)
  default     = []
}

variable "min_instances" {
  type = number
}

variable "max_instances" {
  type = number
}

variable "cpu" {
  type    = string
  default = "1"
}

variable "memory" {
  type    = string
  default = "1Gi"
}

variable "always_on_cpu" {
  description = "Keep CPU allocated between requests (background work such as the worker's queues)."
  type        = bool
  default     = false
}

variable "concurrency" {
  description = "Requests per instance."
  type        = number
  default     = 80
}

variable "request_timeout" {
  description = "Longest request, including WebSocket connections (ride updates reconnect after it)."
  type        = string
  default     = "300s"
}

variable "startup_path" {
  description = "Path that answers 200 once the instance can serve traffic."
  type        = string
}

variable "liveness_path" {
  description = "Path that answers 200 while the process is healthy."
  type        = string
}

variable "cloud_sql_instance" {
  description = "Connection name of a Cloud SQL instance to mount at /cloudsql, or null."
  type        = string
  default     = null
}

variable "network" {
  description = "VPC, subnet and firewall tags for Direct VPC egress (all traffic leaves through the VPC)."
  type = object({
    network    = string
    subnetwork = string
    tags       = list(string)
  })
}

variable "labels" {
  type    = map(string)
  default = {}
}

variable "deletion_protection" {
  type    = bool
  default = true
}
