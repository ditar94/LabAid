import { useState, useMemo, useCallback, useImperativeHandle, forwardRef, useRef } from "react";
import { X } from "lucide-react";
import type { StorageCell, StorageUnit, StorageGrid as StorageGridData } from "../../api/types";
import type { Ref } from "react";
import { useVialActions } from "../../hooks/useVialActions";
import { useMoveVials } from "../../hooks/useMoveVials";
import { useSharedData } from "../../context/SharedDataContext";
import { useToast } from "../../context/ToastContext";
import type {
  StorageViewProps,
  StorageViewHandle,
  WorkspaceMode,
  WorkspaceContext,
  WorkspaceSelection,
  PopoutAction,
} from "./types";
import StorageGrid from "./StorageGrid";
import GridLegend from "./GridLegend";
import OpenVialDialog from "./OpenVialDialog";
import { Modal } from "../Modal";

const EMPTY_SET = new Set<string>();
const EMPTY_SELECTION: WorkspaceSelection = { sourceVialIds: new Set() };

export default forwardRef(function StorageWorkspace(
  {
    grids,
    fluorochromes,
    onRefresh,
    highlightVialIds: externalHighlightIds,
    legendExtra,
    hideLegend = false,
    highlightOnly = false,
    lotFilter,
    onMoveChange,
    toolbar,
    extraPopoutActions,
    headerActions: headerActionsProp,
    moveHeaderExtra: moveHeaderExtraProp,
    highlightNextCellId,
    readOnly = false,
    excludeUnitIds: excludeUnitIdsProp,
    onCellSelect,
    selectedCellId,
    onClose,
  }: StorageViewProps,
  ref: Ref<StorageViewHandle>
) {
  const { storageUnits } = useSharedData();
  const { addToast } = useToast();

  // ── Dev-only: warn on conflicting context props ──
  if (import.meta.env.DEV) {
    if (lotFilter && externalHighlightIds) {
      console.warn(
        "StorageView: lotFilter and highlightVialIds are both set. " +
        "lotFilter takes priority — highlightVialIds will be ignored."
      );
    }
    if (lotFilter && highlightOnly) {
      console.warn(
        "StorageView: highlightOnly is redundant when lotFilter is set " +
        "(lot mode forces highlightOnly internally)."
      );
    }
    if (highlightOnly && !externalHighlightIds && !lotFilter) {
      console.warn(
        "StorageView: highlightOnly is set but neither highlightVialIds " +
        "nor lotFilter is provided — no vials will be interactive."
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // WORKSPACE STATE MODEL — three centralized objects
  // ═══════════════════════════════════════════════════════════════════════

  // 1. workspaceMode — the single source of truth for workflow step
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(() =>
    lotFilter ? "lot" : (externalHighlightIds && highlightOnly) ? "scan" : "browse"
  );

  // 2. workspaceContext — derived workflow metadata (computed from props)
  const workspaceContext: WorkspaceContext = useMemo(() => ({
    baseMode: lotFilter ? "lot" : (externalHighlightIds && highlightOnly) ? "scan" : "browse",
    lotId: lotFilter?.lotId ?? null,
    highlightOnly: lotFilter ? true : highlightOnly,
    hideLegend: lotFilter ? true : hideLegend,
    isCellPicker: !!onCellSelect,
  }), [lotFilter, externalHighlightIds, highlightOnly, hideLegend, onCellSelect]);

  // 3. workspaceSelection — user selections within the current workflow
  const [workspaceSelection, setWorkspaceSelection] = useState<WorkspaceSelection>(EMPTY_SELECTION);

  // ═══════════════════════════════════════════════════════════════════════
  // DERIVED DATA — computed from props + context, no state
  // ═══════════════════════════════════════════════════════════════════════

  const { highlightIds: lotHighlightIds, relevantGrids } = useMemo(() => {
    if (!lotFilter) return { highlightIds: null, relevantGrids: null };
    const ids = new Set<string>();
    const relevant: StorageGridData[] = [];
    for (const grid of grids) {
      let hasLotVials = false;
      for (const cell of grid.cells) {
        if (cell.vial_id && cell.vial?.lot_id === lotFilter.lotId) {
          ids.add(cell.vial_id);
          hasLotVials = true;
        }
      }
      if (hasLotVials) relevant.push(grid);
    }
    return { highlightIds: ids, relevantGrids: relevant };
  }, [grids, lotFilter]);

  const highlightVialIds = lotHighlightIds ?? externalHighlightIds;
  const displayGrids = relevantGrids ?? grids;

  const selectableVialIds = useMemo(() => {
    const ids = new Set<string>();
    for (const grid of displayGrids) {
      for (const cell of grid.cells) {
        if (!cell.vial_id) continue;
        if (workspaceContext.highlightOnly && highlightVialIds && !highlightVialIds.has(cell.vial_id)) continue;
        ids.add(cell.vial_id);
      }
    }
    return ids;
  }, [displayGrids, workspaceContext.highlightOnly, highlightVialIds]);

  const isMultiGrid = displayGrids.length > 1;

  // ── Per-unit chip data (only for multi-grid) ──
  const unitChipData = useMemo(() => {
    if (!isMultiGrid) return null;
    return displayGrids.map((grid) => {
      const unitId = grid.unit.id;
      const unitName = grid.unit.name;
      const totalCells = grid.cells.length;
      const occupied = grid.cells.filter((c) => !!c.vial_id).length;

      if (workspaceMode === "move") {
        // Move mode: count = selected in this unit, total = selectable in this unit
        let selectable = 0;
        let selected = 0;
        for (const cell of grid.cells) {
          if (!cell.vial_id) continue;
          if (workspaceContext.highlightOnly && highlightVialIds && !highlightVialIds.has(cell.vial_id)) continue;
          selectable++;
          if (workspaceSelection.sourceVialIds.has(cell.vial_id)) selected++;
        }
        return { unitId, unitName, count: selected, total: selectable };
      }
      if (workspaceContext.isCellPicker) {
        // Cell picker: count = empty cells
        return { unitId, unitName, count: totalCells - occupied, total: null };
      }
      if (highlightVialIds && highlightVialIds.size > 0) {
        // Lot/scan mode: count = highlighted vials in this unit
        let highlighted = 0;
        for (const cell of grid.cells) {
          if (cell.vial_id && highlightVialIds.has(cell.vial_id)) highlighted++;
        }
        return { unitId, unitName, count: highlighted, total: null };
      }
      // Browse: count = occupied
      return { unitId, unitName, count: occupied, total: null };
    });
  }, [isMultiGrid, displayGrids, workspaceMode, workspaceContext.highlightOnly, workspaceContext.isCellPicker, highlightVialIds, workspaceSelection.sourceVialIds]);

  // ── Scroll-to-unit infrastructure ──
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollToUnit = useCallback((unitId: string) => {
    const el = bodyRef.current?.querySelector<HTMLDetailsElement>(`[data-unit-id="${unitId}"]`);
    if (!el) return;
    if (!el.open) el.open = true;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // ═══════════════════════════════════════════════════════════════════════
  // HOOKS — vial actions + move engine (external state, not workflow state)
  // ═══════════════════════════════════════════════════════════════════════

  const vialActions = useVialActions({
    onRefresh,
    onSuccess: (msg) => addToast(msg, "success"),
    onError: (msg) => addToast(msg, "danger"),
  });

  const move = useMoveVials({
    selectedVialCount: workspaceSelection.sourceVialIds.size,
    onSuccess: (count) => {
      addToast(`${count} vial${count !== 1 ? "s" : ""} moved`, "success");
      setWorkspaceSelection(EMPTY_SELECTION);
      onRefresh?.();
    },
    onError: (msg) => addToast(msg, "danger"),
  });

  // ═══════════════════════════════════════════════════════════════════════
  // WORKFLOW TRANSITIONS — all driven by workspaceMode changes
  // ═══════════════════════════════════════════════════════════════════════

  const enterMoveMode = useCallback((preselectedVialIds?: Set<string>) => {
    setWorkspaceMode("move");
    const initial = preselectedVialIds
      ?? (lotHighlightIds ? new Set(lotHighlightIds) : new Set<string>());
    setWorkspaceSelection({ sourceVialIds: initial });
    move.resetDestination();
    onMoveChange?.(true);
  }, [lotHighlightIds, move, onMoveChange]);

  const exitMoveMode = useCallback(() => {
    setWorkspaceMode(workspaceContext.baseMode);
    setWorkspaceSelection(EMPTY_SELECTION);
    move.resetDestination();
    onMoveChange?.(false);
  }, [workspaceContext.baseMode, move, onMoveChange]);

  useImperativeHandle(ref, () => ({ enterMoveMode, exitMoveMode }), [enterMoveMode, exitMoveMode]);

  // ═══════════════════════════════════════════════════════════════════════
  // SELECTION HANDLERS — update workspaceSelection only
  // ═══════════════════════════════════════════════════════════════════════

  const handleToggleVial = useCallback(
    (cell: StorageCell) => {
      if (!cell.vial_id) return;
      if (workspaceContext.highlightOnly && highlightVialIds && !highlightVialIds.has(cell.vial_id)) return;
      setWorkspaceSelection((prev) => {
        const next = new Set(prev.sourceVialIds);
        if (next.has(cell.vial_id!)) next.delete(cell.vial_id!);
        else next.add(cell.vial_id!);
        return { sourceVialIds: next };
      });
    },
    [workspaceContext.highlightOnly, highlightVialIds]
  );

  const selectAll = useCallback(() => {
    setWorkspaceSelection({ sourceVialIds: new Set(selectableVialIds) });
  }, [selectableVialIds]);

  const clearSelection = useCallback(() => {
    setWorkspaceSelection(EMPTY_SELECTION);
  }, []);

  const addVialIds = useCallback((ids: string[]) => {
    setWorkspaceSelection((prev) => {
      const next = new Set(prev.sourceVialIds);
      for (const id of ids) next.add(id);
      return { sourceVialIds: next };
    });
  }, []);

  const handleMoveExecute = async () => {
    if (workspaceSelection.sourceVialIds.size === 0 || !move.targetUnitId) return;
    await move.executeMove(Array.from(workspaceSelection.sourceVialIds));
  };

  // ═══════════════════════════════════════════════════════════════════════
  // POPOUT ACTIONS — cell click handlers for browse/lot/scan modes
  // ═══════════════════════════════════════════════════════════════════════

  const handleCellClick = useCallback(
    (cell: StorageCell) => {
      if (!cell.vial) return;
      if (workspaceContext.highlightOnly && highlightVialIds && !highlightVialIds.has(cell.vial_id!)) return;
      if (cell.vial.status !== "sealed" && cell.vial.status !== "opened") return;
      vialActions.setOpenTarget(cell);
    },
    [workspaceContext.highlightOnly, highlightVialIds, vialActions]
  );

  const getPopoutActions = useCallback(
    (cell: StorageCell) => {
      if (!cell.vial) return [];
      if (workspaceContext.highlightOnly && highlightVialIds && !highlightVialIds.has(cell.vial_id!)) return [];
      const vial = cell.vial;
      const actions: PopoutAction[] = [];
      if (vial.status === "sealed") {
        actions.push({ label: "Open", variant: "primary", onClick: () => handleCellClick(cell) });
      } else if (vial.status === "opened") {
        actions.push({ label: "Deplete", variant: "danger", onClick: () => handleCellClick(cell) });
      }
      if (extraPopoutActions) {
        actions.push(...extraPopoutActions(cell));
      }
      return actions;
    },
    [workspaceContext.highlightOnly, highlightVialIds, handleCellClick, extraPopoutActions]
  );

  // ═══════════════════════════════════════════════════════════════════════
  // RESOLVED HEADER ACTIONS
  // ═══════════════════════════════════════════════════════════════════════

  const selectedCount = workspaceSelection.sourceVialIds.size;

  const lotTitle = useMemo(() => {
    if (!lotFilter) return null;
    for (const grid of displayGrids) {
      for (const cell of grid.cells) {
        if (cell.vial?.lot_id === lotFilter.lotId) {
          const name = cell.vial.antibody_name
            || [cell.vial.antibody_target, cell.vial.antibody_fluorochrome].filter(Boolean).join("-")
            || "Unknown";
          return `${name} — Lot ${lotFilter.lotNumber}`;
        }
      }
    }
    return `Lot ${lotFilter.lotNumber}`;
  }, [lotFilter, displayGrids]);

  const resolvedMoveHeaderExtra = moveHeaderExtraProp
    ? moveHeaderExtraProp({ selectAll, addVialIds })
    : (
        <button className="sv-header-btn" onClick={selectAll}>
          Select All
        </button>
      );

  const resolvedHeaderActions = workspaceMode === "move" ? (
    <>
      <div className="sv-header-left">
        <span className="move-header-title">Transfer</span>
        <span className={`move-header-count${selectedCount === 0 ? " empty" : ""}`}>
          {selectedCount}
        </span>
      </div>
      {resolvedMoveHeaderExtra}
      <button className="sv-header-btn" onClick={clearSelection} disabled={selectedCount === 0}>
        Clear
      </button>
      <button className="sv-header-btn" onClick={exitMoveMode}>
        Exit
      </button>
    </>
  ) : headerActionsProp
    ? headerActionsProp({ enterMoveMode: () => enterMoveMode() })
    : selectableVialIds.size > 0 && (
        <button className="sv-header-btn sv-header-btn--primary" onClick={() => enterMoveMode()}>
          Move Vials
        </button>
      );

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER — conditional on workspaceMode, no intermediate flags
  // ═══════════════════════════════════════════════════════════════════════

  const header = (resolvedHeaderActions || onClose || lotTitle) ? (
    <div className={`sv-header${workspaceMode === "move" ? " sv-header--active" : ""}`}>
      {(onClose || lotTitle) && (
        <div className="sv-header-row">
          {lotTitle && <h3 className="sv-header-title">{lotTitle}</h3>}
          {onClose && <button className="sv-dismiss" onClick={onClose} aria-label="Close"><X size={16} /></button>}
        </div>
      )}
      {resolvedHeaderActions && (
        <div className="sv-header-actions">
          {resolvedHeaderActions}
        </div>
      )}
    </div>
  ) : null;

  const body = (
    <div className="sv-body" ref={bodyRef}>
      {/* ── Unit navigation chips (multi-grid only) ── */}
      {unitChipData && workspaceMode !== "move" && (
        <div className="sv-unit-chips">
          {unitChipData.map((chip) => (
            <button key={chip.unitId} className="sv-unit-chip" onClick={() => scrollToUnit(chip.unitId)}>
              <span className="sv-unit-chip-name">{chip.unitName}</span>
              <span className="sv-unit-chip-count">{chip.total != null ? `${chip.count}/${chip.total}` : chip.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── browse / lot / scan: grid panels with popouts ── */}
      {(workspaceMode === "browse" || workspaceMode === "lot" || workspaceMode === "scan") && !workspaceContext.isCellPicker && displayGrids.map((grid) => (
        <StorageGrid
          key={grid.unit.id}
          unit={grid.unit}
          rows={grid.unit.rows}
          cols={grid.unit.cols}
          cells={grid.cells}
          highlightVialIds={readOnly ? EMPTY_SET : (highlightVialIds ?? EMPTY_SET)}
          highlightNextCellId={highlightNextCellId}
          onCellClick={readOnly ? undefined : handleCellClick}
          selectionMode="normal"
          fluorochromes={fluorochromes}
          popoutActions={readOnly ? undefined : getPopoutActions}
          hideLegend={workspaceContext.hideLegend}
          legendExtra={legendExtra}
          collapsible
        />
      ))}

      {/* ── browse / lot / scan + cell picker: destination selection ── */}
      {(workspaceMode === "browse" || workspaceMode === "lot" || workspaceMode === "scan") && workspaceContext.isCellPicker && displayGrids.map((grid) => (
        <StorageGrid
          key={grid.unit.id}
          unit={grid.unit}
          rows={grid.unit.rows}
          cols={grid.unit.cols}
          cells={grid.cells}
          highlightVialIds={EMPTY_SET}
          onCellClick={onCellSelect}
          selectedCellId={selectedCellId}
          selectionMode="destination"
          fluorochromes={fluorochromes}
          hideLegend
          collapsible
        />
      ))}

      {/* ── move: source/destination panes + footer ── */}
      {workspaceMode === "move" && (
        <>
          <div className="move-body move-split">
            {/* Left: Source */}
            <div className="move-pane">
              <div className="move-pane-label">Source</div>
              {unitChipData && (
                <div className="sv-unit-chips">
                  {unitChipData.map((chip) => (
                    <button key={chip.unitId} className="sv-unit-chip" onClick={() => scrollToUnit(chip.unitId)}>
                      <span className="sv-unit-chip-name">{chip.unitName}</span>
                      <span className="sv-unit-chip-count">{chip.total != null ? `${chip.count}/${chip.total}` : chip.count}</span>
                    </button>
                  ))}
                </div>
              )}
              {displayGrids.map((grid) => (
                <StorageGrid
                  key={grid.unit.id}
                  unit={grid.unit}
                  rows={grid.unit.rows}
                  cols={grid.unit.cols}
                  cells={grid.cells}
                  highlightVialIds={workspaceSelection.sourceVialIds}
                  onCellClick={handleToggleVial}
                  selectionMode="source"
                  fluorochromes={fluorochromes}
                  hideLegend
                  collapsible
                />
              ))}
              <GridLegend>
                <span className="legend-item">
                  <span className="legend-box highlighted-legend" /> Selected
                </span>
              </GridLegend>
            </div>

            {/* Right: Destination */}
            <div className="move-pane">
              <div className="move-pane-label">Destination</div>

              {move.targetGrid && move.destMode !== "auto" && (
                <div className="move-dest-status">
                  <span>
                    {move.destMode === "start" && "Filling from selected cell"}
                    {move.destMode === "pick" && `${move.destPickedCellIds.size}/${selectedCount} cells picked`}
                  </span>
                  <button className="move-dest-reset" onClick={() => move.clearMode()}>Reset</button>
                </div>
              )}
              <StorageGrid
                unit={move.targetGrid?.unit ?? { id: "", name: "", rows: 0, cols: 0 } as StorageUnit}
                rows={move.targetGrid?.unit.rows ?? 0}
                cols={move.targetGrid?.unit.cols ?? 0}
                cells={move.targetGrid?.cells ?? []}
                highlightVialIds={move.targetGrid ? move.movedVialIds : EMPTY_SET}
                selectedCellId={move.destMode === "start" ? move.destStartCellId : undefined}
                selectedCellIds={move.destMode === "pick" ? move.destPickedCellIds : undefined}
                onCellClick={move.targetGrid ? move.handleTargetCellClick : undefined}
                selectionMode="destination"
                previewCellIds={move.destMode === "start" ? move.previewCellIds : undefined}
                fluorochromes={fluorochromes}
                hideLegend
                collapsible
                unitOptions={storageUnits
                  .filter((u) => !(excludeUnitIdsProp ?? []).includes(u.id))
                  .map((u) => ({
                    id: u.id,
                    label: `${u.name}${u.temperature ? ` (${u.temperature})` : ""}${u.is_temporary ? " — Temp" : ""}`,
                  }))}
                onUnitChange={move.handleTargetUnitChange}
              />
              {move.insufficientCells && (
                <p className="move-dest-warn">
                  {move.destMode === "pick"
                    ? `Select exactly ${selectedCount} cell(s).`
                    : "Not enough empty cells from here."}
                </p>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="move-footer">
            {move.targetGrid && (
              <span className="move-footer-status">
                {move.destMode === "auto" && "Vials will fill next available cells"}
                {move.destMode === "start" && "Click a cell to set starting position"}
                {move.destMode === "pick" && `${move.destPickedCellIds.size} of ${selectedCount} cells picked`}
              </span>
            )}
            <button
              className="move-go-btn"
              onClick={handleMoveExecute}
              disabled={selectedCount === 0 || !move.targetUnitId || move.loading || move.insufficientCells}
            >
              {move.loading ? "Moving..." : `Move ${selectedCount} Vial${selectedCount !== 1 ? "s" : ""}`}
            </button>
          </div>
        </>
      )}
    </div>
  );

  const panel = (
    <div className="sv-panel" onClick={(e) => e.stopPropagation()}>
      {header}
      {toolbar}
      {body}
    </div>
  );

  if (onClose) {
    return (
      <Modal onClose={onClose} ariaLabel={lotFilter ? `Storage for ${lotFilter.lotNumber}` : "Storage"}>
        <div className="sv-modal">
          {panel}
          {vialActions.openTarget && (
            <OpenVialDialog
              cell={vialActions.openTarget}
              loading={vialActions.openLoading}
              onConfirm={vialActions.handleOpenVial}
              onDeplete={vialActions.handleDepleteVial}
              onCancel={() => vialActions.setOpenTarget(null)}
            />
          )}
        </div>
      </Modal>
    );
  }

  return panel;
});
