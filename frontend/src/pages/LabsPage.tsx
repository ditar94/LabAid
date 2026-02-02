import { useEffect, useState, type FormEvent } from "react";
import api from "../api/client";
import type { Lab } from "../api/types";

export default function LabsPage() {
  const [labs, setLabs] = useState<Lab[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "" });
  const [error, setError] = useState<string | null>(null);
  const [suspendPrompt, setSuspendPrompt] = useState<{ id: string; name: string } | null>(null);
  const [suspendLoading, setSuspendLoading] = useState(false);

  const load = () => api.get("/labs").then((r) => setLabs(r.data));

  useEffect(() => {
    load();
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/labs", form);
      setForm({ name: "" });
      setShowForm(false);
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
      setSuspendPrompt(null);
    } catch {
      // keep UI stable
    } finally {
      setSuspendLoading(false);
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

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>Sealed Counts Only</th>
            <th>Created At</th>
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
              <td>{new Date(l.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {suspendPrompt && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Suspend {suspendPrompt.name}?</h2>
            <p className="page-desc">
              Users in this lab will have read-only access. No data will be deleted.
              You can reactivate the lab at any time.
            </p>
            <div className="action-btns" style={{ marginTop: "1rem" }}>
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
