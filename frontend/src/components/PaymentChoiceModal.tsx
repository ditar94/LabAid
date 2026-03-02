import { useState } from "react";
import { CreditCard, FileText, ArrowLeft } from "lucide-react";
import { Modal } from "./Modal";
import { useAuth } from "../context/AuthContext";
import api from "../api/client";

interface PaymentChoiceModalProps {
  onClose: () => void;
  onSuccess?: () => void;
}

export default function PaymentChoiceModal({ onClose, onSuccess }: PaymentChoiceModalProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState<"card" | "invoice" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"choice" | "invoice-email">("choice");
  const [invoiceEmail, setInvoiceEmail] = useState(user?.email || "");

  const handleCard = async () => {
    setLoading("card");
    setError(null);
    try {
      const { data } = await api.post<{ url: string }>("/labs/billing/checkout", {
        success_url: `${window.location.origin}/billing?billing=success`,
        cancel_url: `${window.location.origin}/billing`,
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
      await api.post("/labs/billing/invoice", { billing_email: invoiceEmail });
      onSuccess?.();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Could not create invoice subscription. Please try again.");
      setLoading(null);
    }
  };

  return (
    <Modal onClose={onClose} ariaLabel="Choose payment method">
      <div className="modal-content" style={{ maxWidth: 480 }}>
        {step === "choice" && (
          <>
            <h2>Choose Payment Method</h2>
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
                <span className="text-muted">Pay by credit or debit card via Stripe's secure checkout.</span>
                {loading === "card" && <span className="spinner" />}
              </button>
              <button
                className="payment-option"
                onClick={() => { setStep("invoice-email"); setError(null); }}
                disabled={loading !== null}
              >
                <FileText size={28} />
                <strong>Pay by Invoice</strong>
                <span className="text-muted">Receive a net-30 invoice. Pay by card, ACH, or check.</span>
              </button>
            </div>
            {error && <div className="form-error" style={{ marginTop: 12 }}>{error}</div>}
            <div style={{ marginTop: 16, textAlign: "right" }}>
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
