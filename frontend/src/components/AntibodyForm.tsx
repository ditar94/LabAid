// ── AntibodyForm — Shared antibody creation/edit form fields ─────────────────
// Renders form fields for antibody data. Does NOT render <form> or submit
// button — the parent provides those. Used by:
//   - InventoryPage: create (inline layout) + edit (stacked layout in modal)
//   - ScanSearchPage: registration (stacked layout)

import type { ReactNode } from "react";
import type { Fluorochrome, Designation } from "../api/types";

// ── Exported constants ───────────────────────────────────────────────────────

/** Sentinel value for the "New Fluorochrome" dropdown option */
export const NEW_FLUORO_VALUE = "__new_fluoro__";
/** Default color for new fluorochrome swatches */
export const DEFAULT_FLUORO_COLOR = "#9ca3af";

// ── Form values type ─────────────────────────────────────────────────────────

export interface AntibodyFormValues {
  designation: Designation;
  target: string;
  fluorochrome_choice: string;
  new_fluorochrome: string;
  new_fluoro_color: string;
  clone: string;
  vendor: string;
  catalog_number: string;
  name: string;
  short_code: string;
  color: string;
  stability_days: string;
  low_stock_threshold: string;
  approved_low_threshold: string;
}

/** Empty default form values for initializing state */
export const EMPTY_AB_FORM: AntibodyFormValues = {
  designation: "ruo",
  target: "",
  fluorochrome_choice: "",
  new_fluorochrome: "",
  new_fluoro_color: DEFAULT_FLUORO_COLOR,
  clone: "",
  vendor: "",
  catalog_number: "",
  name: "",
  short_code: "",
  color: "#6366f1",
  stability_days: "",
  low_stock_threshold: "",
  approved_low_threshold: "",
};

// ── Component props ──────────────────────────────────────────────────────────

interface AntibodyFormProps {
  /** Current form values (controlled) */
  values: AntibodyFormValues;
  /** Called when any field changes */
  onChange: (values: AntibodyFormValues) => void;
  /** Available fluorochrome options for the dropdown */
  fluorochromes: Fluorochrome[];
  /** "inline" = flat inputs with placeholders (InventoryPage create),
   *  "stacked" = labeled form-groups with form-rows */
  layout?: "inline" | "stacked";
  /** Show reorder point and min ready stock fields (default: true) */
  showThresholds?: boolean;
  /** Fluorochrome variations from community catalog (for suggestions) */
  fluorochromeVariations?: string[];
  /** Vendor suggestion from fuzzy matching (shows "Did you mean X?") */
  vendorSuggestion?: string;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function AntibodyForm({
  values,
  onChange,
  fluorochromes,
  layout = "stacked",
  showThresholds = true,
  fluorochromeVariations = [],
  vendorSuggestion,
}: AntibodyFormProps) {
  const isInline = layout === "inline";
  const isIVD = values.designation === "ivd";

  // Helper: update a single field
  const set = (key: keyof AntibodyFormValues, value: string) => {
    onChange({ ...values, [key]: value });
  };

  // ── Layout wrappers ──────────────────────────────────────────────────────
  // In "inline" mode these are identity wrappers; in "stacked" mode they add
  // <div className="form-group"> and <div className="form-row"> respectively.

  const field = (label: string, input: ReactNode, optional?: boolean) => {
    if (isInline) return input;
    return (
      <div className="form-group">
        <label>
          {label}
          {optional && (
            <small style={{ fontWeight: "normal", color: "var(--text-muted)" }}> (optional)</small>
          )}
        </label>
        {input}
      </div>
    );
  };

  const row = (...fields: ReactNode[]) => {
    if (isInline) return <>{fields}</>;
    return <div className="form-row">{fields}</div>;
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Designation selector ── */}
      {field("Designation",
        <select
          value={values.designation}
          onChange={(e) => set("designation", e.target.value)}
        >
          <option value="ruo">RUO</option>
          <option value="asr">ASR</option>
          <option value="ivd">IVD</option>
        </select>
      )}

      {/* ── IVD-specific fields ── */}
      {isIVD && (
        <>
          {field("Product Name",
            <input
              placeholder={isInline ? "Product Name (required for IVD)" : "IVD product name (required)"}
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
              required
            />
          )}
          {row(
            field("Short Code (for grid cells)",
              <input
                placeholder="e.g., MT34"
                value={values.short_code}
                onChange={(e) => set("short_code", e.target.value.slice(0, 5))}
                maxLength={5}
                required
              />
            ),
            field("Color",
              <input
                type="color"
                value={values.color}
                onChange={(e) => set("color", e.target.value)}
                title="Grid cell color"
              />
            )
          )}
        </>
      )}

      {/* ── RUO / ASR fields ── */}
      {!isIVD && (
        <>
          {row(
            field("Target",
              <input
                placeholder="Target (e.g., CD3)"
                value={values.target}
                onChange={(e) => set("target", e.target.value)}
                required
              />
            ),
            field("Fluorochrome",
              <select
                value={values.fluorochrome_choice}
                onChange={(e) => set("fluorochrome_choice", e.target.value)}
                required
              >
                <option value="">Select Fluorochrome</option>
                <option value={NEW_FLUORO_VALUE}>+ New Fluorochrome</option>
                {fluorochromes.map((f) => (
                  <option key={f.id} value={f.name}>{f.name}</option>
                ))}
              </select>
            )
          )}

          {/* New fluorochrome name + color (shown when "+ New Fluorochrome" selected) */}
          {values.fluorochrome_choice === NEW_FLUORO_VALUE && (
            <>
              {row(
                field("New Fluorochrome",
                  <input
                    placeholder={isInline ? "New Fluorochrome" : "e.g., FITC"}
                    value={values.new_fluorochrome}
                    onChange={(e) => set("new_fluorochrome", e.target.value)}
                    required
                  />
                ),
                field("Color",
                  <input
                    type="color"
                    value={values.new_fluoro_color}
                    onChange={(e) => set("new_fluoro_color", e.target.value)}
                    required
                  />
                )
              )}
              {/* Fluorochrome variations from community catalog */}
              {fluorochromeVariations.length > 1 && (
                <div className="fluoro-variations">
                  <span className="fluoro-variations-label">Also entered as:</span>
                  {fluorochromeVariations
                    .filter((v) => v !== values.new_fluorochrome)
                    .map((variation) => (
                      <button
                        key={variation}
                        type="button"
                        className="fluoro-variation-chip"
                        onClick={() => set("new_fluorochrome", variation)}
                      >
                        {variation}
                      </button>
                    ))}
                </div>
              )}
            </>
          )}

          {field("Clone",
            <input
              placeholder="Clone"
              value={values.clone}
              onChange={(e) => set("clone", e.target.value)}
            />,
            true
          )}
        </>
      )}

      {/* ── Common fields (all designations) ── */}
      {row(
        field("Vendor",
          <>
            <input
              placeholder="Vendor"
              value={values.vendor}
              onChange={(e) => set("vendor", e.target.value)}
            />
            {/* Vendor suggestion from fuzzy matching */}
            {vendorSuggestion && values.vendor && vendorSuggestion !== values.vendor && (
              <div className="vendor-suggestion">
                Did you mean{" "}
                <button
                  type="button"
                  className="vendor-suggestion-link"
                  onClick={() => set("vendor", vendorSuggestion)}
                >
                  {vendorSuggestion}
                </button>
                ?
              </div>
            )}
          </>,
          true
        ),
        field("Catalog #",
          <input
            placeholder="Catalog #"
            value={values.catalog_number}
            onChange={(e) => set("catalog_number", e.target.value)}
          />,
          true
        )
      )}

      {/* ── Threshold fields (stability, reorder point, min ready stock) ── */}
      {showThresholds && (
        <>
          {field("Stability (days)",
            <input
              type="number"
              min={1}
              placeholder={isInline ? "Stability (days)" : "Days after opening"}
              value={values.stability_days}
              onChange={(e) => set("stability_days", e.target.value)}
            />,
            true
          )}
          {row(
            field("Reorder Point",
              <input
                type="number"
                min={1}
                placeholder={isInline ? "Reorder Point (total sealed vials)" : "Total sealed vials"}
                value={values.low_stock_threshold}
                onChange={(e) => set("low_stock_threshold", e.target.value)}
                title="Alert when total vials on hand drops below this level"
              />,
              true
            ),
            field("Min Ready Stock",
              <input
                type="number"
                min={1}
                placeholder={isInline ? "Min Ready Stock (approved vials)" : "Approved vials"}
                value={values.approved_low_threshold}
                onChange={(e) => set("approved_low_threshold", e.target.value)}
                title="Alert when QC-approved vials drops below this level"
              />,
              true
            )
          )}
        </>
      )}
    </>
  );
}
