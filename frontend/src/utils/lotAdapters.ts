import type { Lot, LotSummary } from "../api/types";

/**
 * Convert a LotSummary (from search API) to a Lot shape.
 *
 * LotTable/LotCardList expect Lot[]. Search endpoints return LotSummary[],
 * which is a strict subset missing fields like antibody_id, lab_id, gs1_ai,
 * etc. This adapter fills those with safe defaults so the shared components
 * can render correctly — they never read the missing fields.
 */
export function lotSummaryToLot(summary: LotSummary, antibodyId = ""): Lot {
  return {
    id: summary.id,
    antibody_id: antibodyId,
    lab_id: "",
    lot_number: summary.lot_number,
    vendor_barcode: summary.vendor_barcode,
    gs1_ai: null,
    expiration_date: summary.expiration_date,
    qc_status: summary.qc_status,
    qc_approved_by: null,
    qc_approved_at: null,
    is_archived: summary.is_archived,
    archive_note: null,
    created_at: summary.created_at ?? "",
    vial_counts: summary.vial_counts,
  };
}
