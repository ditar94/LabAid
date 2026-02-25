import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { AuthProvider, AuthProviderType } from "../api/types";
import { Modal } from "./Modal";
import { useToast } from "../context/ToastContext";
import { Shield, Plus } from "lucide-react";

interface Props {
  labId: string;
  labName: string;
  onClose: () => void;
}

const PROVIDER_LABELS: Record<AuthProviderType, string> = {
  password: "Password",
  oidc_microsoft: "Microsoft Entra ID",
  oidc_google: "Google Workspace",
  saml: "SAML",
};

const ADDABLE_TYPES: AuthProviderType[] = ["oidc_microsoft", "oidc_google"];

interface ProviderForm {
  provider_type: AuthProviderType;
  email_domain: string;
  client_id: string;
  tenant_id: string;
  client_secret: string;
}

const EMPTY_FORM: ProviderForm = {
  provider_type: "oidc_microsoft",
  email_domain: "",
  client_id: "",
  tenant_id: "",
  client_secret: "",
};

export default function AuthProviderModal({ labId, labName, onClose }: Props) {
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<ProviderForm>({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const { data: providers = [], isLoading } = useQuery<AuthProvider[]>({
    queryKey: ["auth-providers", labId],
    queryFn: () => api.get(`/auth/providers/${labId}`).then((r) => r.data),
  });

  const passwordProvider = providers.find((p) => p.provider_type === "password");
  const passwordEnabled = !passwordProvider || passwordProvider.is_enabled;

  const handleToggleEnabled = async (provider: AuthProvider) => {
    try {
      await api.patch(`/auth/providers/${provider.id}`, {
        is_enabled: !provider.is_enabled,
      });
      queryClient.invalidateQueries({ queryKey: ["auth-providers", labId] });
      addToast(
        `${PROVIDER_LABELS[provider.provider_type]} ${provider.is_enabled ? "disabled" : "enabled"}`,
        "success"
      );
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Failed to update provider", "danger");
    }
  };

  const handleTogglePassword = async () => {
    try {
      if (passwordProvider) {
        await api.patch(`/auth/providers/${passwordProvider.id}`, {
          is_enabled: !passwordProvider.is_enabled,
        });
      } else {
        await api.post("/auth/providers/", {
          lab_id: labId,
          provider_type: "password",
          is_enabled: false,
          config: {},
        });
      }
      queryClient.invalidateQueries({ queryKey: ["auth-providers", labId] });
      addToast(
        passwordEnabled ? "Password login disabled" : "Password login enabled",
        "success"
      );
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Failed to update password setting", "danger");
    }
  };

  const handleAdd = async () => {
    setSaving(true);
    try {
      const config: Record<string, string> = { client_id: form.client_id };
      if (form.provider_type === "oidc_microsoft") {
        config.tenant_id = form.tenant_id;
      }
      if (form.client_secret) {
        config.client_secret = form.client_secret;
      }

      await api.post("/auth/providers/", {
        lab_id: labId,
        provider_type: form.provider_type,
        email_domain: form.email_domain || null,
        config,
      });

      queryClient.invalidateQueries({ queryKey: ["auth-providers", labId] });
      addToast(`${PROVIDER_LABELS[form.provider_type]} added`, "success");
      setShowAdd(false);
      setForm({ ...EMPTY_FORM });
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Failed to add provider", "danger");
    } finally {
      setSaving(false);
    }
  };

  const configuredTypes = new Set(providers.map((p) => p.provider_type));
  const availableTypes = ADDABLE_TYPES.filter((t) => !configuredTypes.has(t));

  return (
    <Modal onClose={onClose} ariaLabel="Auth providers">
      <div className="modal-content" style={{ maxWidth: 560 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <Shield size={20} />
          <h2 style={{ margin: 0 }}>Auth Providers — {labName}</h2>
        </div>

        {isLoading ? (
          <p className="text-muted">Loading...</p>
        ) : (
          <>
            <table style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Email Domain</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Password</td>
                  <td className="text-muted">All domains</td>
                  <td>
                    <div
                      className="active-switch"
                      onClick={handleTogglePassword}
                      title={passwordEnabled ? "Disable password login" : "Enable password login"}
                    >
                      <span className={`active-switch-label ${passwordEnabled ? "on" : ""}`}>
                        {passwordEnabled ? "Enabled" : "Disabled"}
                      </span>
                      <div className={`active-switch-track ${passwordEnabled ? "on" : ""}`}>
                        <div className="active-switch-thumb" />
                      </div>
                    </div>
                  </td>
                  <td></td>
                </tr>
                {providers.filter((p) => p.provider_type !== "password").map((p) => (
                  <tr key={p.id}>
                    <td>{PROVIDER_LABELS[p.provider_type]}</td>
                    <td>{p.email_domain || <span className="text-muted">Not set</span>}</td>
                    <td>
                      <div
                        className="active-switch"
                        onClick={() => handleToggleEnabled(p)}
                        title={p.is_enabled ? "Disable" : "Enable"}
                      >
                        <span className={`active-switch-label ${p.is_enabled ? "on" : ""}`}>
                          {p.is_enabled ? "Enabled" : "Disabled"}
                        </span>
                        <div className={`active-switch-track ${p.is_enabled ? "on" : ""}`}>
                          <div className="active-switch-thumb" />
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="text-muted" style={{ fontSize: 12 }}>
                        Client: {(p.config?.client_id as string) || "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {availableTypes.length > 0 && !showAdd && (
              <button
                className="btn-chip btn-chip-primary"
                onClick={() => setShowAdd(true)}
                style={{ marginTop: 16 }}
              >
                <Plus size={14} style={{ marginRight: 4, verticalAlign: -2 }} />
                Add Provider
              </button>
            )}

            {showAdd && (
              <div className="card" style={{ marginTop: 16, padding: 16 }}>
                <h3 style={{ margin: "0 0 12px" }}>Add SSO Provider</h3>
                <div className="form-group">
                  <label>Provider Type</label>
                  <select
                    value={form.provider_type}
                    onChange={(e) =>
                      setForm({ ...form, provider_type: e.target.value as AuthProviderType })
                    }
                  >
                    {availableTypes.map((t) => (
                      <option key={t} value={t}>
                        {PROVIDER_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Email Domain</label>
                  <input
                    type="text"
                    placeholder="e.g. hospital.org"
                    value={form.email_domain}
                    onChange={(e) => setForm({ ...form, email_domain: e.target.value })}
                  />
                  <small className="text-muted">
                    Users with this email domain will see the SSO option on login.
                  </small>
                </div>
                <div className="form-group">
                  <label>Client ID</label>
                  <input
                    type="text"
                    placeholder="OAuth client ID"
                    value={form.client_id}
                    onChange={(e) => setForm({ ...form, client_id: e.target.value })}
                    required
                  />
                </div>
                {form.provider_type === "oidc_microsoft" && (
                  <div className="form-group">
                    <label>Tenant ID</label>
                    <input
                      type="text"
                      placeholder="Microsoft Entra tenant ID"
                      value={form.tenant_id}
                      onChange={(e) => setForm({ ...form, tenant_id: e.target.value })}
                      required
                    />
                  </div>
                )}
                <div className="form-group">
                  <label>Client Secret</label>
                  <input
                    type="password"
                    placeholder="OAuth client secret"
                    value={form.client_secret}
                    onChange={(e) => setForm({ ...form, client_secret: e.target.value })}
                    autoComplete="off"
                  />
                  <small className="text-muted">
                    Stored securely — never saved in plaintext.
                  </small>
                </div>
                <div className="action-btns" style={{ marginTop: 12 }}>
                  <button
                    className="btn-primary"
                    onClick={handleAdd}
                    disabled={saving || !form.client_id}
                  >
                    {saving ? "Adding..." : "Add Provider"}
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      setShowAdd(false);
                      setForm({ ...EMPTY_FORM });
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        <div className="action-btns" style={{ marginTop: 20 }}>
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
