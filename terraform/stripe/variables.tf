variable "stripe_api_key" {
  description = "Stripe API key (test key for staging, live key for production)"
  type        = string
  sensitive   = true
}

variable "webhook_url" {
  description = "Full URL for the Stripe webhook endpoint (e.g. https://staging.labaid.io/api/stripe/webhook)"
  type        = string
}
