import { lazy, Suspense, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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

export default function BillingPage() {
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);

  const { data: billing, isLoading } = useQuery<BillingStatus>({
    queryKey: ["billing-status"],
    queryFn: () => api.get("/labs/billing/status").then((r) => r.data),
  });

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

  return (
    <div>
      <div className="page-header">
        <h1>Billing</h1>
      </div>

      <div className="card" style={{ maxWidth: 640 }}>
        {/* Status badge */}
        <div style={{ marginBottom: 20 }}>
          <span className={`badge ${isActive ? "badge-success" : isPastDue ? "badge-warning" : isCancelled ? "badge-danger" : "badge-info"}`}>
            {isActive ? "Active" : isPastDue ? "Past Due" : isCancelled ? "Cancelled" : "Trial"}
          </span>
        </div>

        {/* Trial state */}
        {isTrial && (
          <>
            <div className="setting-row">
              <div className="setting-label">
                <div className="setting-title">Trial Status</div>
                <div className="setting-desc">
                  {trialExpired
                    ? "Your free trial has expired."
                    : trialDaysLeft !== null
                      ? `${trialDaysLeft} day${trialDaysLeft !== 1 ? "s" : ""} remaining`
                      : "Free trial"}
                </div>
              </div>
            </div>
            {billing.trial_ends_at && (
              <div className="setting-row">
                <div className="setting-label">
                  <div className="setting-title">Trial Ends</div>
                  <div className="setting-desc">{new Date(billing.trial_ends_at).toLocaleDateString()}</div>
                </div>
              </div>
            )}
            <div style={{ marginTop: 16 }}>
              <button className="btn-primary" onClick={() => setShowModal(true)}>Subscribe</button>
            </div>
          </>
        )}

        {/* Active state */}
        {isActive && (
          <>
            <div className="setting-row">
              <div className="setting-label">
                <div className="setting-title">Plan</div>
                <div className="setting-desc">{billing.plan_name}</div>
              </div>
            </div>
            {billing.subscribed_at && (
              <div className="setting-row">
                <div className="setting-label">
                  <div className="setting-title">Subscribed Since</div>
                  <div className="setting-desc">{formatDate(billing.subscribed_at)}</div>
                </div>
              </div>
            )}
            <div className="setting-row">
              <div className="setting-label">
                <div className="setting-title">Current Period</div>
                <div className="setting-desc">{formatDate(billing.current_period_start)} &ndash; {formatDate(billing.current_period_end)}</div>
              </div>
            </div>
            {billing.current_period_end && (
              <div className="setting-row">
                <div className="setting-label">
                  <div className="setting-title">Next Payment Due</div>
                  <div className="setting-desc">{formatDate(billing.current_period_end)}</div>
                </div>
              </div>
            )}
            <div className="setting-row">
              <div className="setting-label">
                <div className="setting-title">Payment Method</div>
                <div className="setting-desc">{paymentMethodLabel(billing.collection_method)}</div>
              </div>
            </div>
            {billing.billing_email && (
              <div className="setting-row">
                <div className="setting-label">
                  <div className="setting-title">Billing Email</div>
                  <div className="setting-desc">{billing.billing_email}</div>
                </div>
              </div>
            )}
            <div style={{ marginTop: 16 }}>
              <button className="btn-primary" onClick={handlePortal}>Manage Billing</button>
            </div>
          </>
        )}

        {/* Past due state */}
        {isPastDue && (
          <>
            <div className="setting-row">
              <div className="setting-label">
                <div className="setting-title">Payment Past Due</div>
                <div className="setting-desc">Your payment is past due. Please update your payment method to avoid service interruption.</div>
              </div>
            </div>
            <div style={{ marginTop: 16 }}>
              <button className="btn-primary" onClick={handlePortal}>Update Payment</button>
            </div>
          </>
        )}

        {/* Cancelled state */}
        {isCancelled && (
          <>
            <div className="setting-row">
              <div className="setting-label">
                <div className="setting-title">Account Cancelled</div>
                <div className="setting-desc">Your subscription has been cancelled. Subscribe again to restore full access.</div>
              </div>
            </div>
            <div style={{ marginTop: 16 }}>
              <button className="btn-primary" onClick={() => setShowModal(true)}>Reactivate</button>
            </div>
          </>
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
