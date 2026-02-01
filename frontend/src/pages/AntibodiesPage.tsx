import { useEffect, useState, type FormEvent } from "react";
import api from "../api/client";
import type { Antibody, Lab, Fluorochrome } from "../api/types";
import { useAuth } from "../context/AuthContext";

export default function AntibodiesPage() {
  const { user } = useAuth();
  const [labs, setLabs] = useState<Lab[]>([]);
  const [selectedLab, setSelectedLab] = useState<string>("");
  const [antibodies, setAntibodies] = useState<Antibody[]>([]);
  const [fluorochromes, setFluorochromes] = useState<Fluorochrome[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    target: "",
    fluorochrome: "",
    clone: "",
    vendor: "",
    catalog_number: "",
    stability_days: "",
    low_stock_threshold: "",
  });
  const [editingStability, setEditingStability] = useState<string | null>(null);
  const [stabilityInput, setStabilityInput] = useState("");
  const [editingLowStock, setEditingLowStock] = useState<string | null>(null);
  const [lowStockInput, setLowStockInput] = useState("");

  const canEdit =
    user?.role === "super_admin" ||
    user?.role === "lab_admin" ||
    user?.role === "supervisor";

  const load = () => {
    const params: Record<string, string> = {};
    if (user?.role === "super_admin" && selectedLab) {
      params.lab_id = selectedLab;
    }
    api.get("/antibodies/", { params }).then((r) => setAntibodies(r.data));
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
    const params: Record<string, string> = {};
    if (user?.role === "super_admin" && selectedLab) {
      params.lab_id = selectedLab;
    }
    await api.post(
      "/antibodies/",
      {
        ...form,
        clone: form.clone || null,
        vendor: form.vendor || null,
        catalog_number: form.catalog_number || null,
        stability_days: form.stability_days
          ? parseInt(form.stability_days)
          : null,
        low_stock_threshold: form.low_stock_threshold
          ? parseInt(form.low_stock_threshold)
          : null,
      },
      { params }
    );
    setForm({
      target: "",
      fluorochrome: "",
      clone: "",
      vendor: "",
      catalog_number: "",
      stability_days: "",
      low_stock_threshold: "",
    });
    setShowForm(false);
    load();
  };

  const handleStabilitySave = async (abId: string) => {
    const value = stabilityInput.trim() ? parseInt(stabilityInput) : null;
    await api.patch(`/antibodies/${abId}`, { stability_days: value });
    setEditingStability(null);
    load();
  };

  const handleStabilityKeyDown = (e: React.KeyboardEvent, abId: string) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleStabilitySave(abId);
    } else if (e.key === "Escape") {
      setEditingStability(null);
    }
  };

  const handleLowStockSave = async (abId: string) => {
    const value = lowStockInput.trim() ? parseInt(lowStockInput) : null;
    await api.patch(`/antibodies/${abId}`, { low_stock_threshold: value });
    setEditingLowStock(null);
    load();
  };

  const handleLowStockKeyDown = (e: React.KeyboardEvent, abId: string) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleLowStockSave(abId);
    } else if (e.key === "Escape") {
      setEditingLowStock(null);
    }
  };

  const fluoroMap = new Map<string, string>();
  for (const f of fluorochromes) {
    fluoroMap.set(f.name.toLowerCase(), f.color);
  }

  return (
    <div>
      <div className="page-header">
        <h1>Antibodies</h1>
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
          {canEdit && (
            <button onClick={() => setShowForm(!showForm)}>
              {showForm ? "Cancel" : "+ New Antibody"}
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <form className="inline-form" onSubmit={handleSubmit}>
          <input
            placeholder="Target (e.g., CD3)"
            value={form.target}
            onChange={(e) => setForm({ ...form, target: e.target.value })}
            required
          />
          <input
            placeholder="Fluorochrome (e.g., FITC)"
            value={form.fluorochrome}
            onChange={(e) =>
              setForm({ ...form, fluorochrome: e.target.value })
            }
            required
          />
          <input
            placeholder="Clone"
            value={form.clone}
            onChange={(e) => setForm({ ...form, clone: e.target.value })}
          />
          <input
            placeholder="Vendor"
            value={form.vendor}
            onChange={(e) => setForm({ ...form, vendor: e.target.value })}
          />
          <input
            placeholder="Catalog #"
            value={form.catalog_number}
            onChange={(e) =>
              setForm({ ...form, catalog_number: e.target.value })
            }
          />
          <input
            type="number"
            placeholder="Stability (days)"
            min={1}
            value={form.stability_days}
            onChange={(e) =>
              setForm({ ...form, stability_days: e.target.value })
            }
          />
          <input
            type="number"
            placeholder="Low Stock Threshold"
            min={1}
            value={form.low_stock_threshold}
            onChange={(e) =>
              setForm({ ...form, low_stock_threshold: e.target.value })
            }
          />
          <button type="submit">Save</button>
        </form>
      )}

      <table>
        <thead>
          <tr>
            <th>Target</th>
            <th>Fluorochrome</th>
            <th>Clone</th>
            <th>Vendor</th>
            <th>Catalog #</th>
            <th>Stability</th>
            <th>Low Stock Threshold</th>
          </tr>
        </thead>
        <tbody>
          {antibodies.map((ab) => (
            <tr key={ab.id}>
              <td>{ab.target}</td>
              <td>
                {fluoroMap.get(ab.fluorochrome.toLowerCase()) && (
                  <div
                    className="color-dot"
                    style={{
                      backgroundColor: fluoroMap.get(
                        ab.fluorochrome.toLowerCase()
                      ),
                    }}
                  />
                )}
                {ab.fluorochrome}
              </td>
              <td>{ab.clone || "—"}</td>
              <td>{ab.vendor || "—"}</td>
              <td>{ab.catalog_number || "—"}</td>
              <td>
                {editingStability === ab.id ? (
                  <input
                    type="number"
                    min={1}
                    className="stability-input"
                    value={stabilityInput}
                    onChange={(e) => setStabilityInput(e.target.value)}
                    onKeyDown={(e) => handleStabilityKeyDown(e, ab.id)}
                    onBlur={() => handleStabilitySave(ab.id)}
                    autoFocus
                  />
                ) : (
                  <span
                    className={canEdit ? "editable-cell" : ""}
                    onClick={() => {
                      if (!canEdit) return;
                      setEditingStability(ab.id);
                      setStabilityInput(ab.stability_days?.toString() || "");
                    }}
                  >
                    {ab.stability_days ? `${ab.stability_days}d` : "—"}
                  </span>
                )}
              </td>
              <td>
                {editingLowStock === ab.id ? (
                  <input
                    type="number"
                    min={1}
                    className="stability-input"
                    value={lowStockInput}
                    onChange={(e) => setLowStockInput(e.target.value)}
                    onKeyDown={(e) => handleLowStockKeyDown(e, ab.id)}
                    onBlur={() => handleLowStockSave(ab.id)}
                    autoFocus
                  />
                ) : (
                  <span
                    className={canEdit ? "editable-cell" : ""}
                    onClick={() => {
                      if (!canEdit) return;
                      setEditingLowStock(ab.id);
                      setLowStockInput(
                        ab.low_stock_threshold?.toString() || ""
                      );
                    }}
                  >
                    {ab.low_stock_threshold
                      ? `${ab.low_stock_threshold} vials`
                      : "—"}
                  </span>
                )}
              </td>
            </tr>
          ))}
          {antibodies.length === 0 && (
            <tr>
              <td colSpan={7} className="empty">
                No antibodies registered
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
