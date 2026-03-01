import { useState } from "react";
import { CreditCard, FileText } from "lucide-react";
import { Modal } from "./Modal";
import api from "../api/client";

interface PaymentChoiceModalProps {
  onClose: () => void;
  onSuccess?: () => void;
}

export default function PaymentChoiceModal({ onClose, onSuccess }: PaymentChoiceModalProps) {
  const [loading, setLoading] = useState<"card" | "invoice" | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      await api.post("/labs/billing/invoice");
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
            onClick={handleInvoice}
            disabled={loading !== null}
          >
            <FileText size={28} />
            <strong>Pay by Invoice</strong>
            <span className="text-muted">Receive a net-30 invoice. Pay by card, ACH, or check.</span>
            {loading === "invoice" && <span className="spinner" />}
          </button>
        </div>
        {error && <div className="form-error" style={{ marginTop: 12 }}>{error}</div>}
        <div style={{ marginTop: 16, textAlign: "right" }}>
          <button className="btn-secondary" onClick={onClose} disabled={loading !== null}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}
