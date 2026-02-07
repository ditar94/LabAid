import { useState } from "react";
import type { Lot } from "../api/types";
import type { LotListProps } from "./LotTable";
import ActionMenu, { type ActionMenuItem } from "./ActionMenu";

export default function LotCardList({
  lots,
  sealedOnly,
  canQC,
  qcDocRequired,
  lotAgeBadgeMap,
  onApproveQC,
  onDeplete,
  onOpenDocs,
  onArchive,
  onEditLot,
  onConsolidate,
  onLotClick,
  selectedLotId,
}: LotListProps) {
  const [expandedBarcode, setExpandedBarcode] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (lot: Lot) => {
    if (!lot.vendor_barcode) return;
    try {
      await navigator.clipboard.writeText(lot.vendor_barcode);
      setCopiedId(lot.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // Clipboard API not available
    }
  };

  const buildActions = (lot: Lot): ActionMenuItem[] => {
    const items: ActionMenuItem[] = [];
    if (onEditLot) {
      items.push({ label: "Edit", icon: "✎", onClick: () => onEditLot(lot) });
    }
    if ((lot.vial_counts?.total ?? 0) > 0) {
      items.push({ label: "Deplete", icon: "⊘", variant: "danger", onClick: () => onDeplete(lot) });
    }
    items.push({ label: `Docs${lot.documents?.length ? ` (${lot.documents.length})` : ""}`, icon: "📄", onClick: () => onOpenDocs(lot) });
    items.push({ label: lot.is_archived ? "Unarchive" : "Archive", icon: lot.is_archived ? "↩" : "▣", onClick: () => onArchive(lot) });
    if (lot.is_split && onConsolidate) {
      items.push({ label: "Consolidate", icon: "⊞", onClick: () => onConsolidate(lot) });
    }
    return items;
  };

  return (
    <div className="lot-card-list">
      {lots.map((lot) => (
        <div
          key={lot.id}
          className={`lot-card${lot.is_archived ? " lot-row-archived" : ""}${!lot.is_archived && (lot.vial_counts?.sealed ?? 0) + (lot.vial_counts?.opened ?? 0) === 0 && (lot.vial_counts?.depleted ?? 0) > 0 ? " lot-row-depleted" : ""}${onLotClick ? " clickable" : ""}${selectedLotId === lot.id ? " active" : ""}`}
          onClick={() => onLotClick?.(lot)}
        >
          {/* Header: lot number + QC badge + actions */}
          <div className="lot-card-header">
            <div className="lot-card-id">
              {lot.lot_number}
              {lotAgeBadgeMap.get(lot.id) === "current" && (
                <span className="badge badge-green" style={{ fontSize: "0.7em" }}>Current</span>
              )}
              {lotAgeBadgeMap.get(lot.id) === "new" && (
                <span className="badge" style={{ fontSize: "0.7em", background: "#6b7280", color: "#fff" }}>New</span>
              )}
            </div>
            <span style={{ display: "flex", gap: 6, alignItems: "center", marginLeft: "auto" }}>
              {qcDocRequired && lot.qc_status === "pending" && !lot.has_qc_document ? (
                <span className="badge badge-orange" title="QC document required">Pending</span>
              ) : (
                <span
                  className={`badge ${
                    lot.qc_status === "approved"
                      ? "badge-green"
                      : lot.qc_status === "failed"
                      ? "badge-red"
                      : "badge-yellow"
                  }`}
                >
                  {lot.qc_status}
                </span>
              )}
              {canQC && lot.qc_status !== "approved" && (
                <button className="approve-chip" onClick={(e) => { e.stopPropagation(); onApproveQC(lot.id); }}>
                  Approve
                </button>
              )}
              <span onClick={(e) => e.stopPropagation()}>
                <ActionMenu items={buildActions(lot)} />
              </span>
            </span>
          </div>

          {/* Body: details */}
          <div className="lot-card-body">
            <div className="lot-card-row">
              <span>Received</span>
              <span>{new Date(lot.created_at).toLocaleDateString()}</span>
            </div>
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

            {/* Storage location */}
            {lot.storage_locations && lot.storage_locations.length > 0 && (
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
                  onClick={() => handleCopy(lot)}
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
