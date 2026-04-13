terraform {
  required_version = ">= 1.5"

  required_providers {
    stripe = {
      source  = "lukasaron/stripe"
      version = "~> 3.4"
    }
  }

  # State isolated per environment via -backend-config at init time:
  #   terraform init -backend-config="prefix=stripe/staging"
  #   terraform init -backend-config="prefix=stripe/prod"
  backend "gcs" {
    bucket = "labaid-tfstate"
  }
}

provider "stripe" {
  api_key = var.stripe_api_key
}
