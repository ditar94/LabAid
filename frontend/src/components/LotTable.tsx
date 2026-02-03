import { useEffect, useRef, useState } from "react";
import type { Lot } from "../api/types";

export interface LotListProps {
  lots: Lot[];
  sealedOnly: boolean;
  canQC: boolean;
  qcDocRequired?: boolean;
  lotAgeBadgeMap: Map<string, "current" | "new">;
  onApproveQC: (lotId: string) => void;
  onDeplete: (lot: Lot) => void;
  onOpenDocs: (lot: Lot) => void;
  onArchive: (lotId: string, lotNumber: string, isArchived: boolean) => void;
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
}: LotListProps) {
  const [expandedBarcode, setExpandedBarcode] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenuId) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [openMenuId]);

  const handleCopy = async (lot: Lot) => {
    if (!lot.vendor_barcode) return;
    try {
      await navigator.clipboard.writeText(lot.vendor_barcode);
      setCopiedId(lot.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch { /* clipboard not available */ }
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
          {canQC && <th>Actions</th>}
        </tr>
      </thead>
      <tbody>
        {lots.map((lot) => (
          <tr key={lot.id} style={lot.is_archived ? { opacity: 0.5 } : undefined}>
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
            <td style={{ whiteSpace: "nowrap" }}>
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
              {qcDocRequired && lot.qc_status === "pending" && !lot.has_qc_document && (
                <span className="badge badge-orange needs-doc-badge">Needs QC</span>
              )}
              {lot.is_archived && (
                <span
                  className="badge"
                  style={{
                    marginLeft: 6,
                    fontSize: "0.7em",
                    background: "#9ca3af",
                    color: "#fff",
                  }}
                  title={lot.archive_note || undefined}
                >
                  Archived
                </span>
              )}
            </td>
            <td>{new Date(lot.created_at).toLocaleDateString()}</td>
            <td>{lot.expiration_date || "\u2014"}</td>
            <td>{lot.vial_counts?.sealed ?? 0}</td>
            {!sealedOnly && <td>{lot.vial_counts?.opened ?? 0}</td>}
            {!sealedOnly && <td>{lot.vial_counts?.depleted ?? 0}</td>}
            <td>{lot.vial_counts?.total ?? 0}</td>
            {canQC && (
              <td className="lot-actions-cell">
                <div className="lot-actions-wrapper" ref={openMenuId === lot.id ? menuRef : undefined}>
                  <button
                    className="lot-actions-trigger"
                    onClick={() => setOpenMenuId(openMenuId === lot.id ? null : lot.id)}
                  >
                    Show
                    <span className="lot-actions-caret">{openMenuId === lot.id ? "\u25B2" : "\u25BC"}</span>
                  </button>
                  {openMenuId === lot.id && (
                    <div className="lot-actions-menu">
                      {lot.qc_status !== "approved" && (
                        <button className="btn-sm btn-green" onClick={() => { onApproveQC(lot.id); setOpenMenuId(null); }}>
                          Approve
                        </button>
                      )}
                      {(lot.vial_counts?.total ?? 0) > 0 && (
                        <button className="btn-sm btn-red" onClick={() => { onDeplete(lot); setOpenMenuId(null); }}>
                          Deplete
                        </button>
                      )}
                      <button className="btn-sm" onClick={() => { onOpenDocs(lot); setOpenMenuId(null); }}>
                        Docs{lot.documents?.length ? ` (${lot.documents.length})` : ""}
                      </button>
                      <button className="btn-sm" onClick={() => { onArchive(lot.id, lot.lot_number, lot.is_archived); setOpenMenuId(null); }}>
                        {lot.is_archived ? "Unarchive" : "Archive"}
                      </button>
                    </div>
                  )}
                </div>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
