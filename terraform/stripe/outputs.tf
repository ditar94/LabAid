output "webhook_signing_secret" {
  description = "Stripe webhook signing secret — store in GCP Secret Manager"
  value       = stripe_webhook_endpoint.api.secret
  sensitive   = true
}

output "webhook_endpoint_id" {
  description = "Stripe webhook endpoint ID"
  value       = stripe_webhook_endpoint.api.id
}
