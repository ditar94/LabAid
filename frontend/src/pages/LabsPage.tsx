import { lazy, Suspense, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { Lab, BillingStatus } from "../api/types";
import { Building2, LogIn, Shield } from "lucide-react";
import EmptyState from "../components/EmptyState";
import ToggleSwitch from "../components/ToggleSwitch";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { useSharedData } from "../context/SharedDataContext";
import { Modal } from "../components/Modal";
import TableSkeleton from "../components/TableSkeleton";

const AuthProviderModal = lazy(() => import("../components/AuthProviderModal"));

export default function LabsPage() {
  const { refreshLabs } = useSharedData();
  const queryClient = useQueryClient();
  const { data: labs = [], isLoading: loading } = useQuery<Lab[]>({
    queryKey: ["labs"],
    queryFn: () => api.get("/labs/").then((r) => r.data),
  });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "" });
  const [error, setError] = useState<string | null>(null);
  const [suspendPrompt, setSuspendPrompt] = useState<{ id: string; name: string } | null>(null);
  const [suspendLoading, setSuspendLoading] = useState(false);
  const [enteringLabId, setEnteringLabId] = useState<string | null>(null);
  const [editingTrialId, setEditingTrialId] = useState<string | null>(null);
  const [trialDate, setTrialDate] = useState("");
  const [ssoLab, setSsoLab] = useState<{ id: string; name: string } | null>(null);
  const [linkingStripeId, setLinkingStripeId] = useState<string | null>(null);
  const { addToast } = useToast();
  const { startImpersonation } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/labs/", form);
      setForm({ name: "" });
      setShowForm(false);
      addToast(`Lab "${form.name}" created`, "success");
      queryClient.invalidateQueries({ queryKey: ["labs"] });
      refreshLabs();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to create lab");
    }
  };

  const handleToggleSuspend = async (labId: string) => {
    setSuspendLoading(true);
    try {
      await api.patch(`/labs/${labId}/suspend`);
      await queryClient.invalidateQueries({ queryKey: ["labs"] });
      refreshLabs();
      const lab = labs.find((l) => l.id === labId);
      addToast(
        lab?.is_active ? `"${lab.name}" suspended` : `"${lab?.name}" reactivated`,
        lab?.is_active ? "warning" : "success"
      );
      setSuspendPrompt(null);
    } catch {
      addToast("Failed to update lab status", "danger");
    } finally {
      setSuspendLoading(false);
    }
  };

  const handleBillingChange = async (labId: string, status: BillingStatus) => {
    try {
      await api.patch(`/labs/${labId}/billing`, { billing_status: status });
      await queryClient.invalidateQueries({ queryKey: ["labs"] });
      refreshLabs();
      addToast(`Billing status updated to ${status.replace("_", " ")}`, "success");
    } catch {
      addToast("Failed to update billing status", "danger");
    }
  };

  const handleEnterLab = async (labId: string) => {
    setEnteringLabId(labId);
    try {
      await startImpersonation(labId);
      navigate("/dashboard");
    } catch (err: any) {
      const detail = err.response?.data?.detail || "Failed to enter lab";
      addToast(detail, "danger");
    } finally {
      setEnteringLabId(null);
    }
  };

  const handleTrialDateSave = async (labId: string) => {
    try {
      await api.patch(`/labs/${labId}/trial`, {
        trial_ends_at: trialDate ? new Date(trialDate).toISOString() : null,
      });
      setEditingTrialId(null);
      await queryClient.invalidateQueries({ queryKey: ["labs"] });
      addToast("Trial end date updated", "success");
    } catch {
      addToast("Failed to update trial date", "danger");
    }
  };

  const handleLinkStripe = async (labId: string) => {
    setLinkingStripeId(labId);
    try {
      await api.post(`/labs/${labId}/stripe-customer`);
      await queryClient.invalidateQueries({ queryKey: ["labs"] });
      addToast("Stripe customer created", "success");
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Failed to create Stripe customer", "danger");
    } finally {
      setLinkingStripeId(null);
    }
  };

  const handleSsoToggle = async (labId: string, current: boolean) => {
    try {
      await api.patch(`/labs/${labId}/settings`, { sso_enabled: !current });
      await queryClient.invalidateQueries({ queryKey: ["labs"] });
      refreshLabs();
      addToast(!current ? "SSO enabled" : "SSO disabled", "success");
    } catch {
      addToast("Failed to update SSO setting", "danger");
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Labs</h1>
        <button className="btn-chip btn-chip-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? "Cancel" : "+ New Lab"}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {showForm && (
        <form className="inline-form" onSubmit={handleSubmit}>
          <input
            aria-label="Lab name"
            placeholder="Lab Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <button type="submit">Create Lab</button>
        </form>
      )}

      {loading && labs.length === 0 ? (
        <TableSkeleton rows={3} cols={5} />
      ) : !loading && labs.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No labs yet"
          description="Create your first lab to get started."
        />
      ) : (
        <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Billing</th>
              <th>Trial Ends</th>
              <th>Subscription</th>
              <th>SSO</th>
              <th>Support Access</th>
              <th>Created At</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {labs.map((l) => (
              <tr key={l.id}>
                <td>{l.name}</td>
                <td>
                  <ToggleSwitch
                    checked={l.is_active}
                    onChange={() => {
                      if (l.is_active) {
                        setSuspendPrompt({ id: l.id, name: l.name });
                      } else {
                        handleToggleSuspend(l.id);
                      }
                    }}
                    label={l.is_active ? "Active" : "Suspended"}
                  />
                </td>
                <td>
                  {l.stripe_subscription_id ? (
                    <span className="badge badge-info" title="Managed by Stripe — change status in Stripe Dashboard">
                      {l.billing_status === "active" ? "Active" : l.billing_status === "past_due" ? "Past Due" : l.billing_status === "cancelled" ? "Cancelled" : l.billing_status === "trial" ? "Trial" : l.billing_status}
                    </span>
                  ) : (
                    <select
                      className="billing-select"
                      aria-label={`Billing status for ${l.name}`}
                      value={l.billing_status || "trial"}
                      onChange={(e) => handleBillingChange(l.id, e.target.value as BillingStatus)}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <option value="trial">Trial</option>
                      <option value="active">Active</option>
                      <option value="past_due">Past Due</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  )}
                </td>
                <td>
                  {l.stripe_subscription_id ? (
                    <span className="text-muted">-</span>
                  ) : l.billing_status === "trial" ? (
                    editingTrialId === l.id ? (
                      <span className="inline-edit">
                        <input
                          type="date"
                          aria-label="Trial end date"
                          value={trialDate}
                          onChange={(e) => setTrialDate(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleTrialDateSave(l.id);
                            if (e.key === "Escape") setEditingTrialId(null);
                          }}
                          autoFocus
                          style={{ width: 140 }}
                        />
                        <button className="btn-sm" onClick={() => handleTrialDateSave(l.id)}>Save</button>
                        <button className="btn-sm btn-secondary" onClick={() => setEditingTrialId(null)}>Cancel</button>
                      </span>
                    ) : (
                      <button
                        className="btn-link"
                        onClick={() => {
                          setEditingTrialId(l.id);
                          setTrialDate(l.trial_ends_at ? l.trial_ends_at.slice(0, 10) : "");
                        }}
                      >
                        {l.trial_ends_at ? new Date(l.trial_ends_at).toLocaleDateString() : "Not set"}
                      </button>
                    )
                  ) : (
                    <span className="text-muted">-</span>
                  )}
                </td>
                <td>
                  {l.stripe_customer_id ? (
                    <span title={`Customer: ${l.stripe_customer_id}\nSubscription: ${l.stripe_subscription_id || "None"}\nBilling email: ${l.billing_email || "-"}\nLast updated: ${l.billing_updated_at ? new Date(l.billing_updated_at).toLocaleString() : "-"}`}>
                      <span className={`badge ${l.stripe_subscription_id ? "badge-success" : "badge-muted"}`}>
                        {l.stripe_customer_id.slice(0, 15)}...
                      </span>
                    </span>
                  ) : (
                    <button
                      className="btn-sm"
                      onClick={() => handleLinkStripe(l.id)}
                      disabled={linkingStripeId === l.id}
                    >
                      {linkingStripeId === l.id ? "Linking..." : "Link to Stripe"}
                    </button>
                  )}
                </td>
                <td style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <ToggleSwitch
                    checked={l.settings?.sso_enabled === true}
                    onChange={() => handleSsoToggle(l.id, l.settings?.sso_enabled === true)}
                  />
                  {l.settings?.sso_enabled === true && (
                    <button
                      className="btn-sm btn-secondary"
                      onClick={() => setSsoLab({ id: l.id, name: l.name })}
                      title="Configure SSO providers"
                    >
                      <Shield size={14} style={{ marginRight: 4, verticalAlign: -2 }} />
                      Configure
                    </button>
                  )}
                </td>
                <td>
                  <span
                    className={`badge ${l.settings?.support_access_enabled ? "badge-success" : "badge-muted"}`}
                    title="Controlled by Lab Admin from their Dashboard settings"
                  >
                    {l.settings?.support_access_enabled ? "Enabled" : "Disabled"}
                  </span>
                </td>
                <td>{new Date(l.created_at).toLocaleString()}</td>
                <td>
                  {l.is_active && (
                    <button
                      className="btn-sm"
                      onClick={() => handleEnterLab(l.id)}
                      disabled={enteringLabId === l.id}
                      title="Enter this lab in support mode"
                    >
                      <LogIn size={14} style={{ marginRight: 4, verticalAlign: -2 }} />
                      {enteringLabId === l.id ? "Entering..." : "Enter Lab"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {ssoLab && (
        <Suspense fallback={null}>
          <AuthProviderModal
            labId={ssoLab.id}
            labName={ssoLab.name}
            onClose={() => setSsoLab(null)}
          />
        </Suspense>
      )}

      {suspendPrompt && (
        <Modal onClose={() => setSuspendPrompt(null)} ariaLabel="Suspend lab">
          <div className="modal-content">
            <h2>Suspend {suspendPrompt.name}?</h2>
            <p className="page-desc">
              Users in this lab will have read-only access. No data will be deleted.
              You can reactivate the lab at any time.
            </p>
            <div className="action-btns" style={{ marginTop: "var(--space-lg)" }}>
              <button
                className="btn-danger"
                onClick={() => handleToggleSuspend(suspendPrompt.id)}
                disabled={suspendLoading}
              >
                {suspendLoading ? "Suspending..." : "Suspend Lab"}
              </button>
              <button
                className="btn-secondary"
                onClick={() => setSuspendPrompt(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
