// ── LotTable — Shared desktop table for lot rows ─────────────────────────────
// Used by InventoryPage (full actions), SearchPage (read-only), ScanSearchPage
// (with "Scan Lot" extra action), and DashboardPage (Pending QC / Expiring
// sections via prefixColumn + extraColumns).

import type { ReactNode } from "react";
import type { Lot } from "../api/types";
import ActionMenu from "./ActionMenu";
import QcBadge from "./QcBadge";
import LotAgeBadge from "./LotAgeBadge";
import { formatDate } from "../utils/format";
import { buildLotActions } from "../utils/lotActions";
import { useLotBarcodeCopy } from "../hooks/useLotBarcodeCopy";

export interface LotListProps {
  lots: Lot[];
  sealedOnly: boolean;
  canQC: boolean;
  qcDocRequired?: boolean;
  storageEnabled?: boolean;
  lotAgeBadgeMap: Map<string, "current" | "new">;

  // Action callbacks — all optional; pass only what the page supports
  onApproveQC?: (lotId: string) => void;
  onDeplete?: (lot: Lot) => void;
  onOpenDocs?: (lot: Lot) => void;
  onArchive?: (lot: Lot) => void;
  onEditLot?: (lot: Lot) => void;
  onConsolidate?: (lot: Lot) => void;
  onLotClick?: (lot: Lot) => void;
  selectedLotId?: string | null;

  // ── Cross-context support (Dashboard, ScanSearchPage, etc.) ────────────

  /** First column content — e.g., antibody name + vendor for Dashboard */
  prefixColumn?: { header: string; render: (lot: Lot) => ReactNode };
  /** Extra badges rendered after the lot number (per lot ID) */
  customBadges?: Map<string, ReactNode>;
  /** Extra action buttons per lot row (e.g., "Scan Lot") */
  extraActions?: (lot: Lot) => ReactNode;
  /** Additional columns after standard ones but before Actions */
  extraColumns?: Array<{ header: string; render: (lot: Lot) => ReactNode }>;
  /** Hide the entire Actions column (ActionMenu + Approve) */
  hideActions?: boolean;
  /** Hide the Depleted column even when sealedOnly is false */
  hideDepleted?: boolean;
  /** Hide the QC status badge column */
  hideQc?: boolean;
  /** Hide the Received date column */
  hideReceived?: boolean;
}

export default function LotTable({
  lots,
  sealedOnly,
  canQC,
  qcDocRequired,
  storageEnabled = true,
  lotAgeBadgeMap,
  onApproveQC,
  onDeplete,
  onOpenDocs,
  onArchive,
  onEditLot,
  onConsolidate,
  onLotClick,
  selectedLotId,
  prefixColumn,
  customBadges,
  extraActions,
  extraColumns,
  hideActions,
  hideDepleted,
  hideQc,
  hideReceived,
}: LotListProps) {
  const { expandedBarcode, setExpandedBarcode, copiedId, handleCopy } = useLotBarcodeCopy();

  // Depleted column hidden by sealedOnly OR the explicit hideDepleted flag
  const showDepleted = !sealedOnly && !hideDepleted;

  return (
    <table>
      <thead>
        <tr>
          {prefixColumn && <th>{prefixColumn.header}</th>}
          <th>Lot #</th>
          {!hideQc && <th>QC</th>}
          {!hideReceived && <th>Received</th>}
          <th>Expiration</th>
          <th>Sealed</th>
          {!sealedOnly && <th>Opened</th>}
          {showDepleted && <th>Depleted</th>}
          <th>Total</th>
          {storageEnabled && <th>Location</th>}
          {extraColumns?.map((col) => <th key={col.header}>{col.header}</th>)}
          {!hideActions && <th style={{ width: 120, textAlign: "center" }}></th>}
        </tr>
      </thead>
      <tbody>
        {lots.map((lot) => (
          <tr key={lot.id} className={`${onLotClick ? "clickable-row" : ""}${selectedLotId === lot.id ? " active" : ""}${lot.is_archived ? " lot-row-archived" : ""}${!lot.is_archived && (lot.vial_counts?.sealed ?? 0) + (lot.vial_counts?.opened ?? 0) === 0 && (lot.vial_counts?.depleted ?? 0) > 0 ? " lot-row-depleted" : ""}`} onClick={() => onLotClick?.(lot)}>
            {/* Optional prefix column (e.g., antibody name for Dashboard) */}
            {prefixColumn && <td>{prefixColumn.render(lot)}</td>}

            {/* Lot number + age badge + barcode + custom badges */}
            <td style={{ whiteSpace: "nowrap" }}>
              <span>{lot.lot_number}</span>
              <LotAgeBadge age={lotAgeBadgeMap.get(lot.id)} />
              {customBadges?.get(lot.id)}
              {lot.vendor_barcode && (
                <div className="lot-barcode-inline">
                  {expandedBarcode === lot.id ? (
                    <>
                      <span
                        className="lot-barcode-text expanded"
                        onClick={() => setExpandedBarcode(null)}
                      >
                        {lot.vendor_barcode}
                      </span>
                      <button
                        className="lot-barcode-copy"
                        onClick={(e) => { e.stopPropagation(); handleCopy(lot.id, lot.vendor_barcode!); }}
                        title="Copy barcode"
                      >
                        {copiedId === lot.id ? "\u2713" : "\u2398"}
                      </button>
                    </>
                  ) : (
                    <span
                      className="lot-barcode-toggle"
                      onClick={() => setExpandedBarcode(lot.id)}
                    >
                      Show Barcode
                    </span>
                  )}
                </div>
              )}
            </td>

            {/* QC status badge (hidden for Dashboard sections where all lots share same status) */}
            {!hideQc && (
              <td>
                <QcBadge
                  status={lot.qc_status}
                  needsDoc={!!(qcDocRequired && !lot.has_qc_document)}
                />
              </td>
            )}

            {/* Received date */}
            {!hideReceived && <td>{formatDate(lot.created_at)}</td>}

            <td>{lot.expiration_date || "\u2014"}</td>
            <td>{lot.vial_counts?.sealed ?? 0}</td>
            {!sealedOnly && <td>{lot.vial_counts?.opened ?? 0}</td>}
            {showDepleted && <td>{lot.vial_counts?.depleted ?? 0}</td>}
            <td>{lot.vial_counts?.total ?? 0}</td>

            {/* Storage location */}
            {storageEnabled && (
              <td style={{ fontSize: "0.85em", whiteSpace: "nowrap" }}>
                {lot.storage_locations && lot.storage_locations.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {lot.storage_locations.map((loc) => (
                      <span key={loc.unit_id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span>{loc.unit_name}</span>
                        <span style={{ color: "var(--text-muted)" }}>({loc.vial_count})</span>
                      </span>
                    ))}
                    {lot.is_split && (
                      <span className="badge badge-yellow" style={{ fontSize: "0.65em", width: "fit-content" }}>Split</span>
                    )}
                  </div>
                ) : (
                  <span style={{ color: "var(--text-muted)" }}>{"\u2014"}</span>
                )}
              </td>
            )}

            {/* Extra columns (e.g., Dashboard Catalog#, Status, Backup) */}
            {extraColumns?.map((col) => (
              <td key={col.header}>{col.render(lot)}</td>
            ))}

            {/* Actions column (Approve + ActionMenu + extraActions) */}
            {!hideActions && (
              <td className="lot-actions-cell" onClick={(e) => e.stopPropagation()}>
                <div className="lot-actions-inline">
                  {canQC && lot.qc_status !== "approved" && onApproveQC && (
                    <button className="approve-chip" onClick={() => onApproveQC(lot.id)}>
                      Approve
                    </button>
                  )}
                  {extraActions?.(lot)}
                  <ActionMenu items={buildLotActions({ lot, onEditLot, onDeplete, onOpenDocs, onArchive, onConsolidate })} />
                </div>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
