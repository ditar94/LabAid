import { useEffect, useState, type FormEvent } from "react";
import api from "../api/client";
import type { Fluorochrome, Lab } from "../api/types";
import { useAuth } from "../context/AuthContext";

export default function FluorochromesPage() {
  const { user } = useAuth();
  const [labs, setLabs] = useState<Lab[]>([]);
  const [selectedLab, setSelectedLab] = useState<string>("");
  const [fluorochromes, setFluorochromes] = useState<Fluorochrome[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    color: "#ffffff",
  });
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    const params: Record<string, string> = {};
    if (user?.role === "super_admin" && selectedLab) {
      params.lab_id = selectedLab;
    }
    api.get("/fluorochromes/", { params }).then((r) => setFluorochromes(r.data));
  };

  useEffect(() => {
    if (user?.role === "super_admin") {
      api.get("/labs").then((r) => {
        setLabs(r.data);
        if (r.data.length > 0) {
          setSelectedLab(r.data[0].id);
        }
      });
    } else if (user) {
      setSelectedLab(user.lab_id);
    }
  }, [user]);

  useEffect(() => {
    if (selectedLab) {
      load();
    }
  }, [selectedLab]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const params: Record<string, string> = {};
    if (user?.role === "super_admin" && selectedLab) {
      params.lab_id = selectedLab;
    }
    try {
      await api.post("/fluorochromes/", form, { params });
      setForm({ name: "", color: "#ffffff" });
      setShowForm(false);
      load();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to create fluorochrome");
    }
  };

  const handleDelete = async (id: string) => {
    await api.delete(`/fluorochromes/${id}`);
    load();
  };

  return (
    <div>
      <div className="page-header">
        <h1>Fluorochromes</h1>
        <div className="filters">
        {user?.role === "super_admin" && (
            <select
              value={selectedLab}
              onChange={(e) => setSelectedLab(e.target.value)}
            >
              {labs.map((lab) => (
                <option key={lab.id} value={lab.id}>
                  {lab.name}
                </option>
              ))}
            </select>
          )}
        <button onClick={() => setShowForm(!showForm)}>
          {showForm ? "Cancel" : "+ New Fluorochrome"}
        </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {showForm && (
        <form className="inline-form" onSubmit={handleSubmit}>
          <input
            placeholder="Fluorochrome Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <input
            type="color"
            value={form.color}
            onChange={(e) => setForm({ ...form, color: e.target.value })}
            required
          />
          <button type="submit">Create</button>
        </form>
      )}

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Color</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {fluorochromes.map((f) => (
            <tr key={f.id}>
              <td>{f.name}</td>
              <td>
                <div
                  style={{
                    width: "20px",
                    height: "20px",
                    backgroundColor: f.color,
                  }}
                />
              </td>
              <td className="action-btns">
                <button
                  className="btn-sm btn-red"
                  onClick={() => handleDelete(f.id)}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
