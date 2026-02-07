import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client";
import type { Lab } from "../api/types";
import { Building2, LogIn } from "lucide-react";
import EmptyState from "../components/EmptyState";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";

export default function LabsPage() {
  const [labs, setLabs] = useState<Lab[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "" });
  const [error, setError] = useState<string | null>(null);
  const [suspendPrompt, setSuspendPrompt] = useState<{ id: string; name: string } | null>(null);
  const [suspendLoading, setSuspendLoading] = useState(false);
  const [enteringLabId, setEnteringLabId] = useState<string | null>(null);
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
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to create lab");
    }
  };

  const handleToggleSuspend = async (labId: string) => {
    setSuspendLoading(true);
    try {
      await api.patch(`/labs/${labId}/suspend`);
      await load();
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

      {loading ? (
        <div className="stagger-reveal">
          <div className="skeleton skeleton-row" />
          <div className="skeleton skeleton-row" />
          <div className="skeleton skeleton-row" />
        </div>
      ) : labs.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No labs yet"
          description="Create your first lab to get started."
        />
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Sealed Counts Only</th>
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
                  <input
                    type="checkbox"
                    checked={l.settings?.sealed_counts_only ?? false}
                    onChange={async () => {
                      await api.patch(`/labs/${l.id}/settings`, {
                        sealed_counts_only: !(l.settings?.sealed_counts_only ?? false),
                      });
                      load();
                    }}
                  />
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
                  {l.settings?.support_access_enabled && l.is_active && (
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
