import { Fragment } from "react";
import type { StorageCell, Fluorochrome } from "../api/types";

interface Props {
  rows: number;
  cols: number;
  cells: StorageCell[];
  highlightVialIds: Set<string>;
  highlightNextCellId?: string | null;
  onCellClick?: (cell: StorageCell) => void;
  selectedCellId?: string | null;
  showVialInfo?: boolean;
  clickMode?: "highlighted" | "empty";
  fluorochromes?: Fluorochrome[];
}

export default function StorageGrid({
  rows,
  cols,
  cells,
  highlightVialIds,
  highlightNextCellId,
  onCellClick,
  selectedCellId,
  showVialInfo = false,
  clickMode = "highlighted",
  fluorochromes = [],
}: Props) {
  const cellMap = new Map<string, StorageCell>();
  for (const cell of cells) {
    cellMap.set(`${cell.row}-${cell.col}`, cell);
  }

  const fluoroMap = new Map<string, string>();
  for (const f of fluorochromes) {
    fluoroMap.set(f.name.toLowerCase(), f.color);
  }

  return (
    <div
      className="storage-grid"
      style={{
        display: "grid",
        gridTemplateColumns: `40px repeat(${cols}, 1fr)`,
        gap: "2px",
      }}
    >
      {/* Header row */}
      <div className="grid-header-corner" />
      {Array.from({ length: cols }, (_, c) => (
        <div key={`h-${c}`} className="grid-header">
          {c + 1}
        </div>
      ))}

      {/* Data rows */}
      {Array.from({ length: rows }, (_, r) => (
        <Fragment key={`row-${r}`}>
          <div className="grid-row-label">
            {String.fromCharCode(65 + r)}
          </div>
          {Array.from({ length: cols }, (_, c) => {
            const cell = cellMap.get(`${r}-${c}`);
            if (!cell)
              return <div key={`${r}-${c}`} className="grid-cell empty" />;

            const hasVial = !!cell.vial_id;
            const isHighlighted = cell.vial_id
              ? highlightVialIds.has(cell.vial_id)
              : false;
            const isSelected = cell.id === selectedCellId;
            const isNextEmpty = cell.id === highlightNextCellId;

            const isEmptyClickable = clickMode === "empty" && !hasVial;
            const isClickable =
              (clickMode === "highlighted" && isHighlighted) ||
              (clickMode === "empty" && !hasVial);

            let className = "grid-cell";
            if (isSelected) className += " selected";
            else if (isHighlighted) className += " highlighted";
            else if (isNextEmpty) className += " next-empty";
            else if (isEmptyClickable) className += " empty-clickable";
            else if (hasVial) className += " occupied";

            const vialInfo = cell.vial;
            const color = vialInfo?.antibody_fluorochrome
              ? fluoroMap.get(vialInfo.antibody_fluorochrome.toLowerCase())
              : undefined;

            const tooltip = vialInfo
              ? `${cell.label}: ${vialInfo.antibody_target}-${vialInfo.antibody_fluorochrome} (Lot ${vialInfo.lot_number})`
              : isClickable
              ? `Click to select ${cell.label}`
              : cell.label || "";

            return (
              <div
                key={`${r}-${c}`}
                className={className}
                onClick={() => {
                  if (isClickable) onCellClick?.(cell);
                }}
                title={tooltip}
              >
                {showVialInfo && vialInfo ? (
                  <>
                    {color && (
                      <div
                        className="color-dot"
                        style={{ backgroundColor: color }}
                      />
                    )}
                    <span className="cell-vial-info">
                      {vialInfo.antibody_target}-
                      {vialInfo.antibody_fluorochrome}
                      <span className="cell-exp-date">
                        {vialInfo.expiration_date
                          ? new Date(
                              vialInfo.expiration_date
                            ).toLocaleDateString("en-US", {
                              month: "2-digit",
                              year: "2-digit",
                            })
                          : ""}
                      </span>
                    </span>
                  </>
                ) : (
                  cell.label
                )}
              </div>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
