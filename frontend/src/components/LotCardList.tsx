// ── LotCardList — Shared mobile card layout for lot rows ─────────────────────
// Mobile companion to LotTable. Uses the same LotListProps interface so both
// components can be swapped via `isMobile ? <LotCardList> : <LotTable>`.

import type { LotListProps } from "./LotTable";
import ActionMenu from "./ActionMenu";
import QcBadge from "./QcBadge";
import LotAgeBadge from "./LotAgeBadge";
import { formatDate } from "../utils/format";
import { buildLotActions } from "../utils/lotActions";
import { useLotBarcodeCopy } from "../hooks/useLotBarcodeCopy";

export default function LotCardList({
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
  hideQc,
  hideReceived,
}: LotListProps) {
  const { expandedBarcode, setExpandedBarcode, copiedId, handleCopy } = useLotBarcodeCopy();

  return (
    <div className="lot-card-list">
      {lots.map((lot) => (
        <div
          key={lot.id}
          className={`lot-card${lot.is_archived ? " lot-row-archived" : ""}${!lot.is_archived && (lot.vial_counts?.sealed ?? 0) + (lot.vial_counts?.opened ?? 0) === 0 && (lot.vial_counts?.depleted ?? 0) > 0 ? " lot-row-depleted" : ""}${onLotClick ? " clickable" : ""}${selectedLotId === lot.id ? " active" : ""}`}
          onClick={() => onLotClick?.(lot)}
        >
          {/* Optional prefix (e.g., antibody name + vendor for Dashboard) */}
          {prefixColumn && (
            <div style={{ padding: "0.5rem 0.75rem 0", fontWeight: 600, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              {prefixColumn.render(lot)}
            </div>
          )}

          {/* Header: lot number + QC badge + actions */}
          <div className="lot-card-header">
            <div className="lot-card-id">
              {lot.lot_number}
              <LotAgeBadge age={lotAgeBadgeMap.get(lot.id)} />
              {/* Custom badges (e.g., Dashboard contextual badges) */}
              {customBadges?.get(lot.id)}
            </div>
            <span style={{ display: "flex", gap: 6, alignItems: "center", marginLeft: "auto" }}>
              {!hideQc && (
                <QcBadge
                  status={lot.qc_status}
                  needsDoc={!!(qcDocRequired && !lot.has_qc_document)}
                />
              )}
              {!hideActions && canQC && lot.qc_status !== "approved" && onApproveQC && (
                <button className="approve-chip" onClick={(e) => { e.stopPropagation(); onApproveQC(lot.id); }}>
                  Approve
                </button>
              )}
              {!hideActions && extraActions && (
                <span onClick={(e) => e.stopPropagation()}>
                  {extraActions(lot)}
                </span>
              )}
              {!hideActions && (
                <span onClick={(e) => e.stopPropagation()}>
                  <ActionMenu items={buildLotActions({ lot, onEditLot, onDeplete, onOpenDocs, onArchive, onConsolidate })} />
                </span>
              )}
            </span>
          </div>

          {/* Body: details */}
          <div className="lot-card-body">
            {!hideReceived && (
              <div className="lot-card-row">
                <span>Received</span>
                <span>{formatDate(lot.created_at)}</span>
              </div>
            )}
            <div className="lot-card-row">
              <span>Expiration</span>
              <span>{lot.expiration_date || "\u2014"}</span>
            </div>
            <div className="lot-card-row">
              <span>Sealed</span>
              <span>{lot.vial_counts?.sealed ?? 0}</span>
            </div>
            {!sealedOnly && (
              <div className="lot-card-row">
                <span>Opened</span>
                <span>{lot.vial_counts?.opened ?? 0}</span>
              </div>
            )}
            <div className="lot-card-row">
              <span>Total</span>
              <span><strong>{lot.vial_counts?.total ?? 0}</strong></span>
            </div>

            {/* Extra columns rendered as additional card rows */}
            {extraColumns?.map((col) => (
              <div key={col.header} className="lot-card-row">
                <span>{col.header}</span>
                <span>{col.render(lot)}</span>
              </div>
            ))}

            {/* Storage location */}
            {storageEnabled && lot.storage_locations && lot.storage_locations.length > 0 && (
              <div className="lot-card-row" style={{ alignItems: "flex-start" }}>
                <span>Location</span>
                <span style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-end" }}>
                  {lot.storage_locations.map((loc) => (
                    <span key={loc.unit_id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span>{loc.unit_name}</span>
                      <span style={{ color: "var(--text-muted)" }}>({loc.vial_count})</span>
                    </span>
                  ))}
                  {lot.is_split && (
                    <span className="badge badge-yellow" style={{ fontSize: "0.65em" }}>Split</span>
                  )}
                </span>
              </div>
            )}

            {/* Barcode tap-to-view */}
            {lot.vendor_barcode && (
              <div className="lot-card-barcode">
                <span
                  className={`lot-card-barcode-text${expandedBarcode === lot.id ? " expanded" : ""}`}
                  onClick={() => setExpandedBarcode(expandedBarcode === lot.id ? null : lot.id)}
                >
                  {expandedBarcode === lot.id
                    ? lot.vendor_barcode
                    : lot.vendor_barcode.length > 12
                    ? lot.vendor_barcode.slice(0, 12) + "\u2026"
                    : lot.vendor_barcode}
                </span>
                <button
                  className="lot-card-copy-btn"
                  onClick={() => handleCopy(lot.id, lot.vendor_barcode!)}
                  title="Copy barcode"
                >
                  {copiedId === lot.id ? "\u2713" : "\u2398"}
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
