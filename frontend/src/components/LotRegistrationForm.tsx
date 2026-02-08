// ── LotRegistrationForm — Shared lot creation form fields ───────────────────
// Renders form fields for lot data. Does NOT render <form> or submit
// button — the parent provides those. Used by:
//   - InventoryPage: create (inline layout, with overflow handling)
//   - ScanSearchPage: registration (stacked layout)

import type { ReactNode } from "react";
import type { StorageUnit } from "../api/types";
import BarcodeScannerButton from "./BarcodeScannerButton";
import DatePicker from "./DatePicker";

// ── Exported constants ───────────────────────────────────────────────────────

export interface LotFormValues {
  lot_number: string;
  vendor_barcode: string;
  expiration_date: string;
  quantity: string;
  storage_unit_id: string;
}

/** Empty default form values for initializing state */
export const EMPTY_LOT_FORM: LotFormValues = {
  lot_number: "",
  vendor_barcode: "",
  expiration_date: "",
  quantity: "1",
  storage_unit_id: "",
};

// ── Component props ──────────────────────────────────────────────────────────

interface LotRegistrationFormProps {
  /** Current form values (controlled) */
  values: LotFormValues;
  /** Called when any field changes */
  onChange: (values: LotFormValues) => void;
  /** Available storage units for the assignment dropdown */
  storageUnits: StorageUnit[];
  /** Whether storage assignment UI is shown (default: true) */
  storageEnabled?: boolean;
  /** "inline" = flat inputs with placeholders (InventoryPage create),
   *  "stacked" = labeled form-groups with form-rows (ScanSearchPage register) */
  layout?: "inline" | "stacked";
  /** Available slots in the selected storage unit (enables overflow warning) */
  availableSlots?: number | null;
  /** Called when storage unit selection changes (parent can fetch available slots) */
  onStorageChange?: (unitId: string) => void;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function LotRegistrationForm({
  values,
  onChange,
  storageUnits,
  storageEnabled = true,
  layout = "stacked",
  availableSlots,
  onStorageChange,
}: LotRegistrationFormProps) {
  const isInline = layout === "inline";

  // Helper: update a single field
  const set = (key: keyof LotFormValues, value: string) => {
    onChange({ ...values, [key]: value });
  };

  // ── Layout wrappers ──────────────────────────────────────────────────────
  // In "inline" mode these are identity wrappers; in "stacked" mode they add
  // <div className="form-group"> and <div className="form-row"> respectively.

  const field = (label: string, input: ReactNode) => {
    if (isInline) return input;
    return (
      <div className="form-group">
        <label>{label}</label>
        {input}
      </div>
    );
  };

  const row = (...fields: ReactNode[]) => {
    if (isInline) return <>{fields}</>;
    return <div className="form-row">{fields}</div>;
  };

  // ── Barcode input with scan button ────────────────────────────────────────

  const barcodeInput = (
    <div className="input-with-scan">
      <input
        placeholder={isInline ? "Vendor Barcode" : "Vendor barcode"}
        value={values.vendor_barcode}
        onChange={(e) => set("vendor_barcode", e.target.value)}
      />
      <BarcodeScannerButton
        label="Scan"
        onDetected={(value) => set("vendor_barcode", value)}
      />
    </div>
  );

  // ── Storage dropdown + overflow hint ──────────────────────────────────────

  const showOverflow = availableSlots !== null && values.storage_unit_id &&
    parseInt(values.quantity) > (availableSlots ?? 0);

  const storageContent = (
    <>
      <select
        value={values.storage_unit_id}
        onChange={(e) => {
          set("storage_unit_id", e.target.value);
          onStorageChange?.(e.target.value);
        }}
      >
        <option value="">No storage assignment</option>
        {storageUnits.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} ({u.rows}x{u.cols}) {u.temperature || ""}
          </option>
        ))}
      </select>
      {/* Overflow warning when quantity exceeds available slots */}
      {showOverflow && (
        <p className="overflow-hint">
          Only {availableSlots} slot{availableSlots !== 1 ? "s" : ""} available.{" "}
          <button type="button" className="btn-sm" onClick={() => {
            onChange({ ...values, storage_unit_id: "" });
            onStorageChange?.("");
          }}>
            Use Temp Storage
          </button>
        </p>
      )}
    </>
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  if (isInline) {
    // Inline layout: barcode (full-width) → lot# → expiry → qty → storage
    return (
      <>
        {/* Full-width barcode row with scan button */}
        <div className="inline-form-full barcode-row">
          {barcodeInput}
        </div>
        <input
          placeholder="Lot Number"
          value={values.lot_number}
          onChange={(e) => set("lot_number", e.target.value)}
          required
        />
        <DatePicker
          value={values.expiration_date}
          onChange={(v) => set("expiration_date", v)}
          placeholderText="Expiration date"
        />
        <input
          type="number"
          min={1}
          placeholder="Vials received"
          value={values.quantity}
          onChange={(e) => set("quantity", e.target.value)}
        />
        {storageEnabled && storageContent}
      </>
    );
  }

  // Stacked layout: lot# → barcode → qty + expiry (row) → storage
  return (
    <>
      {field("Lot Number",
        <input
          placeholder="e.g., 12345"
          value={values.lot_number}
          onChange={(e) => set("lot_number", e.target.value)}
          required
        />
      )}

      {field("Vendor Barcode", barcodeInput)}

      {row(
        field("Vials Received",
          <input
            type="number"
            min={1}
            max={100}
            value={values.quantity}
            onChange={(e) => set("quantity", e.target.value)}
            required
          />
        ),
        field("Expiration Date",
          <DatePicker
            value={values.expiration_date}
            onChange={(v) => set("expiration_date", v)}
            placeholderText="Expiration date"
          />
        )
      )}

      {storageEnabled && field("Store in", storageContent)}
    </>
  );
}
