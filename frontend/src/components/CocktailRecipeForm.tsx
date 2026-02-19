import { useState, type FormEvent } from "react";
import type { Antibody } from "../api/types";

export interface CocktailRecipeFormValues {
  name: string;
  description: string;
  shelf_life_days: string;
  max_renewals: string;
  components: ComponentRow[];
}

export interface ComponentRow {
  antibody_id: string;
  volume_ul: string;
}

export const EMPTY_RECIPE_FORM: CocktailRecipeFormValues = {
  name: "",
  description: "",
  shelf_life_days: "30",
  max_renewals: "",
  components: [{ antibody_id: "", volume_ul: "" }],
};

interface Props {
  onSubmit: (values: CocktailRecipeFormValues) => Promise<void>;
  onCancel: () => void;
  initialValues?: CocktailRecipeFormValues;
  antibodies: Antibody[];
  loading?: boolean;
  title?: string;
}

export function CocktailRecipeForm({
  onSubmit,
  onCancel,
  initialValues,
  antibodies,
  loading = false,
  title = "New Recipe",
}: Props) {
  const [form, setForm] = useState<CocktailRecipeFormValues>(
    initialValues || { ...EMPTY_RECIPE_FORM, components: [{ antibody_id: "", volume_ul: "" }] }
  );
  const [error, setError] = useState<string | null>(null);

  const handleChange = (field: keyof CocktailRecipeFormValues, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleComponentChange = (index: number, field: keyof ComponentRow, value: string) => {
    setForm((prev) => {
      const updated = [...prev.components];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, components: updated };
    });
  };

  const addComponent = () => {
    setForm((prev) => ({
      ...prev,
      components: [...prev.components, { antibody_id: "", volume_ul: "" }],
    }));
  };

  const removeComponent = (index: number) => {
    if (form.components.length <= 1) return;
    setForm((prev) => ({
      ...prev,
      components: prev.components.filter((_, i) => i !== index),
    }));
  };

  const moveComponent = (index: number, direction: "up" | "down") => {
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= form.components.length) return;
    setForm((prev) => {
      const updated = [...prev.components];
      const temp = updated[index];
      updated[index] = updated[target];
      updated[target] = temp;
      return { ...prev, components: updated };
    });
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!form.name.trim()) {
      setError("Recipe name is required.");
      return;
    }
    if (!form.shelf_life_days || parseInt(form.shelf_life_days, 10) < 1) {
      setError("Shelf life must be at least 1 day.");
      return;
    }
    const hasEmptyComponent = form.components.some((c) => !c.antibody_id);
    if (hasEmptyComponent) {
      setError("All components must have an antibody selected.");
      return;
    }

    try {
      await onSubmit(form);
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || "Failed to save recipe.");
    }
  };

  const antibodyLabel = (ab: Antibody) => {
    if (ab.name) return ab.name;
    return [ab.target, ab.fluorochrome].filter(Boolean).join(" - ") || "Unnamed";
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-content">
        <h2>{title}</h2>
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
        >
          <div className="form-group">
            <label>Recipe Name</label>
            <input
              value={form.name}
              onChange={(e) => handleChange("name", e.target.value)}
              placeholder="e.g. T-Cell Panel"
              required
            />
          </div>

          <div className="form-group">
            <label>Description (optional)</label>
            <textarea
              value={form.description}
              onChange={(e) => handleChange("description", e.target.value)}
              rows={2}
              placeholder="Brief description of this cocktail recipe"
            />
          </div>

          <div style={{ display: "flex", gap: "0.75rem" }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Shelf Life (days)</label>
              <input
                type="number"
                min="1"
                value={form.shelf_life_days}
                onChange={(e) => handleChange("shelf_life_days", e.target.value)}
                required
              />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Max Renewals (optional)</label>
              <input
                type="number"
                min="0"
                value={form.max_renewals}
                onChange={(e) => handleChange("max_renewals", e.target.value)}
                placeholder="Unlimited"
              />
            </div>
          </div>

          <div className="form-group">
            <label>Components</label>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {form.components.map((comp, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    padding: "0.5rem",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                  }}
                >
                  <span
                    style={{
                      minWidth: "1.5rem",
                      textAlign: "center",
                      fontWeight: 600,
                      color: "var(--text-secondary)",
                    }}
                  >
                    {i + 1}
                  </span>
                  <select
                    value={comp.antibody_id}
                    onChange={(e) => handleComponentChange(i, "antibody_id", e.target.value)}
                    style={{ flex: 2 }}
                    required
                  >
                    <option value="">Select antibody...</option>
                    {antibodies
                      .filter((ab) => ab.is_active)
                      .map((ab) => (
                        <option key={ab.id} value={ab.id}>
                          {antibodyLabel(ab)}
                        </option>
                      ))}
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="uL"
                    value={comp.volume_ul}
                    onChange={(e) => handleComponentChange(i, "volume_ul", e.target.value)}
                    style={{ flex: 0.7, minWidth: "4rem" }}
                  />
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <button
                      type="button"
                      className="btn-sm btn-secondary"
                      onClick={() => moveComponent(i, "up")}
                      disabled={i === 0}
                      aria-label="Move up"
                      style={{ padding: "0 0.3rem", lineHeight: 1 }}
                    >
                      &uarr;
                    </button>
                    <button
                      type="button"
                      className="btn-sm btn-secondary"
                      onClick={() => moveComponent(i, "down")}
                      disabled={i === form.components.length - 1}
                      aria-label="Move down"
                      style={{ padding: "0 0.3rem", lineHeight: 1 }}
                    >
                      &darr;
                    </button>
                  </div>
                  <button
                    type="button"
                    className="btn-sm btn-danger"
                    onClick={() => removeComponent(i)}
                    disabled={form.components.length <= 1}
                    aria-label="Remove component"
                    style={{ padding: "0 0.4rem" }}
                  >
                    X
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="btn-sm btn-secondary"
              onClick={addComponent}
              style={{ marginTop: "0.5rem" }}
            >
              + Add Component
            </button>
          </div>

          {error && <p className="error">{error}</p>}

          <div className="action-btns" style={{ marginTop: "0.5rem" }}>
            <button type="submit" disabled={loading}>
              {loading ? "Saving..." : initialValues ? "Save Changes" : "Create Recipe"}
            </button>
            <button type="button" className="btn-secondary" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
