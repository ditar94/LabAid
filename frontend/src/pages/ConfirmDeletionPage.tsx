import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import { AlertTriangle } from "lucide-react";

export default function ConfirmDeletionPage() {
  const { user, labSettings, labName, logout } = useAuth();
  const navigate = useNavigate();
  const [confirmText, setConfirmText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!labSettings.deletion_requested_at) {
    return (
      <div className="login-container">
        <div className="login-card" style={{ textAlign: "center" }}>
          <h2>No Pending Deletion</h2>
          <p style={{ color: "#6b7280", margin: "16px 0" }}>
            There is no pending deletion request for your lab.
          </p>
          <button className="login-submit" onClick={() => navigate("/dashboard")}>
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (user?.role !== "lab_admin") {
    return (
      <div className="login-container">
        <div className="login-card" style={{ textAlign: "center" }}>
          <h2>Insufficient Permissions</h2>
          <p style={{ color: "#6b7280", margin: "16px 0" }}>
            Only lab administrators can confirm lab deletion.
          </p>
          <button className="login-submit" onClick={() => navigate("/dashboard")}>
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const handleConfirm = async () => {
    setLoading(true);
    setError("");
    try {
      await api.post("/labs/confirm-deletion");
      await logout();
      navigate("/login", { state: { message: "Your lab data has been deleted." } });
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to delete lab");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-orb login-orb-1" aria-hidden="true" />
      <div className="login-orb login-orb-2" aria-hidden="true" />

      <div className="login-card" style={{ maxWidth: 520 }}>
        <div className="login-brand">
          <div className="login-icon" style={{ background: "#fef2f2", color: "#dc2626" }}>
            <AlertTriangle size={26} />
          </div>
          <div>
            <h1>Confirm Lab Deletion</h1>
            <p className="subtitle">This action cannot be undone</p>
          </div>
        </div>

        <div style={{ margin: "20px 0", fontSize: 14, lineHeight: 1.7 }}>
          <p>
            A deletion request has been submitted for <strong>{labName}</strong>.
          </p>

          <p style={{ marginTop: 16, fontWeight: 600 }}>
            The following data will be permanently deleted:
          </p>
          <ul style={{ margin: "8px 0 0 20px", color: "#374151" }}>
            <li>Antibody catalog and inventory records</li>
            <li>Lot tracking data and vial records</li>
            <li>Uploaded QC documents and files</li>
            <li>Storage configurations</li>
            <li>Stripe billing customer and subscription data</li>
            <li>User login credentials (access will be revoked)</li>
          </ul>

          <p style={{ marginTop: 16, fontWeight: 600 }}>
            The following will be retained for compliance:
          </p>
          <ul style={{ margin: "8px 0 0 20px", color: "#374151" }}>
            <li>Audit log entries (with user names for traceability)</li>
          </ul>
        </div>

        <div className="form-group">
          <label htmlFor="confirm-lab-name">
            Type <strong>{labName}</strong> to confirm:
          </label>
          <input
            id="confirm-lab-name"
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={labName || ""}
            autoFocus
          />
        </div>

        {error && <p className="error login-error">{error}</p>}

        <button
          className="login-submit"
          style={{
            background: "#dc2626",
            cursor: confirmText !== labName || loading ? "not-allowed" : "pointer",
            opacity: confirmText !== labName || loading ? 0.5 : 1,
          }}
          disabled={confirmText !== labName || loading}
          onClick={handleConfirm}
        >
          {loading ? "Deleting..." : "Confirm Deletion"}
        </button>

        <p className="login-footer">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              navigate("/dashboard");
            }}
          >
            Cancel
          </a>
        </p>
      </div>
    </div>
  );
}
