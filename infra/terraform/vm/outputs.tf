output "api_url" {
  description = "Where the API answers."
  value       = "https://${local.api_host}"
}

output "api_host" {
  value = local.api_host
}

output "sites" {
  description = "Whether the website and the console run on the machine."
  value       = var.sites
}

output "web_url" {
  value = "https://${local.web_host}"
}

output "admin_url" {
  value = "https://${local.admin_host}"
}

output "mailbox_url" {
  description = "A testing backend's mailbox (ADR-113), user suskii and the password in the secret MAILBOX_PASSWORD. Empty while it is off."
  value       = var.mailbox ? "https://${local.mail_host}" : ""
}

output "turnstile_site_key" {
  description = "Public by design: it is in every page that shows the widget."
  value       = var.turnstile_site_key
}

output "address" {
  description = "The VM's public address. With a domain of the owner's, the API's DNS record points here."
  value       = google_compute_address.backend.address
}

output "instance" {
  value = google_compute_instance.backend.name
}

output "zone" {
  value = var.zone
}

output "artifact_registry" {
  value = local.registry
}

output "documents_bucket" {
  value = google_storage_bucket.documents.name
}

output "backups_bucket" {
  value = google_storage_bucket.backups.name
}

output "documents_service_account" {
  description = "The storage-only identity whose HMAC key the API signs document requests with."
  value       = google_service_account.documents.email
}

output "vm_service_account" {
  value = google_service_account.vm.email
}
