import { lazy, Suspense, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import ToggleSwitch from "../components/ToggleSwitch";
import { Shield } from "lucide-react";

const AuthProviderModal = lazy(() => import("../components/AuthProviderModal"));

const DEFAULT_EXPIRY_WARN_DAYS = 30;

export default function SettingsPage() {
  const { user, labSettings, labName, refreshUser } = useAuth();
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [showSsoModal, setShowSsoModal] = useState(false);

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

      <div className="setting-row">
        <div className="setting-label">
          <div className="setting-title">Cocktail tracking</div>
          <div className="setting-desc">Enable cocktail recipe management and lot preparation</div>
        </div>
        <ToggleSwitch
          checked={labSettings.cocktails_enabled === true}
          onChange={async () => {
            const enabling = labSettings.cocktails_enabled !== true;
            await updateSetting({ cocktails_enabled: enabling });
            addToast(
              enabling ? "Cocktail tracking enabled" : "Cocktail tracking disabled",
              "success"
            );
          }}
        />
      </div>

      {labSettings.sso_enabled === true ? (
        <>
          <div className="setting-row">
            <div className="setting-label">
              <div className="setting-title">
                <Shield size={16} style={{ verticalAlign: -2, marginRight: 4 }} />
                Single Sign-On (SSO)
              </div>
              <div className="setting-desc">Configure Microsoft Entra ID or Google Workspace for your lab</div>
            </div>
            <button className="btn-chip btn-chip-primary" onClick={() => setShowSsoModal(true)}>
              Configure
            </button>
          </div>

          {showSsoModal && user.lab_id && (
            <Suspense fallback={null}>
              <AuthProviderModal
                labId={user.lab_id}
                labName={labName || "My Lab"}
                onClose={() => setShowSsoModal(false)}
              />
            </Suspense>
          )}
        </>
      ) : (
        <div className="setting-row">
          <div className="setting-label">
            <div className="setting-title">
              <Shield size={16} style={{ verticalAlign: -2, marginRight: 4 }} />
              Single Sign-On (SSO)
            </div>
            <div className="setting-desc">SSO is available on enterprise plans. Contact your LabAid administrator to enable.</div>
          </div>
        </div>
      )}

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
