import { useEffect, useState, type FormEvent } from "react";
import api from "../api/client";
import type { Lab } from "../api/types";

export default function LabsPage() {
  const [labs, setLabs] = useState<Lab[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "" });
  const [error, setError] = useState<string | null>(null);

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
            <th>Active</th>
            <th>Created At</th>
          </tr>
        </thead>
        <tbody>
          {labs.map((l) => (
            <tr key={l.id}>
              <td>{l.name}</td>
              <td>{l.is_active ? "Yes" : "No"}</td>
              <td>{new Date(l.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
