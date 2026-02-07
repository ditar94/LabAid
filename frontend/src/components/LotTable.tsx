import { useState } from "react";
import type { Lot } from "../api/types";
import ActionMenu, { type ActionMenuItem } from "./ActionMenu";

export interface LotListProps {
  lots: Lot[];
  sealedOnly: boolean;
  canQC: boolean;
  qcDocRequired?: boolean;
  lotAgeBadgeMap: Map<string, "current" | "new">;
  onApproveQC: (lotId: string) => void;
  onDeplete: (lot: Lot) => void;
  onOpenDocs: (lot: Lot) => void;
  onArchive: (lot: Lot) => void;
  onEditLot?: (lot: Lot) => void;
  onConsolidate?: (lot: Lot) => void;
  onLotClick?: (lot: Lot) => void;
  selectedLotId?: string | null;
}

export default function LotTable({
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
    } catch { /* clipboard not available */ }
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
    <table>
      <thead>
        <tr>
          <th>Lot #</th>
          <th>QC</th>
          <th>Received</th>
          <th>Expiration</th>
          <th>Sealed</th>
          {!sealedOnly && <th>Opened</th>}
          {!sealedOnly && <th>Depleted</th>}
          <th>Total</th>
          <th>Location</th>
          <th style={{ width: 120, textAlign: "center" }}></th>
        </tr>
      </thead>
      <tbody>
        {lots.map((lot) => (
          <tr key={lot.id} className={`${onLotClick ? "clickable-row" : ""}${selectedLotId === lot.id ? " active" : ""}${lot.is_archived ? " lot-row-archived" : ""}${!lot.is_archived && (lot.vial_counts?.sealed ?? 0) + (lot.vial_counts?.opened ?? 0) === 0 && (lot.vial_counts?.depleted ?? 0) > 0 ? " lot-row-depleted" : ""}`} onClick={() => onLotClick?.(lot)}>
            <td style={{ whiteSpace: "nowrap" }}>
              <span>{lot.lot_number}</span>
              {lotAgeBadgeMap.get(lot.id) === "current" && (
                <span className="badge badge-green" style={{ marginLeft: 6, fontSize: "0.7em" }}>Current</span>
              )}
              {lotAgeBadgeMap.get(lot.id) === "new" && (
                <span className="badge" style={{ marginLeft: 6, fontSize: "0.7em", background: "#6b7280", color: "#fff" }}>New</span>
              )}
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
                        onClick={(e) => { e.stopPropagation(); handleCopy(lot); }}
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
            <td>
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
            </td>
            <td>{new Date(lot.created_at).toLocaleDateString()}</td>
            <td>{lot.expiration_date || "\u2014"}</td>
            <td>{lot.vial_counts?.sealed ?? 0}</td>
            {!sealedOnly && <td>{lot.vial_counts?.opened ?? 0}</td>}
            {!sealedOnly && <td>{lot.vial_counts?.depleted ?? 0}</td>}
            <td>{lot.vial_counts?.total ?? 0}</td>
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
                <span style={{ color: "var(--text-muted)" }}>—</span>
              )}
            </td>
            <td className="lot-actions-cell" onClick={(e) => e.stopPropagation()}>
              <div className="lot-actions-inline">
                {canQC && lot.qc_status !== "approved" && (
                  <button className="approve-chip" onClick={() => onApproveQC(lot.id)}>
                    Approve
                  </button>
                )}
                <ActionMenu items={buildActions(lot)} />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
