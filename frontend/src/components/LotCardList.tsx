import { useEffect, useRef, useState } from "react";
import type { Lot } from "../api/types";
import type { LotListProps } from "./LotTable";

export default function LotCardList({
  lots,
  sealedOnly,
  canQC,
  lotAgeBadgeMap,
  onApproveQC,
  onDeplete,
  onOpenDocs,
  onArchive,
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

  const getPrimaryAction = (lot: Lot) => {
    if (!canQC) return null;
    if (lot.qc_status !== "approved") {
      return { label: "Approve", className: "btn-sm btn-green", handler: () => onApproveQC(lot.id) };
    }
    const hasVials = (lot.vial_counts?.opened ?? 0) > 0 || (lot.vial_counts?.total ?? 0) > 0;
    if (hasVials) {
      return { label: "Deplete", className: "btn-sm btn-red", handler: () => onDeplete(lot) };
    }
    return null;
  };

  return (
    <div className="lot-card-list">
      {lots.map((lot) => {
        const primary = getPrimaryAction(lot);
        const isApprovalPrimary = primary?.label === "Approve";
        const isDepletePrimary = primary?.label === "Deplete";
        const hasVialsToDep = (lot.vial_counts?.opened ?? 0) > 0 || (lot.vial_counts?.total ?? 0) > 0;

        return (
          <div
            key={lot.id}
            className={`lot-card${lot.is_archived ? " archived" : ""}`}
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
                  <span className="badge" style={{ fontSize: "0.7em", background: "#9ca3af", color: "#fff" }}>Archived</span>
                )}
              </div>
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
            </div>

            {/* Body: details */}
            <div className="lot-card-body">
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
              <div className="lot-card-actions">
                {primary && (
                  <button
                    className={`${primary.className} lot-card-primary-btn`}
                    onClick={primary.handler}
                  >
                    {primary.label}
                  </button>
                )}
                <div className="lot-card-overflow-wrapper" ref={openMenuId === lot.id ? menuRef : undefined}>
                  <button
                    className="lot-card-overflow-btn"
                    onClick={() => setOpenMenuId(openMenuId === lot.id ? null : lot.id)}
                  >
                    {"\u22EE"}
                  </button>
                  {openMenuId === lot.id && (
                    <div className="lot-card-overflow-menu">
                      {!isApprovalPrimary && lot.qc_status !== "approved" && (
                        <button onClick={() => { onApproveQC(lot.id); setOpenMenuId(null); }}>
                          Approve QC
                        </button>
                      )}
                      {!isDepletePrimary && hasVialsToDep && (
                        <button onClick={() => { onDeplete(lot); setOpenMenuId(null); }}>
                          Deplete
                        </button>
                      )}
                      <button onClick={() => { onOpenDocs(lot); setOpenMenuId(null); }}>
                        Docs{lot.documents?.length ? ` (${lot.documents.length})` : ""}
                      </button>
                      <button onClick={() => { onArchive(lot.id, lot.lot_number, lot.is_archived); setOpenMenuId(null); }}>
                        {lot.is_archived ? "Unarchive" : "Archive"}
                      </button>
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
