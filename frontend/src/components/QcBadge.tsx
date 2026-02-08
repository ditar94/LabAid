// ── QC Badge — shared quality control status indicator ───────────────────
// Replaces 8+ inline badge renders across the app.
// Used by: LotTable, LotCardList, StorageGrid, ScanSearchPage, SearchPage,
//          GlobalSearchPage, ScanPage, DashboardPage

interface QcBadgeProps {
  /** The QC status value (e.g. "approved", "pending", "failed"). */
  status: string;
  /** When true and status is "pending", show orange badge indicating doc is needed. */
  needsDoc?: boolean;
}

/** Returns the CSS badge class for a given QC status — reusable in popouts too. */
export function qcBadgeClass(qc: string | null | undefined): string {
  if (qc === "approved") return "badge-green";
  if (qc === "failed") return "badge-red";
  return "badge-yellow";
}

/** Returns a human-readable label for a QC status value. */
export function qcLabel(qc: string | null | undefined): string {
  if (!qc) return "";
  if (qc === "approved") return "Approved";
  if (qc === "failed") return "Failed";
  return "Pending";
}

/** Renders a colored badge for QC status with optional "needs document" variant. */
export default function QcBadge({ status, needsDoc }: QcBadgeProps) {
  // Special case: pending + needs doc → orange "Pending" badge
  if (needsDoc && status === "pending") {
    return (
      <span className="badge badge-orange" title="QC document required">
        Pending
      </span>
    );
  }

  // Standard badge: green/yellow/red based on status
  return (
    <span className={`badge ${qcBadgeClass(status)}`}>{status}</span>
  );
}
