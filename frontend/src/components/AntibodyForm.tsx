// ── AntibodyForm — Shared antibody creation/edit form fields ─────────────────
// Renders form fields for antibody data. Does NOT render <form> or submit
// button — the parent provides those. Used by:
//   - InventoryPage: create (inline layout) + edit (stacked layout in modal)
//   - ScanSearchPage: registration (stacked layout)

import { useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import type { Fluorochrome, Designation } from "../api/types";

// ── Exported constants ───────────────────────────────────────────────────────

/** Sentinel value for the "New Fluorochrome" dropdown option */
export const NEW_FLUORO_VALUE = "__new_fluoro__";
/** Default color for new fluorochrome swatches */
export const DEFAULT_FLUORO_COLOR = "#9ca3af";

// ── Form values type ─────────────────────────────────────────────────────────

export interface AntibodyFormValues {
  designation: Designation | "";  // Empty string = "Select" placeholder
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
  designation: "",  // Empty = require explicit selection
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
  /** Show validation errors for all required fields (set true on submit attempt) */
  showValidation?: boolean;
}

// ── Info Button Component ────────────────────────────────────────────────────

function InfoButton({ tooltip }: { tooltip: string }) {
  return (
    <span className="info-btn" tabIndex={-1}>
      <Info size={12} />
      <span className="info-tooltip">{tooltip}</span>
    </span>
  );
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
  showValidation = false,
}: AntibodyFormProps) {
  const isInline = layout === "inline";
  const isIVD = values.designation === "ivd";

  // Track which fields have been touched (blurred)
  const [touched, setTouched] = useState<Set<string>>(new Set());

  // Helper: update a single field
  const set = (key: keyof AntibodyFormValues, value: string) => {
    onChange({ ...values, [key]: value });
  };

  // Helper: mark field as touched
  const markTouched = (key: string) => {
    setTouched((prev) => new Set(prev).add(key));
  };

  // Helper: check if field should show error
  const shouldShowError = (key: string, isRequired: boolean, isEmpty: boolean) => {
    if (!isRequired || !isEmpty) return false;
    return showValidation || touched.has(key);
  };

  // ── Layout wrappers ──────────────────────────────────────────────────────
  // In "inline" mode these are identity wrappers; in "stacked" mode they add
  // <div className="form-group"> and <div className="form-row"> respectively.

  const field = (
    label: string,
    input: ReactNode,
    options?: {
      optional?: boolean;
      subtitle?: string;
      info?: string;
      fieldKey?: string;
      required?: boolean;
      isEmpty?: boolean;
      errorMessage?: string;
    }
  ) => {
    if (isInline) return input;

    const { optional, subtitle, info, fieldKey, required, isEmpty, errorMessage } = options || {};
    const showError = fieldKey && shouldShowError(fieldKey, !!required, !!isEmpty);

    return (
      <div className={`form-group${showError ? " invalid" : ""}`}>
        <label>
          <span className={info || subtitle ? "label-with-info" : ""}>
            {label}
            {subtitle && <span className="label-subtitle"> — {subtitle}</span>}
            {info && <InfoButton tooltip={info} />}
          </span>
          {optional && (
            <small style={{ fontWeight: "normal", color: "var(--text-muted)" }}> (optional)</small>
          )}
        </label>
        {input}
        {showError && (
          <span className="field-error">{errorMessage || "Required"}</span>
        )}
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
          onChange={(e) => set("designation", e.target.value as Designation | "")}
          onBlur={() => markTouched("designation")}
          required
        >
          <option value="">Select Designation</option>
          <option value="ruo">RUO</option>
          <option value="asr">ASR</option>
          <option value="ivd">IVD</option>
        </select>,
        {
          fieldKey: "designation",
          required: true,
          isEmpty: !values.designation,
          errorMessage: "Please select a designation",
        }
      )}

      {/* ── IVD-specific fields ── */}
      {isIVD && (
        <>
          {field("Product Name",
            <input
              placeholder={isInline ? "Product Name (required for IVD)" : "IVD product name (required)"}
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
              onBlur={() => markTouched("name")}
              required
            />,
            {
              fieldKey: "name",
              required: true,
              isEmpty: !values.name.trim(),
            }
          )}
          {row(
            field("Short Code (for grid cells)",
              <input
                placeholder="e.g., MT34"
                value={values.short_code}
                onChange={(e) => set("short_code", e.target.value.slice(0, 5))}
                onBlur={() => markTouched("short_code")}
                maxLength={5}
                required
              />,
              {
                fieldKey: "short_code",
                required: true,
                isEmpty: !values.short_code.trim(),
              }
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
                onBlur={() => markTouched("target")}
                required
              />,
              {
                fieldKey: "target",
                required: true,
                isEmpty: !values.target.trim(),
              }
            ),
            field("Fluorochrome",
              <select
                value={values.fluorochrome_choice}
                onChange={(e) => set("fluorochrome_choice", e.target.value)}
                onBlur={() => markTouched("fluorochrome_choice")}
                required
              >
                <option value="">Select Fluorochrome</option>
                <option value={NEW_FLUORO_VALUE}>+ New Fluorochrome</option>
                {fluorochromes.map((f) => (
                  <option key={f.id} value={f.name}>{f.name}</option>
                ))}
              </select>,
              {
                fieldKey: "fluorochrome_choice",
                required: true,
                isEmpty: !values.fluorochrome_choice,
                errorMessage: "Please select a fluorochrome",
              }
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
                    onBlur={() => markTouched("new_fluorochrome")}
                    required
                  />,
                  {
                    fieldKey: "new_fluorochrome",
                    required: true,
                    isEmpty: !values.new_fluorochrome.trim(),
                  }
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
            { optional: true }
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
          { optional: true }
        ),
        field("Catalog #",
          <input
            placeholder="Catalog #"
            value={values.catalog_number}
            onChange={(e) => set("catalog_number", e.target.value)}
          />,
          { optional: true }
        )
      )}

      {/* ── Threshold fields (stability, low stock, min approved) ── */}
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
            { optional: true }
          )}
          {row(
            field("Low Stock Amount",
              <input
                type="number"
                min={1}
                placeholder={isInline ? "Low Stock Amount" : "Sealed vials"}
                value={values.low_stock_threshold}
                onChange={(e) => set("low_stock_threshold", e.target.value)}
              />,
              {
                optional: true,
                subtitle: "Total Sealed Vials",
                info: "When the amount of sealed vials (approved and not approved) goes below this amount, an alert for reorder is triggered.",
              }
            ),
            field("Min Approved Stock",
              <input
                type="number"
                min={1}
                placeholder={isInline ? "Min Approved Stock" : "Approved vials"}
                value={values.approved_low_threshold}
                onChange={(e) => set("approved_low_threshold", e.target.value)}
              />,
              {
                optional: true,
                info: "When the amount of QC-approved sealed vials goes below this amount, an alert is triggered.",
              }
            )
          )}
        </>
      )}
    </>
  );
}
