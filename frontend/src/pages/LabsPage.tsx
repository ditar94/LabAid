import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client";
import type { Lab, BillingStatus } from "../api/types";
import { Building2, LogIn } from "lucide-react";
import EmptyState from "../components/EmptyState";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { useSharedData } from "../context/SharedDataContext";

export default function LabsPage() {
  const { refreshLabs } = useSharedData();
  const [labs, setLabs] = useState<Lab[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "" });
  const [error, setError] = useState<string | null>(null);
  const [suspendPrompt, setSuspendPrompt] = useState<{ id: string; name: string } | null>(null);
  const [suspendLoading, setSuspendLoading] = useState(false);
  const [enteringLabId, setEnteringLabId] = useState<string | null>(null);
  const [editingTrialId, setEditingTrialId] = useState<string | null>(null);
  const [trialDate, setTrialDate] = useState("");
  const [editingBillingUrlId, setEditingBillingUrlId] = useState<string | null>(null);
  const [billingUrl, setBillingUrl] = useState("");
  const { addToast } = useToast();
  const { startImpersonation } = useAuth();
  const navigate = useNavigate();

  const load = () =>
    api
      .get("/labs/")
      .then((r) => setLabs(r.data))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/labs/", form);
      setForm({ name: "" });
      setShowForm(false);
      addToast(`Lab "${form.name}" created`, "success");
      load();
      refreshLabs();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to create lab");
    }
  };

  const handleToggleSuspend = async (labId: string) => {
    setSuspendLoading(true);
    try {
      await api.patch(`/labs/${labId}/suspend`);
      await load();
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
      await load();
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
      navigate("/");
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
      await load();
      addToast("Trial end date updated", "success");
    } catch {
      addToast("Failed to update trial date", "danger");
    }
  };

  const handleBillingUrlSave = async (labId: string) => {
    try {
      await api.patch(`/labs/${labId}/settings`, { billing_url: billingUrl || null });
      setEditingBillingUrlId(null);
      await load();
      addToast("Billing URL updated", "success");
    } catch {
      addToast("Failed to update billing URL", "danger");
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Labs</h1>
        <button onClick={() => setShowForm(!showForm)}>
          {showForm ? "Cancel" : "+ New Lab"}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {showForm && (
        <form className="inline-form" onSubmit={handleSubmit}>
          <input
            placeholder="Lab Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <button type="submit">Create Lab</button>
        </form>
      )}

      {!loading && labs.length === 0 ? (
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
              <th>Billing URL</th>
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
                  <div
                    className="active-switch"
                    onClick={() => {
                      if (l.is_active) {
                        setSuspendPrompt({ id: l.id, name: l.name });
                      } else {
                        handleToggleSuspend(l.id);
                      }
                    }}
                    title={l.is_active ? "Suspend this lab" : "Reactivate this lab"}
                  >
                    <span className={`active-switch-label ${l.is_active ? "on" : ""}`}>
                      {l.is_active ? "Active" : "Suspended"}
                    </span>
                    <div className={`active-switch-track ${l.is_active ? "on" : ""}`}>
                      <div className="active-switch-thumb" />
                    </div>
                  </div>
                </td>
                <td>
                  <select
                    className="billing-select"
                    value={l.billing_status || "trial"}
                    onChange={(e) => handleBillingChange(l.id, e.target.value as BillingStatus)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <option value="trial">Trial</option>
                    <option value="active">Active</option>
                    <option value="past_due">Past Due</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </td>
                <td>
                  {l.billing_status === "trial" ? (
                    editingTrialId === l.id ? (
                      <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <input
                          type="date"
                          value={trialDate}
                          onChange={(e) => setTrialDate(e.target.value)}
                          style={{ width: 140 }}
                        />
                        <button className="btn-sm" onClick={() => handleTrialDateSave(l.id)}>Save</button>
                        <button className="btn-sm btn-secondary" onClick={() => setEditingTrialId(null)}>Cancel</button>
                      </span>
                    ) : (
                      <span
                        style={{ cursor: "pointer", textDecoration: "underline dotted" }}
                        title="Click to edit"
                        onClick={() => {
                          setEditingTrialId(l.id);
                          setTrialDate(l.trial_ends_at ? l.trial_ends_at.slice(0, 10) : "");
                        }}
                      >
                        {l.trial_ends_at ? new Date(l.trial_ends_at).toLocaleDateString() : "Not set"}
                      </span>
                    )
                  ) : (
                    <span className="text-muted">-</span>
                  )}
                </td>
                <td>
                  {editingBillingUrlId === l.id ? (
                    <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <input
                        type="url"
                        placeholder="https://..."
                        value={billingUrl}
                        onChange={(e) => setBillingUrl(e.target.value)}
                        style={{ width: 180 }}
                      />
                      <button className="btn-sm" onClick={() => handleBillingUrlSave(l.id)}>Save</button>
                      <button className="btn-sm btn-secondary" onClick={() => setEditingBillingUrlId(null)}>Cancel</button>
                    </span>
                  ) : (
                    <span
                      style={{ cursor: "pointer", textDecoration: "underline dotted" }}
                      title="Click to edit"
                      onClick={() => {
                        setEditingBillingUrlId(l.id);
                        setBillingUrl((l.settings as Record<string, unknown>)?.billing_url as string || "");
                      }}
                    >
                      {(l.settings as Record<string, unknown>)?.billing_url ? "Set" : "Not set"}
                    </span>
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

      {suspendPrompt && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Suspend lab">
          <div className="modal-content">
            <h2>Suspend {suspendPrompt.name}?</h2>
            <p className="page-desc">
              Users in this lab will have read-only access. No data will be deleted.
              You can reactivate the lab at any time.
            </p>
            <div className="action-btns" style={{ marginTop: "var(--space-lg)" }}>
              <button
                className="btn-red"
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
        </div>
      )}
    </div>
  );
}
