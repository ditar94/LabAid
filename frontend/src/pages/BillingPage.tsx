import { lazy, Suspense, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { CreditCard, Calendar, Mail, Clock, Check } from "lucide-react";
import api from "../api/client";
import { useToast } from "../context/ToastContext";

const PaymentChoiceModal = lazy(() => import("../components/PaymentChoiceModal"));

interface BillingStatus {
  billing_status: string;
  trial_ends_at: string | null;
  has_subscription: boolean;
  billing_email: string | null;
  plan_name: string;
  current_period_start: number | null;
  current_period_end: number | null;
  subscribed_at: number | null;
  collection_method: string | null;
}

function formatDate(ts: number | null | undefined): string {
  if (!ts) return "-";
  return new Date(ts * 1000).toLocaleDateString();
}

function paymentMethodLabel(method: string | null | undefined): string {
  if (method === "send_invoice") return "Invoice (net-30)";
  if (method === "charge_automatically") return "Card (auto-charge)";
  return method || "-";
}

function statusLabel(status: string): string {
  if (status === "trial") return "Trial";
  if (status === "active") return "Active";
  if (status === "past_due") return "Past Due";
  if (status === "cancelled") return "Cancelled";
  return status;
}

function statusBadgeClass(status: string): string {
  if (status === "active") return "badge-success";
  if (status === "past_due") return "badge-warning";
  if (status === "cancelled") return "badge-danger";
  return "badge-info";
}

export default function BillingPage() {
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showModal, setShowModal] = useState(false);
  const [paymentProcessing, setPaymentProcessing] = useState(searchParams.get("billing") === "success");

  const { data: billing, isLoading } = useQuery<BillingStatus>({
    queryKey: ["billing-status"],
    queryFn: () => api.get("/labs/billing/status").then((r) => r.data),
    refetchInterval: paymentProcessing ? 3000 : false,
  });

  useEffect(() => {
    if (!paymentProcessing || !billing) return;
    if (billing.billing_status !== "trial") {
      setPaymentProcessing(false);
      setSearchParams({}, { replace: true });
      addToast("Payment confirmed! Your subscription is now active.", "success");
    }
  }, [billing, paymentProcessing]);

  useEffect(() => {
    if (!paymentProcessing) return;
    const timer = setTimeout(() => {
      setPaymentProcessing(false);
      setSearchParams({}, { replace: true });
      queryClient.invalidateQueries({ queryKey: ["billing-status"] });
    }, 30_000);
    return () => clearTimeout(timer);
  }, [paymentProcessing]);

  const handlePortal = async () => {
    try {
      const { data } = await api.post<{ url: string }>("/labs/billing/portal", {
        return_url: `${window.location.origin}/billing`,
      });
      window.location.href = data.url;
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Could not open billing portal.", "danger");
    }
  };

  const handleSubscribeSuccess = () => {
    addToast("Invoice subscription created! An invoice will be sent to your billing email.", "success");
    queryClient.invalidateQueries({ queryKey: ["billing-status"] });
  };

  if (isLoading) {
    return (
      <div>
        <div className="page-header"><h1>Billing</h1></div>
        <div className="skeleton" style={{ height: 200 }} />
      </div>
    );
  }

  if (!billing) {
    return (
      <div>
        <div className="page-header"><h1>Billing</h1></div>
        <p className="text-muted">Could not load billing information.</p>
      </div>
    );
  }

  const isTrial = billing.billing_status === "trial";
  const isActive = billing.billing_status === "active";
  const isPastDue = billing.billing_status === "past_due";
  const isCancelled = billing.billing_status === "cancelled";

  const trialExpired = isTrial && billing.trial_ends_at && new Date(billing.trial_ends_at) < new Date();
  const trialDaysLeft = isTrial && billing.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(billing.trial_ends_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;

  const features = [
    "Barcode scanning on any device",
    "Full vial lifecycle tracking",
    "Expiration tracking & alerts",
    "Visual storage grid mapping",
    "Immutable audit trail",
    "Compliance reports & PDF export",
    "QC document management",
    "Role-based access control",
    "Email support",
  ];

  return (
    <div>
      <div className="page-header">
        <h1>Billing</h1>
      </div>

      {paymentProcessing && (
        <div className="billing-message billing-message--info" style={{ marginBottom: 16 }}>
          <span className="spinner" style={{ marginRight: 8 }} />
          <span>Processing your payment... This may take a moment.</span>
        </div>
      )}

      <div className="billing-layout">
        {/* Trial / Cancelled — pricing card */}
        {(isTrial || isCancelled) && (
          <div className="card billing-plan-card">
            <div className="billing-plan-header">
              <div>
                <div className="billing-plan-name">
                  LabAid Standard
                  <span className={`badge ${statusBadgeClass(billing.billing_status)}`}>
                    {statusLabel(billing.billing_status)}
                  </span>
                </div>
                <div className="billing-plan-price">
                  <span className="billing-plan-amount">$350</span>
                  <span className="billing-plan-period">/month</span>
                </div>
                <div className="billing-plan-billed">$4,200 billed annually &middot; Unlimited users</div>
              </div>
            </div>

            <ul className="billing-plan-features">
              {features.map((f) => (
                <li key={f}>
                  <Check size={16} className="billing-plan-check" />
                  {f}
                </li>
              ))}
            </ul>

            <div className="billing-plan-cta">
              <button className="btn-primary billing-plan-btn" onClick={() => setShowModal(true)}>
                {isCancelled ? "Reactivate Subscription" : "Subscribe Now"}
              </button>
            </div>

            {isTrial && (
              <div className="billing-message billing-message--info" style={{ marginTop: 16 }}>
                <Clock size={16} />
                <span>
                  {trialExpired
                    ? "Your free trial has expired. Subscribe to continue using LabAid."
                    : trialDaysLeft !== null
                      ? `${trialDaysLeft} day${trialDaysLeft !== 1 ? "s" : ""} remaining in your free trial${billing.trial_ends_at ? ` (ends ${new Date(billing.trial_ends_at).toLocaleDateString()})` : ""}.`
                      : "You're on a free trial. Subscribe to unlock uninterrupted access."}
                </span>
              </div>
            )}
            {isCancelled && (
              <div className="billing-message billing-message--danger" style={{ marginTop: 16 }}>
                <Clock size={16} />
                <span>Your subscription has been cancelled. Reactivate to restore full access.</span>
              </div>
            )}
          </div>
        )}

        {/* Active / Past Due — details card */}
        {(isActive || isPastDue) && (
          <div className="card billing-plan-card">
            <div className="billing-plan-header">
              <div>
                <div className="billing-plan-name">
                  {billing.plan_name}
                  <span className={`badge ${statusBadgeClass(billing.billing_status)}`}>
                    {statusLabel(billing.billing_status)}
                  </span>
                </div>
              </div>
              <button className="btn-primary" onClick={handlePortal}>
                {isPastDue ? "Update Payment" : "Manage Billing"}
              </button>
            </div>

            {isPastDue && (
              <div className="billing-message billing-message--warning">
                <Clock size={16} />
                <span>Your payment is past due. Please update your payment method to avoid service interruption.</span>
              </div>
            )}

            <div className="billing-details-grid" style={{ marginTop: 20 }}>
              {billing.subscribed_at && (
                <div className="billing-detail">
                  <Calendar size={16} className="billing-detail-icon" />
                  <div>
                    <div className="billing-detail-label">Subscribed Since</div>
                    <div className="billing-detail-value">{formatDate(billing.subscribed_at)}</div>
                  </div>
                </div>
              )}
              <div className="billing-detail">
                <Calendar size={16} className="billing-detail-icon" />
                <div>
                  <div className="billing-detail-label">Current Period</div>
                  <div className="billing-detail-value">{formatDate(billing.current_period_start)} &ndash; {formatDate(billing.current_period_end)}</div>
                </div>
              </div>
              {billing.current_period_end && (
                <div className="billing-detail">
                  <Clock size={16} className="billing-detail-icon" />
                  <div>
                    <div className="billing-detail-label">Next Payment</div>
                    <div className="billing-detail-value">{formatDate(billing.current_period_end)}</div>
                  </div>
                </div>
              )}
              <div className="billing-detail">
                <CreditCard size={16} className="billing-detail-icon" />
                <div>
                  <div className="billing-detail-label">Payment Method</div>
                  <div className="billing-detail-value">{paymentMethodLabel(billing.collection_method)}</div>
                </div>
              </div>
              {billing.billing_email && (
                <div className="billing-detail">
                  <Mail size={16} className="billing-detail-icon" />
                  <div>
                    <div className="billing-detail-label">Billing Email</div>
                    <div className="billing-detail-value">{billing.billing_email}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {showModal && (
        <Suspense fallback={null}>
          <PaymentChoiceModal onClose={() => setShowModal(false)} onSuccess={handleSubscribeSuccess} />
        </Suspense>
      )}
    </div>
  );
}
