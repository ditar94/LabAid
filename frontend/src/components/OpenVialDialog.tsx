import type { StorageCell } from "../api/types";

interface Props {
  cell: StorageCell;
  loading: boolean;
  onConfirm: (force: boolean) => void;
  onCancel: () => void;
}

export default function OpenVialDialog({
  cell,
  loading,
  onConfirm,
  onCancel,
}: Props) {
  const vial = cell.vial;
  if (!vial) return null;

  const needsQcWarning =
    vial.qc_status && vial.qc_status !== "approved";

  return (
    <div className="open-vial-dialog-overlay" onClick={onCancel}>
      <div
        className="open-vial-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>Open Vial</h3>
        <p>
          <strong>{vial.antibody_target} - {vial.antibody_fluorochrome}</strong>
        </p>
        <p>
          Lot: {vial.lot_number} | Cell: {cell.label}
        </p>

        {needsQcWarning && (
          <div className="qc-confirm-warning">
            This lot hasn't been approved yet (QC: {vial.qc_status}).
            Are you sure you wish to open this vial?
          </div>
        )}

        <div className="action-btns">
          <button
            className={needsQcWarning ? "btn-red" : "btn-green"}
            onClick={() => onConfirm(!!needsQcWarning)}
            disabled={loading}
          >
            {loading
              ? "Opening..."
              : needsQcWarning
              ? "Yes, Open Anyway"
              : "Confirm Open"}
          </button>
          <button className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
