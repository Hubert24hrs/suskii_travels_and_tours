terraform {
  required_version = ">= 1.11"

  # State in the project's own bucket (scripts/gcp/deploy-vm.sh creates it):
  #   terraform init -backend-config="bucket=<project>-tfstate" -backend-config="prefix=suskii/vm"
  backend "gcs" {}

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.6"
    }
  }
}
