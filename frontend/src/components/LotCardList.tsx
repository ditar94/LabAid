import { useEffect, useRef, useState } from "react";
import type { Lot } from "../api/types";
import type { LotListProps } from "./LotTable";

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
  onConsolidate,
  onLotClick,
  selectedLotId,
}: LotListProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [expandedBarcode, setExpandedBarcode] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
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
    } catch {
      // Clipboard API not available
    }
  };

  return (
    <div className="lot-card-list">
      {lots.map((lot) => {
        const canApprove = lot.qc_status !== "approved";
        const hasVialsToDep = (lot.vial_counts?.total ?? 0) > 0;

        return (
          <div
            key={lot.id}
            className={`lot-card${lot.is_archived || ((lot.vial_counts?.sealed ?? 0) + (lot.vial_counts?.opened ?? 0) === 0 && (lot.vial_counts?.depleted ?? 0) > 0) ? " archived" : ""}${onLotClick ? " clickable" : ""}${selectedLotId === lot.id ? " active" : ""}`}
            onClick={() => onLotClick?.(lot)}
          >
            {/* Header: lot number + QC badge */}
            <div className="lot-card-header">
              <div className="lot-card-id">
                {lot.lot_number}
                {lotAgeBadgeMap.get(lot.id) === "current" && (
                  <span className="badge badge-green" style={{ fontSize: "0.7em" }}>Current</span>
                )}
                {lotAgeBadgeMap.get(lot.id) === "new" && (
                  <span className="badge" style={{ fontSize: "0.7em", background: "#6b7280", color: "#fff" }}>New</span>
                )}
                {lot.is_archived && (
                  <span className="badge" style={{ fontSize: "0.7em", background: "#9ca3af", color: "#fff" }} title={lot.archive_note || undefined}>Archived</span>
                )}
                {!lot.is_archived && (lot.vial_counts?.sealed ?? 0) + (lot.vial_counts?.opened ?? 0) === 0 && (lot.vial_counts?.depleted ?? 0) > 0 && (
                  <span className="badge" style={{ fontSize: "0.7em", background: "#9ca3af", color: "#fff" }}>Depleted</span>
                )}
                {lot.has_temp_storage && (
                  <span className="temp-badge" style={{ fontSize: "0.65em", padding: "0.1rem 0.35rem" }}>In Temp Storage</span>
                )}
              </div>
              <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
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

            {/* Actions: primary + overflow */}
            {canQC && (
              <div className="lot-card-actions" onClick={(e) => e.stopPropagation()}>
                <div className="lot-actions-wrapper" ref={openMenuId === lot.id ? menuRef : undefined}>
                  <button
                    className="lot-actions-trigger"
                    onClick={() => setOpenMenuId(openMenuId === lot.id ? null : lot.id)}
                  >
                    Actions
                    <span className="lot-actions-caret">{openMenuId === lot.id ? "\u25B2" : "\u25BC"}</span>
                  </button>
                  {openMenuId === lot.id && (
                    <div className="lot-actions-menu">
                      {canApprove && (
                        <button className="btn-sm btn-green" onClick={() => { onApproveQC(lot.id); setOpenMenuId(null); }}>
                          Approve QC
                        </button>
                      )}
                      {hasVialsToDep && (
                        <button className="btn-sm btn-red" onClick={() => { onDeplete(lot); setOpenMenuId(null); }}>
                          Deplete
                        </button>
                      )}
                      <button className="btn-sm" onClick={() => { onOpenDocs(lot); setOpenMenuId(null); }}>
                        Docs{lot.documents?.length ? ` (${lot.documents.length})` : ""}
                      </button>
                      <button className="btn-sm" onClick={() => { onArchive(lot); setOpenMenuId(null); }}>
                        {lot.is_archived ? "Unarchive" : "Archive"}
                      </button>
                      {lot.is_split && onConsolidate && (
                        <button className="btn-sm" onClick={() => { onConsolidate(lot); setOpenMenuId(null); }}>
                          Consolidate
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
