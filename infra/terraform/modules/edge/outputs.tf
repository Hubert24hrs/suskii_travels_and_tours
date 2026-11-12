output "hosts" {
  description = "Proxied host names of this environment."
  value       = { for key, record in cloudflare_dns_record.hosts : key => record.name }
}
