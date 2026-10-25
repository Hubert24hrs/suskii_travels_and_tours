terraform {
  required_version = ">= 1.11"

  # State per environment in its own project's bucket (README, bootstrap):
  #   terraform init -backend-config=../environments/<environment>.gcs.tfbackend
  backend "gcs" {}

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.6"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.9"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.27"
    }
  }
}
