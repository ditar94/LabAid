import { useEffect, useMemo, useState, type FormEvent } from "react";
import api from "../api/client";
import type { CocktailRecipe, Lot } from "../api/types";

interface SourceSelection {
  component_id: string;
  antibody_id: string;
  source_lot_id: string;
}

interface Props {
  recipe: CocktailRecipe;
  onSubmit: (values: {
    recipe_id: string;
    lot_number: string;
    vendor_barcode: string | null;
    preparation_date: string;
    expiration_date: string;
    sources: { component_id: string; source_lot_id: string }[];
  }) => Promise<void>;
  onCancel: () => void;
  loading?: boolean;
}

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function CocktailLotPreparationForm({ recipe, onSubmit, onCancel, loading = false }: Props) {
  const [lotNumber, setLotNumber] = useState("");
  const [vendorBarcode, setVendorBarcode] = useState("");
  const [preparationDate, setPreparationDate] = useState(todayISO());
  const [expirationDate, setExpirationDate] = useState(addDays(todayISO(), recipe.shelf_life_days));
  const [expirationOverridden, setExpirationOverridden] = useState(false);
  const [sources, setSources] = useState<SourceSelection[]>(
    recipe.components.map((c) => ({
      component_id: c.id,
      antibody_id: c.antibody_id,
      source_lot_id: "",
    }))
  );
  const [lotsPerAntibody, setLotsPerAntibody] = useState<Map<string, Lot[]>>(new Map());
  const [lotsLoading, setLotsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Compute unique antibody IDs to fetch lots for
  const uniqueAntibodyIds = useMemo(
    () => [...new Set(recipe.components.map((c) => c.antibody_id))],
    [recipe.components]
  );

  // Fetch lots for each antibody
  useEffect(() => {
    let cancelled = false;
    setLotsLoading(true);

    Promise.all(
      uniqueAntibodyIds.map((abId) =>
        api.get<Lot[]>("/lots/", { params: { antibody_id: abId } }).then((r) => ({
          antibodyId: abId,
          lots: r.data,
        }))
      )
    )
      .then((results) => {
        if (cancelled) return;
        const map = new Map<string, Lot[]>();
        for (const { antibodyId, lots } of results) {
          map.set(antibodyId, lots);
        }
        setLotsPerAntibody(map);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load available lots.");
      })
      .finally(() => {
        if (!cancelled) setLotsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [uniqueAntibodyIds]);

  // Auto-calculate expiration when preparation date changes (unless user overrode it)
  useEffect(() => {
    if (!expirationOverridden && preparationDate) {
      setExpirationDate(addDays(preparationDate, recipe.shelf_life_days));
    }
  }, [preparationDate, recipe.shelf_life_days, expirationOverridden]);

  const handleExpirationChange = (value: string) => {
    setExpirationDate(value);
    setExpirationOverridden(true);
  };

  const handleSourceChange = (componentId: string, sourceLotId: string) => {
    setSources((prev) =>
      prev.map((s) => (s.component_id === componentId ? { ...s, source_lot_id: sourceLotId } : s))
    );
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!lotNumber.trim()) {
      setError("Lot number is required.");
      return;
    }
    if (!preparationDate) {
      setError("Preparation date is required.");
      return;
    }
    if (!expirationDate) {
      setError("Expiration date is required.");
      return;
    }

    const missingSources = sources.filter((s) => !s.source_lot_id);
    if (missingSources.length > 0) {
      setError("All components must have a source lot selected.");
      return;
    }

    try {
      await onSubmit({
        recipe_id: recipe.id,
        lot_number: lotNumber.trim(),
        vendor_barcode: vendorBarcode.trim() || null,
        preparation_date: preparationDate,
        expiration_date: expirationDate,
        sources: sources.map((s) => ({
          component_id: s.component_id,
          source_lot_id: s.source_lot_id,
        })),
      });
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || "Failed to prepare lot.");
    }
  };

  const formatLotOption = (lot: Lot): string => {
    const parts: string[] = [lot.lot_number];
    if (lot.expiration_date) {
      parts.push(`exp ${new Date(lot.expiration_date + "T00:00:00").toLocaleDateString()}`);
    }
    const counts = lot.vial_counts;
    if (counts) {
      parts.push(`${counts.sealed}S / ${counts.opened}O`);
    }
    if (lot.qc_status === "approved") {
      parts.push("QC OK");
    } else if (lot.qc_status === "pending") {
      parts.push("QC Pending");
    } else if (lot.qc_status === "failed") {
      parts.push("QC Failed");
    }
    return parts.join(" | ");
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={`Prepare lot for ${recipe.name}`}>
      <div className="modal-content">
        <h2>Prepare Lot: {recipe.name}</h2>
        <p className="page-desc">
          Select source lots for each component in this cocktail recipe.
        </p>
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
        >
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Lot Number</label>
              <input
                value={lotNumber}
                onChange={(e) => setLotNumber(e.target.value)}
                placeholder="e.g. CKT-2026-001"
                required
              />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Vendor Barcode (optional)</label>
              <input
                value={vendorBarcode}
                onChange={(e) => setVendorBarcode(e.target.value)}
                placeholder="Barcode or ID"
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: "0.75rem" }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Preparation Date</label>
              <input
                type="date"
                value={preparationDate}
                onChange={(e) => setPreparationDate(e.target.value)}
                required
              />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>
                Expiration Date
                {expirationOverridden && (
                  <button
                    type="button"
                    className="btn-sm btn-secondary"
                    onClick={() => {
                      setExpirationOverridden(false);
                      setExpirationDate(addDays(preparationDate, recipe.shelf_life_days));
                    }}
                    style={{ marginLeft: "0.5rem", fontSize: "0.75rem" }}
                  >
                    Reset
                  </button>
                )}
              </label>
              <input
                type="date"
                value={expirationDate}
                onChange={(e) => handleExpirationChange(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label>Source Lots</label>
            {lotsLoading && <p className="page-desc">Loading available lots...</p>}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {recipe.components.map((comp) => {
                const label = [comp.antibody_target, comp.antibody_fluorochrome]
                  .filter(Boolean)
                  .join(" - ") || "Unknown antibody";
                const availableLots = (lotsPerAntibody.get(comp.antibody_id) || []).filter(
                  (l) => !l.is_archived && l.qc_status !== "failed"
                );
                const sourceEntry = sources.find((s) => s.component_id === comp.id);

                return (
                  <div
                    key={comp.id}
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
                      {comp.ordinal}
                    </span>
                    <span style={{ flex: 1, fontWeight: 500 }}>{label}</span>
                    <select
                      value={sourceEntry?.source_lot_id || ""}
                      onChange={(e) => handleSourceChange(comp.id, e.target.value)}
                      style={{ flex: 2 }}
                      required
                    >
                      <option value="">Select lot...</option>
                      {availableLots.map((lot) => (
                        <option key={lot.id} value={lot.id}>
                          {formatLotOption(lot)}
                        </option>
                      ))}
                      {availableLots.length === 0 && !lotsLoading && (
                        <option value="" disabled>
                          No lots available
                        </option>
                      )}
                    </select>
                  </div>
                );
              })}
            </div>
          </div>

          {error && <p className="error">{error}</p>}

          <div className="action-btns" style={{ marginTop: "0.5rem" }}>
            <button type="submit" disabled={loading || lotsLoading}>
              {loading ? "Preparing..." : "Prepare Lot"}
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
