import { Fragment, useState, useCallback, useEffect, useRef } from "react";
import type { StorageCell, Fluorochrome } from "../api/types";

interface Props {
  rows: number;
  cols: number;
  cells: StorageCell[];
  highlightVialIds: Set<string>;
  highlightNextCellId?: string | null;
  recommendedCellId?: string | null;
  onCellClick?: (cell: StorageCell) => void;
  selectedCellId?: string | null;
  /** Cell IDs that are selected in multi-select mode */
  selectedCellIds?: Set<string>;
  clickMode?: "highlighted" | "empty" | "occupied";
  fluorochromes?: Fluorochrome[];
  /** When true, clicking a cell immediately triggers action without expand step */
  singleClickSelect?: boolean;
  /** Cell IDs to show as preview-fill (dashed blue border for move destination preview) */
  previewCellIds?: Set<string>;
  /** Function returning action buttons to render at the bottom of expanded cell popouts */
  popoutActions?: (cell: StorageCell) => Array<{
    label: string;
    onClick: () => void;
    variant?: "primary" | "danger" | "default";
  }>;
}

/** Convert a hex color to an rgba string at the given opacity. */
function hexToRgba(hex: string, opacity: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return "";
  return `rgba(${r},${g},${b},${opacity})`;
}

/** Format QC status for display. */
function qcLabel(qc: string | null | undefined): string {
  if (!qc) return "";
  if (qc === "approved") return "Approved";
  if (qc === "failed") return "Failed";
  return "Pending";
}

function qcBadgeClass(qc: string | null | undefined): string {
  if (qc === "approved") return "badge-green";
  if (qc === "failed") return "badge-red";
  return "badge-yellow";
}

export default function StorageGrid({
  rows,
  cols,
  cells,
  highlightVialIds,
  highlightNextCellId,
  recommendedCellId,
  onCellClick,
  selectedCellId,
  selectedCellIds,
  clickMode = "highlighted",
  fluorochromes = [],
  singleClickSelect = false,
  previewCellIds,
  popoutActions,
}: Props) {
  const [expandedCellId, setExpandedCellId] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Close expanded cell when clicking outside the grid
  useEffect(() => {
    if (!expandedCellId) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (gridRef.current && !gridRef.current.contains(e.target as Node)) {
        setExpandedCellId(null);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [expandedCellId]);

  // ESC key closes expanded cell
  useEffect(() => {
    if (!expandedCellId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpandedCellId(null);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [expandedCellId]);

  const cellMap = new Map<string, StorageCell>();
  for (const cell of cells) {
    cellMap.set(`${cell.row}-${cell.col}`, cell);
  }

  const fluoroMap = new Map<string, string>();
  for (const f of fluorochromes) {
    fluoroMap.set(f.name.toLowerCase(), f.color);
  }

  const handleCellClick = useCallback(
    (cell: StorageCell, isClickable: boolean) => {
      const hasVial = !!cell.vial_id;

      // In single-click select mode (e.g., move mode), skip expand and trigger immediately
      if (singleClickSelect) {
        if (isClickable) onCellClick?.(cell);
        return;
      }

      // When popoutActions provided: occupied cell taps only toggle popout, never fire onCellClick
      if (hasVial && cell.vial && popoutActions) {
        if (expandedCellId === cell.id) {
          setExpandedCellId(null);
        } else {
          setExpandedCellId(cell.id);
        }
        return;
      }

      // Legacy: first tap expands, second tap collapses + triggers action
      if (hasVial && cell.vial) {
        if (expandedCellId !== cell.id) {
          setExpandedCellId(cell.id);
          return;
        }
        setExpandedCellId(null);
      }

      if (isClickable) onCellClick?.(cell);
    },
    [expandedCellId, onCellClick, singleClickSelect, popoutActions]
  );

  // Collapse expanded cell when clicking outside
  const handleGridClick = useCallback(
    (e: React.MouseEvent) => {
      if (expandedCellId && (e.target as HTMLElement).closest(".grid-cell") === null) {
        setExpandedCellId(null);
      }
    },
    [expandedCellId]
  );

  return (
    <div
      ref={gridRef}
      className={`storage-grid${expandedCellId ? " has-expanded" : ""}`}
      style={{
        display: "grid",
        gridTemplateColumns: `24px repeat(${cols}, var(--grid-cell-size, 42px))`,
        gap: "2px",
      }}
      onClick={handleGridClick}
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
            const isSelected = cell.id === selectedCellId || (selectedCellIds?.has(cell.id) ?? false);
            const isNextEmpty = cell.id === highlightNextCellId;
            const isRecommended = cell.id === recommendedCellId;
            const isExpanded = cell.id === expandedCellId;

            const vialInfo = cell.vial;

            const isClickable =
              (clickMode === "highlighted" && isHighlighted) ||
              (clickMode === "empty" && !hasVial) ||
              (clickMode === "occupied" && hasVial);

            // When highlighting a specific lot, dim non-relevant occupied cells
            const hasHighlights = highlightVialIds.size > 0;
            const isDimmed = hasHighlights && hasVial && !isHighlighted && !isSelected && !isRecommended;

            let className = "grid-cell";
            if (isSelected) className += " selected";
            else if (isRecommended) className += " recommended";
            else if (isHighlighted) className += " highlighted";
            else if (isNextEmpty) className += " next-empty";
            else if (clickMode === "empty" && !hasVial) className += " empty-clickable";
            else if (clickMode === "occupied" && hasVial) className += " occupied-clickable";
            else if (hasVial) className += " occupied";

            if (previewCellIds?.has(cell.id)) className += " preview-fill";
            if (isExpanded && hasVial) className += " expanded";
            if (isDimmed) className += " dimmed";

            // Vial status classes
            if (hasVial && vialInfo) {
              if (vialInfo.status === "opened") className += " vial-opened";
            }

            const fluoroColor = vialInfo?.antibody_fluorochrome
              ? fluoroMap.get(vialInfo.antibody_fluorochrome.toLowerCase())
              : undefined;

            // Build inline style for fluorochrome tint
            const cellStyle: React.CSSProperties = {};
            if (hasVial && fluoroColor) {
              cellStyle["--fluoro-color" as string] = fluoroColor;
              cellStyle["--fluoro-bg" as string] = hexToRgba(fluoroColor, 0.12);
              cellStyle["--fluoro-bg-strong" as string] = hexToRgba(fluoroColor, 0.25);
            }

            // Determine popout positioning: if cell is in the right half of
            // the grid, pop out to the left; otherwise to the right.
            // Similarly for top/bottom.
            const popLeft = c >= cols / 2;
            const popUp = r >= rows / 2;

            return (
              <div
                key={`${r}-${c}`}
                className={className}
                onClick={() => handleCellClick(cell, isClickable)}
                style={cellStyle}
              >
                {hasVial && vialInfo ? (
                  <>
                    <span
                      className="cell-abbrev"
                      style={fluoroColor ? { color: fluoroColor } : undefined}
                    >
                      {vialInfo.antibody_target}
                    </span>
                    <div
                      className={`cell-popout${popLeft ? " pop-left" : " pop-right"}${popUp ? " pop-up" : " pop-down"}`}
                    >
                      {isExpanded && (
                        <button
                          className="popout-close"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedCellId(null);
                          }}
                          aria-label="Close"
                        >
                          ×
                        </button>
                      )}
                      <div className="popout-header" style={fluoroColor ? { color: fluoroColor } : undefined}>
                        {vialInfo.antibody_target}-{vialInfo.antibody_fluorochrome}
                      </div>
                      <div className="popout-row">
                        <span className="popout-label">Lot</span>
                        <span>{vialInfo.lot_number}</span>
                      </div>
                      {vialInfo.expiration_date && (
                        <div className="popout-row">
                          <span className="popout-label">Exp</span>
                          <span>{vialInfo.expiration_date}</span>
                        </div>
                      )}
                      <div className="popout-row">
                        <span className="popout-label">Status</span>
                        <span className={`popout-status popout-status-${vialInfo.status}`}>
                          {vialInfo.status}
                        </span>
                      </div>
                      {vialInfo.qc_status && (
                        <div className="popout-row">
                          <span className="popout-label">QC</span>
                          <span className={`badge badge-sm ${qcBadgeClass(vialInfo.qc_status)}`}>
                            {qcLabel(vialInfo.qc_status)}
                          </span>
                        </div>
                      )}
                      <div className="popout-cell-label">{cell.label}</div>
                      {isExpanded && popoutActions && (() => {
                        const actions = popoutActions(cell);
                        if (actions.length === 0) return null;
                        return (
                          <div className="popout-actions">
                            {actions.map((action, i) => (
                              <button
                                key={i}
                                className={`popout-action-btn${
                                  action.variant === "primary" ? " popout-action-primary" :
                                  action.variant === "danger" ? " popout-action-danger" : ""
                                }`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedCellId(null);
                                  action.onClick();
                                }}
                              >
                                {action.label}
                              </button>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  </>
                ) : (
                  <span className="cell-label">{cell.label}</span>
                )}
              </div>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
