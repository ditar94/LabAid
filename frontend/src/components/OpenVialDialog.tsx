import type { StorageCell } from "../api/types";

interface Props {
  cell: StorageCell;
  loading: boolean;
  onConfirm: (force: boolean) => void;
  onDeplete?: () => void;
  onViewLot: () => void;
  onCancel: () => void;
}

export default function OpenVialDialog({
  cell,
  loading,
  onConfirm,
  onDeplete,
  onViewLot,
  onCancel,
}: Props) {
  const vial = cell.vial;
  if (!vial) return null;

  const isOpened = vial.status === "opened";

  const needsQcWarning =
    !isOpened && vial.qc_status && vial.qc_status !== "approved";

  return (
    <div className="open-vial-dialog-overlay" onClick={onCancel}>
      <div
        className="open-vial-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{vial.antibody_target} - {vial.antibody_fluorochrome}</h3>
        <p>
          Lot: {vial.lot_number} | Cell: {cell.label} | Status: {vial.status}
        </p>

        {needsQcWarning && (
          <div className="qc-confirm-warning">
            This lot hasn't been approved yet (QC: {vial.qc_status}).
          </div>
        )}

        <div className="action-btns">
          {isOpened && onDeplete ? (
            <button
              className="btn-red"
              onClick={onDeplete}
              disabled={loading}
            >
              {loading ? "Depleting..." : "Deplete"}
            </button>
          ) : (
            <button
              className={needsQcWarning ? "btn-red" : "btn-green"}
              onClick={() => onConfirm(!!needsQcWarning)}
              disabled={loading}
            >
              {loading ? "Opening..." : "Open Vial"}
            </button>
          )}
          <button onClick={onViewLot}>
            View Lot
          </button>
          <button className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
