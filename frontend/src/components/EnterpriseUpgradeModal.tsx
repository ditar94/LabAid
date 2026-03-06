import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Modal } from "./Modal";
import api from "../api/client";

interface UpgradePreview {
  amount_due: number;
  currency: string;
  proration_credit: number;
  proration_charge: number;
  current_tier: string;
  target_tier: string;
}

interface EnterpriseUpgradeModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function EnterpriseUpgradeModal({ onClose, onSuccess }: EnterpriseUpgradeModalProps) {
  const [preview, setPreview] = useState<UpgradePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.post<UpgradePreview>("/labs/billing/upgrade/preview")
      .then(({ data }) => setPreview(data))
      .catch((err) => setError(err.response?.data?.detail || "Could not load upgrade details."))
      .finally(() => setLoading(false));
  }, []);

  const handleConfirm = async () => {
    setConfirming(true);
    setError(null);
    try {
      await api.post("/labs/billing/upgrade/confirm");
      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Could not complete upgrade. Please try again.");
      setConfirming(false);
    }
  };

  return (
    <Modal onClose={onClose} ariaLabel="Upgrade to Enterprise">
      <div className="modal-content" style={{ maxWidth: 480 }}>
        <h2><Sparkles size={20} style={{ verticalAlign: -3, marginRight: 6 }} />Upgrade to Enterprise</h2>

        {loading && (
          <div style={{ padding: "24px 0", textAlign: "center" }}>
            <span className="spinner" /> Loading upgrade details...
          </div>
        )}

        {!loading && error && !preview && (
          <>
            <div className="form-error" style={{ marginTop: 12 }}>{error}</div>
            <div style={{ marginTop: 16, textAlign: "right" }}>
              <button className="btn-secondary" onClick={onClose}>Close</button>
            </div>
          </>
        )}

        {!loading && preview && (
          <>
            <p className="text-muted" style={{ margin: "8px 0 16px" }}>
              Your plan will be upgraded immediately. The prorated difference will be charged to your current payment method.
            </p>

            <div className="upgrade-preview">
              <div className="upgrade-preview-row">
                <span>Credit for unused Standard time</span>
                <span className="text-success">-{formatCents(preview.proration_credit)}</span>
              </div>
              <div className="upgrade-preview-row">
                <span>Enterprise (prorated)</span>
                <span>{formatCents(preview.proration_charge)}</span>
              </div>
              <div className="upgrade-preview-row upgrade-preview-total">
                <strong>Due today</strong>
                <strong>{formatCents(preview.amount_due)}</strong>
              </div>
            </div>

            <p className="text-muted" style={{ fontSize: "0.85em", marginTop: 12 }}>
              At your next renewal, you'll be billed $8,400/year for LabAid Enterprise.
            </p>

            {error && <div className="form-error" style={{ marginTop: 12 }}>{error}</div>}

            <div style={{ marginTop: 16, display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn-secondary" onClick={onClose} disabled={confirming}>Cancel</button>
              <button className="btn-primary" onClick={handleConfirm} disabled={confirming}>
                {confirming ? <>Upgrading... <span className="spinner" /></> : "Confirm Upgrade"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
