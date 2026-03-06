import { useState } from "react";
import { CreditCard, FileText, ArrowLeft, Check } from "lucide-react";
import { Modal } from "./Modal";
import { useAuth } from "../context/AuthContext";
import api from "../api/client";

type PlanTier = "standard" | "enterprise";
type ModalStep = "tier" | "choice" | "invoice-email";

interface PaymentChoiceModalProps {
  onClose: () => void;
  onSuccess?: () => void;
  skipTierSelection?: boolean;
}

const PLAN_INFO: Record<PlanTier, { name: string; price: string; annual: string; features: string[] }> = {
  standard: {
    name: "LabAid Standard",
    price: "$350/mo",
    annual: "$4,200/year",
    features: [
      "Barcode scanning on any device",
      "Full vial lifecycle tracking",
      "Expiration tracking & alerts",
      "Visual storage grid mapping",
      "Immutable audit trail",
      "Compliance reports & PDF export",
      "Role-based access control",
      "Email support",
    ],
  },
  enterprise: {
    name: "LabAid Enterprise",
    price: "$700/mo",
    annual: "$8,400/year",
    features: [
      "Everything in Standard",
      "SSO / SAML authentication",
      "Dedicated onboarding",
      "Priority support",
      "Custom integrations",
    ],
  },
};

export default function PaymentChoiceModal({ onClose, onSuccess, skipTierSelection }: PaymentChoiceModalProps) {
  const { user, labSettings } = useAuth();
  const isTrial = labSettings?.billing_status === "trial";
  const invoiceBlocked = labSettings?.cancellation_reason === "invoice_uncollectible";
  const [loading, setLoading] = useState<"card" | "invoice" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<ModalStep>(skipTierSelection ? "choice" : "tier");
  const [planTier, setPlanTier] = useState<PlanTier>("standard");
  const [invoiceEmail, setInvoiceEmail] = useState(user?.email || "");

  const handleCard = async () => {
    setLoading("card");
    setError(null);
    try {
      const { data } = await api.post<{ url: string }>("/labs/billing/checkout", {
        success_url: `${window.location.origin}/billing?billing=success`,
        cancel_url: `${window.location.origin}/billing`,
        plan_tier: skipTierSelection ? undefined : planTier,
      });
      window.location.href = data.url;
    } catch (err: any) {
      setError(err.response?.data?.detail || "Could not start checkout. Please try again.");
      setLoading(null);
    }
  };

  const handleInvoice = async () => {
    setLoading("invoice");
    setError(null);
    try {
      await api.post("/labs/billing/invoice", {
        billing_email: invoiceEmail,
        plan_tier: skipTierSelection ? undefined : planTier,
      });
      onSuccess?.();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Could not create invoice subscription. Please try again.");
      setLoading(null);
    }
  };

  const selectedPlan = PLAN_INFO[planTier];
  const enterpriseAvailable = true; // Could gate on a config flag if needed

  return (
    <Modal onClose={onClose} ariaLabel="Choose payment method">
      <div className="modal-content" style={{ maxWidth: step === "tier" ? 580 : 480 }}>
        {step === "tier" && (
          <>
            <h2>Choose Your Plan</h2>
            <p className="text-muted" style={{ margin: "8px 0 20px" }}>
              Select a plan to reactivate your subscription.
            </p>
            <div className="plan-selector">
              {(["standard", "enterprise"] as PlanTier[]).map((tier) => {
                const plan = PLAN_INFO[tier];
                const disabled = tier === "enterprise" && !enterpriseAvailable;
                return (
                  <button
                    key={tier}
                    className={`plan-option${planTier === tier ? " plan-option--selected" : ""}`}
                    onClick={() => !disabled && setPlanTier(tier)}
                    disabled={disabled}
                    type="button"
                  >
                    <strong>{plan.name}</strong>
                    <div className="plan-option-price">{plan.price}</div>
                    <div className="text-muted" style={{ fontSize: "var(--text-sm)" }}>{plan.annual}</div>
                    <ul className="plan-option-features">
                      {plan.features.map((f) => (
                        <li key={f}><Check size={14} /> {f}</li>
                      ))}
                    </ul>
                  </button>
                );
              })}
            </div>
            {error && <div className="form-error" style={{ marginTop: 12 }}>{error}</div>}
            <div style={{ marginTop: 16, display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn-primary" onClick={() => { setStep("choice"); setError(null); }}>
                Continue
              </button>
            </div>
          </>
        )}

        {step === "choice" && (
          <>
            <h2>Choose Payment Method</h2>
            {!skipTierSelection && (
              <p className="text-muted" style={{ margin: "8px 0 4px", fontWeight: 500 }}>
                {selectedPlan.name} &middot; {selectedPlan.annual}
              </p>
            )}
            <p className="text-muted" style={{ margin: "8px 0 20px" }}>
              Select how you'd like to pay for your LabAid subscription.
            </p>
            <div className="payment-options">
              <button
                className="payment-option"
                onClick={handleCard}
                disabled={loading !== null}
              >
                <CreditCard size={28} />
                <strong>Pay Now</strong>
                <span className="text-muted">
                  {isTrial
                    ? "Pay by credit or debit card. Your trial will end and billing starts immediately."
                    : "Pay by credit or debit card via Stripe's secure checkout."}
                </span>
                {loading === "card" && <span className="spinner" />}
              </button>
              <button
                className="payment-option"
                onClick={() => { setStep("invoice-email"); setError(null); }}
                disabled={loading !== null || invoiceBlocked}
              >
                <FileText size={28} />
                <strong>Pay by Invoice</strong>
                <span className="text-muted">
                  {invoiceBlocked
                    ? "Unavailable — a previous invoice was not paid."
                    : isTrial
                      ? "Receive a net-30 invoice. Billing starts immediately."
                      : "Receive a net-30 invoice. Pay by card, ACH, or check."}
                </span>
              </button>
            </div>
            {error && <div className="form-error" style={{ marginTop: 12 }}>{error}</div>}
            <div style={{ marginTop: 16, display: "flex", gap: 8, justifyContent: "flex-end" }}>
              {!skipTierSelection && (
                <button
                  className="btn-secondary"
                  onClick={() => { setStep("tier"); setError(null); }}
                  disabled={loading !== null}
                >
                  <ArrowLeft size={16} /> Back
                </button>
              )}
              <button className="btn-secondary" onClick={onClose} disabled={loading !== null}>Cancel</button>
            </div>
          </>
        )}

        {step === "invoice-email" && (
          <>
            <h2>Confirm Billing Email</h2>
            <p className="text-muted" style={{ margin: "8px 0 16px" }}>
              We'll send the invoice to this email address.
            </p>
            <form onSubmit={(e) => { e.preventDefault(); handleInvoice(); }}>
              <input
                type="email"
                className="form-input"
                value={invoiceEmail}
                onChange={(e) => setInvoiceEmail(e.target.value)}
                required
                autoFocus
              />
              {error && <div className="form-error" style={{ marginTop: 12 }}>{error}</div>}
              <div style={{ marginTop: 16, display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => { setStep("choice"); setError(null); }}
                  disabled={loading !== null}
                >
                  <ArrowLeft size={16} /> Back
                </button>
                <button type="submit" className="btn-primary" disabled={loading !== null || !invoiceEmail}>
                  Send Invoice {loading === "invoice" && <span className="spinner" />}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </Modal>
  );
}
