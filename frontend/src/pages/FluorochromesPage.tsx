import { useEffect, useState, type FormEvent } from "react";
import api from "../api/client";
import type { Fluorochrome } from "../api/types";
import { useAuth } from "../context/AuthContext";
import { useSharedData } from "../context/SharedDataContext";
import { Palette } from "lucide-react";
import EmptyState from "../components/EmptyState";
import { useToast } from "../context/ToastContext";

const DEFAULT_FLUORO_COLOR = "#9ca3af";

export default function FluorochromesPage() {
  const { user } = useAuth();
  const { labs, selectedLab, setSelectedLab, refreshFluorochromes } = useSharedData();
  const [fluorochromes, setFluorochromes] = useState<Fluorochrome[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    color: DEFAULT_FLUORO_COLOR,
  });
  const [error, setError] = useState<string | null>(null);
  const { addToast } = useToast();

  const load = () => {
    const params: Record<string, string> = {};
    if (user?.role === "super_admin" && selectedLab) {
      params.lab_id = selectedLab;
    }
    api
      .get("/fluorochromes/", { params })
      .then((r) => setFluorochromes(r.data))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (selectedLab) {
      setLoading(true);
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
      addToast(`Fluorochrome "${form.name}" created`, "success");
      setForm({ name: "", color: DEFAULT_FLUORO_COLOR });
      setShowForm(false);
      load();
      refreshFluorochromes();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to create fluorochrome");
    }
  };


  const handleColorChange = async (fluoro: Fluorochrome, color: string) => {
    try {
      await api.patch(`/fluorochromes/${fluoro.id}`, { color });
      load();
      refreshFluorochromes();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to update color");
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Fluorochromes</h1>
        <div className="filters">
        {user?.role === "super_admin" && labs.length > 0 && (
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

      {!loading && fluorochromes.length === 0 ? (
        <EmptyState
          icon={Palette}
          title="No fluorochromes defined"
          description="Add fluorochromes to color-code your storage grid cells."
        />
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Color</th>
            </tr>
          </thead>
          <tbody>
            {fluorochromes.map((f) => (
              <tr key={f.id}>
                <td>{f.name}</td>
                <td>
                  <input
                    type="color"
                    value={f.color}
                    onChange={(e) => handleColorChange(f, e.target.value)}
                    title={f.color}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
