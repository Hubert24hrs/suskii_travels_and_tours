variable "zone_id" {
  description = <<-EOT
    Cloudflare zone of this environment. Each environment has its own zone (ADR-059): zone settings
    and phase rulesets are zone-wide, so two environments sharing one zone would overwrite each other.
  EOT
  type        = string
}

variable "hosts" {
  description = "Public host names (in this zone) served by the environment."
  type = object({
    web   = string
    api   = string
    admin = string
  })
}

variable "redirect_hosts" {
  description = "Extra host names redirected permanently to the website (for example www)."
  type        = list(string)
  default     = []
}

variable "origin_ip" {
  description = "Load balancer address (platform output load_balancer_ip)."
  type        = string
}

variable "dns_authorizations" {
  description = "Certificate Manager CNAMEs for the origin certificate (platform output dns_authorizations)."
  type = map(object({
    name = string
    type = string
    data = string
  }))
}

variable "origin_auth_secret" {
  description = "Value Cloudflare sets in x-suskii-origin-auth; the same as the platform's."
  type        = string
  sensitive   = true
}

variable "admin_allowed_ips" {
  description = <<-EOT
    Addresses or CIDR ranges allowed to reach the console and the admin API (office or VPN egress,
    the same as ADMIN_IP_ALLOWLIST). Empty means no edge restriction; the API still applies its own.
  EOT
  type        = list(string)
  default     = []
}

variable "managed_waf" {
  description = "Run the Cloudflare Managed and OWASP Core rulesets (needs the Pro plan or higher)."
  type        = bool
  default     = true
}

variable "auth_rate_limit" {
  description = "Requests per 10 seconds from one address to the sign-in, sign-up and recovery routes."
  type        = number
  default     = 30
}
