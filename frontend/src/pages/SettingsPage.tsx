import { useNavigate } from "react-router-dom";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import ToggleSwitch from "../components/ToggleSwitch";

const DEFAULT_EXPIRY_WARN_DAYS = 30;

export default function SettingsPage() {
  const { user, labSettings, refreshUser } = useAuth();
  const { addToast } = useToast();
  const navigate = useNavigate();

  const isAdmin = user?.role === "lab_admin" || user?.role === "super_admin";

  if (!isAdmin || !user?.lab_id) {
    return (
      <div>
        <div className="page-header">
          <h1>Settings</h1>
        </div>
        <p className="empty">Settings are only available to lab admins.</p>
      </div>
    );
  }

  const updateSetting = async (patch: Record<string, unknown>) => {
    try {
      await api.patch(`/labs/${user.lab_id}/settings`, patch);
      await refreshUser();
    } catch {
      addToast("Failed to update setting", "danger");
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Settings</h1>
      </div>

      <div className="setting-row">
        <div className="setting-label">
          <div className="setting-title">Sealed counts only</div>
          <div className="setting-desc">Skip opened/depleted vial tracking — only count sealed inventory</div>
        </div>
        <ToggleSwitch
          checked={labSettings.sealed_counts_only ?? false}
          onChange={() => updateSetting({
            sealed_counts_only: !(labSettings.sealed_counts_only ?? false),
          })}
        />
      </div>

      <div className="setting-row">
        <div className="setting-label">
          <div className="setting-title">QC document required</div>
          <div className="setting-desc">Require a QC document upload before a lot can be approved</div>
        </div>
        <ToggleSwitch
          checked={labSettings.qc_doc_required ?? false}
          onChange={() => updateSetting({
            qc_doc_required: !(labSettings.qc_doc_required ?? false),
          })}
        />
      </div>

      <div className="setting-row">
        <div className="setting-label">
          <div className="setting-title">Expiry warning</div>
          <div className="setting-desc">Days before expiration to flag lots as expiring soon</div>
        </div>
        <input
          type="number"
          min={1}
          max={365}
          className="stability-input"
          value={labSettings.expiry_warn_days ?? DEFAULT_EXPIRY_WARN_DAYS}
          onChange={async (e) => {
            const val = parseInt(e.target.value, 10);
            if (!Number.isFinite(val) || val < 1) return;
            await updateSetting({ expiry_warn_days: val });
          }}
        />
      </div>

      <div className="setting-row">
        <div className="setting-label">
          <div className="setting-title">Storage tracking</div>
          <div className="setting-desc">Track physical storage locations with grids and containers</div>
        </div>
        <ToggleSwitch
          checked={labSettings.storage_enabled !== false}
          onChange={async () => {
            const enabling = labSettings.storage_enabled === false;
            await updateSetting({ storage_enabled: enabling });
            addToast(
              enabling ? "Storage tracking enabled" : "Storage tracking disabled",
              "success"
            );
          }}
        />
      </div>

      {user.role === "lab_admin" && (
        <button
          type="button"
          className="btn-link"
          style={{ marginTop: "var(--space-md)" }}
          onClick={() => navigate("/lab-setup")}
        >
          Run setup wizard
        </button>
      )}
    </div>
  );
}
