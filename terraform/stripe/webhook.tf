# Stripe webhook endpoint — managed per environment.
# Ensures staging and production subscribe to the exact same events.

resource "stripe_webhook_endpoint" "api" {
  url = var.webhook_url

  enabled_events = [
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed",
    "invoice.paid",
    "invoice.payment_succeeded",
    "invoice.payment_failed",
    "invoice.overdue",
    "invoice.marked_uncollectible",
    "invoice.sent",
    "invoice.upcoming",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "customer.subscription.trial_will_end",
    "charge.dispute.created",
    "customer.updated",
  ]
}
