import { Fragment, useState, useCallback, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { StorageCell, StorageUnit, Fluorochrome } from "../../api/types";
import { qcBadgeClass, qcLabel } from "../QcBadge";
import GridLegend from "./GridLegend";
import CapacityBar from "./CapacityBar";

interface Props {
  rows: number;
  cols: number;
  cells: StorageCell[];
  highlightVialIds: Set<string>;
  highlightNextCellId?: string | null;
  recommendedCellId?: string | null;
  onCellClick?: (cell: StorageCell) => void;
  selectedCellId?: string | null;
  selectedCellIds?: Set<string>;
  /**
   * Controls which cells are clickable and how clicks behave:
   * - "normal": occupied cells with popout expand/collapse (default)
   * - "source": highlighted occupied cells, immediate toggle (no expand)
   * - "destination": empty cells only, immediate action (no expand)
   */
  selectionMode?: "normal" | "source" | "destination";
  fluorochromes?: Fluorochrome[];
  previewCellIds?: Set<string>;
  popoutActions?: (cell: StorageCell) => Array<{
    label: string;
    onClick: () => void;
    variant?: "primary" | "danger" | "default";
  }>;
  unit?: StorageUnit;
  headerActions?: ReactNode;
  showTempBadge?: boolean;
  legendExtra?: ReactNode;
  hideLegend?: boolean;
}

function hexToRgba(hex: string, opacity: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return "";
  return `rgba(${r},${g},${b},${opacity})`;
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
  selectionMode = "normal",
  fluorochromes = [],
  previewCellIds,
  popoutActions,
  unit,
  headerActions,
  showTempBadge = true,
  legendExtra,
  hideLegend = false,
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
      // In source/destination mode: immediate action, skip expand/popout
      if (selectionMode === "source" || selectionMode === "destination") {
        if (isClickable) onCellClick?.(cell);
        return;
      }

      // "normal" mode
      const hasVial = !!cell.vial_id;

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
    [expandedCellId, onCellClick, selectionMode, popoutActions]
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

  const gridElement = (
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

            // Determine clickability based on selectionMode
            const isClickable =
              selectionMode === "destination" ? !hasVial :
              selectionMode === "source" ? hasVial :
              hasVial; // "normal"

            // When highlighting a specific lot, dim non-relevant occupied cells
            const hasHighlights = highlightVialIds.size > 0;
            const isDimmed = hasHighlights && hasVial && !isHighlighted && !isSelected && !isRecommended;

            let className = "grid-cell";
            if (isSelected) className += " selected";
            else if (isRecommended) className += " recommended";
            else if (isHighlighted) className += " highlighted";
            else if (isNextEmpty) className += " next-empty";
            else if (selectionMode === "destination" && !hasVial) className += " empty-clickable";
            else if (selectionMode === "normal" && hasVial) className += " occupied-clickable";
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
            const effectiveColor = fluoroColor || (vialInfo?.color ?? undefined);

            const cellStyle: React.CSSProperties = {};
            if (hasVial && effectiveColor) {
              (cellStyle as Record<string, string>)["--fluoro-color"] = effectiveColor;
              (cellStyle as Record<string, string>)["--fluoro-bg"] = hexToRgba(effectiveColor, 0.12);
              (cellStyle as Record<string, string>)["--fluoro-bg-strong"] = hexToRgba(effectiveColor, 0.25);
            }

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
                      style={effectiveColor ? { color: effectiveColor } : undefined}
                    >
                      {vialInfo.antibody_short_code || vialInfo.antibody_target}
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
                      <div className="popout-header" style={effectiveColor ? { color: effectiveColor } : undefined}>
                        {vialInfo.antibody_name || [vialInfo.antibody_target, vialInfo.antibody_fluorochrome].filter(Boolean).join("-") || "Unnamed"}
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

  // Panel mode: wrap grid with header + legend
  if (unit) {
    const totalCells = cells.length;
    const occupiedCount = cells.filter((c) => !!c.vial_id).length;

    return (
      <div className="grid-container">
        <div className="move-panel compact">
          <div className="move-header">
            <div className="move-header-icon">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <rect x="2" y="3" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
                <line x1="2" y1="10" x2="18" y2="10" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="10" cy="6.5" r="1" fill="currentColor" />
                <circle cx="10" cy="13.5" r="1" fill="currentColor" />
              </svg>
            </div>
            <span className="move-header-title">
              {unit.name}
              {showTempBadge && unit.is_temporary && (
                <span className="temp-badge">Auto</span>
              )}
            </span>
            {unit.temperature && (
              <span className="move-header-temp">{unit.temperature}</span>
            )}
            <div className="move-header-capacity">
              <CapacityBar occupied={occupiedCount} total={totalCells} />
            </div>
            {headerActions && (
              <div className="move-header-actions">
                {headerActions}
              </div>
            )}
          </div>
          <div className="move-body">
            {gridElement}
            {!hideLegend && (
              <GridLegend>{legendExtra}</GridLegend>
            )}
          </div>
        </div>
      </div>
    );
  }

  return gridElement;
}
