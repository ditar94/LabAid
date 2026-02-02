import type { Lot } from "../api/types";

export interface LotListProps {
  lots: Lot[];
  sealedOnly: boolean;
  canQC: boolean;
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
  lotAgeBadgeMap,
  onApproveQC,
  onDeplete,
  onOpenDocs,
  onArchive,
}: LotListProps) {
  return (
    <table>
      <thead>
        <tr>
          <th>Lot #</th>
          <th>Vendor Barcode</th>
          <th>QC</th>
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
            <td>
              {lot.lot_number}
              {lotAgeBadgeMap.get(lot.id) === "current" && (
                <span className="badge badge-green" style={{ marginLeft: 6, fontSize: "0.7em" }}>Current</span>
              )}
              {lotAgeBadgeMap.get(lot.id) === "new" && (
                <span className="badge" style={{ marginLeft: 6, fontSize: "0.7em", background: "#6b7280", color: "#fff" }}>New</span>
              )}
            </td>
            <td className="wrap">{lot.vendor_barcode || "\u2014"}</td>
            <td>
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
              {lot.is_archived && (
                <span
                  className="badge"
                  style={{
                    marginLeft: 6,
                    fontSize: "0.7em",
                    background: "#9ca3af",
                    color: "#fff",
                  }}
                >
                  Archived
                </span>
              )}
            </td>
            <td>{lot.expiration_date || "\u2014"}</td>
            <td>{lot.vial_counts?.sealed ?? 0}</td>
            {!sealedOnly && <td>{lot.vial_counts?.opened ?? 0}</td>}
            {!sealedOnly && <td>{lot.vial_counts?.depleted ?? 0}</td>}
            <td>{lot.vial_counts?.total ?? 0}</td>
            {canQC && (
              <td className="action-btns">
                {lot.qc_status !== "approved" && (
                  <button
                    className="btn-sm btn-green"
                    onClick={() => onApproveQC(lot.id)}
                  >
                    Approve
                  </button>
                )}
                {(lot.vial_counts?.opened ?? 0) > 0 && (
                  <button
                    className="btn-sm btn-red"
                    onClick={() => onDeplete(lot)}
                    title={`Deplete vials for lot ${lot.lot_number}`}
                  >
                    Deplete
                  </button>
                )}
                {(lot.vial_counts?.opened ?? 0) === 0 && (lot.vial_counts?.total ?? 0) > 0 && (
                  <button
                    className="btn-sm btn-red"
                    onClick={() => onDeplete(lot)}
                    title={`Deplete all ${lot.vial_counts?.total ?? 0} active vials (sealed + opened)`}
                  >
                    Deplete
                  </button>
                )}
                <button
                  className="btn-sm"
                  onClick={() => onOpenDocs(lot)}
                  title="QC documents"
                >
                  Docs{lot.documents?.length ? ` (${lot.documents.length})` : ""}
                </button>
                <button
                  className="btn-sm"
                  onClick={() => onArchive(lot.id, lot.lot_number, lot.is_archived)}
                  title={lot.is_archived ? "Unarchive this lot" : "Archive this lot"}
                >
                  {lot.is_archived ? "Unarchive" : "Archive"}
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
