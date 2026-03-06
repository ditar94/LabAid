import { useState } from "react";
import { FileText } from "lucide-react";
import { Modal } from "./Modal";
import { useAuth } from "../context/AuthContext";
import api from "../api/client";

interface SwitchToInvoiceModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export default function SwitchToInvoiceModal({ onClose, onSuccess }: SwitchToInvoiceModalProps) {
  const { user } = useAuth();
  const [billingEmail, setBillingEmail] = useState(user?.email || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      await api.patch("/labs/billing/payment-method", { billing_email: billingEmail });
      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Could not switch payment method.");
      setLoading(false);
    }
  };

  return (
    <Modal onClose={onClose} ariaLabel="Switch to invoice billing">
      <div className="modal-content" style={{ maxWidth: 480 }}>
        <h2><FileText size={20} style={{ verticalAlign: -3, marginRight: 6 }} />Switch to Invoice Billing</h2>
        <p className="text-muted" style={{ margin: "8px 0 16px" }}>
          Your subscription will switch to net-30 invoice billing. Future charges will be invoiced instead of charged to your card.
        </p>
        <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
          <label className="form-label" style={{ marginBottom: 4 }}>Billing Email</label>
          <input
            type="email"
            className="form-input"
            value={billingEmail}
            onChange={(e) => setBillingEmail(e.target.value)}
            required
            autoFocus
          />
          {error && <div className="form-error" style={{ marginTop: 12 }}>{error}</div>}
          <div style={{ marginTop: 16, display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={loading || !billingEmail}>
              {loading ? <>Switching... <span className="spinner" /></> : "Switch to Invoice"}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
