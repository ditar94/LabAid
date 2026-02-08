import { useState, useMemo, useCallback, useImperativeHandle, forwardRef } from "react";
import type { StorageCell, StorageGrid as StorageGridData } from "../../api/types";
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
import LotPanel from "./LotPanel";
import OpenVialDialog from "./OpenVialDialog";

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
    stockControl,
    onMoveChange,
    loading = false,
    className,
    extraPopoutActions,
    headerActions: headerActionsProp,
    moveHeaderExtra: moveHeaderExtraProp,
    highlightNextCellId,
    readOnly = false,
    excludeUnitIds: excludeUnitIdsProp,
    onCellSelect,
    selectedCellId,
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

  const unstoredCount = useMemo(() => {
    if (!stockControl || !lotFilter) return 0;
    const storedCount = stockControl.storedVialCount ?? (lotHighlightIds?.size ?? 0);
    return Math.max(0, stockControl.activeVialCount - storedCount);
  }, [stockControl, lotFilter, lotHighlightIds]);

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

  const resolvedHeaderActions = headerActionsProp
    ? headerActionsProp({ enterMoveMode: () => enterMoveMode() })
    : selectableVialIds.size > 0 && (
        <button className="move-header-btn" onClick={() => enterMoveMode()}>
          Move
        </button>
      );

  const resolvedMoveHeaderExtra = moveHeaderExtraProp
    ? moveHeaderExtraProp({ selectAll, addVialIds })
    : (
        <button className="move-header-btn" onClick={selectAll}>
          Select All
        </button>
      );

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER — conditional on workspaceMode, no intermediate flags
  // ═══════════════════════════════════════════════════════════════════════

  const selectedCount = workspaceSelection.sourceVialIds.size;

  const content = (
    <>
      {/* Lot panel — visible in lot mode and persists through move */}
      {lotFilter && (
        <LotPanel
          lotFilter={lotFilter}
          stockControl={stockControl}
          unstoredCount={unstoredCount}
          loading={loading}
          hasGrids={displayGrids.length > 0}
        />
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
          headerActions={resolvedHeaderActions}
          hideLegend={workspaceContext.hideLegend}
          legendExtra={legendExtra}
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
        />
      ))}

      {/* ── move: side-by-side transfer workflow ── */}
      {workspaceMode === "move" && (
        <div className="move-panel">
          {/* Header */}
          <div className="move-header">
            <div className="move-header-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M5 9l2-2 2 2M7 7v7a4 4 0 004 4h1M19 15l-2 2-2-2M17 17V10a4 4 0 00-4-4h-1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <span className="move-header-title">Transfer Vials</span>
            <span className={`move-header-count${selectedCount === 0 ? " empty" : ""}`}>
              {selectedCount}
            </span>
            <div className="move-header-actions">
              {resolvedMoveHeaderExtra}
              <button className="move-header-btn" onClick={clearSelection} disabled={selectedCount === 0}>
                Clear
              </button>
              <button className="move-header-btn" onClick={exitMoveMode}>
                Exit
              </button>
            </div>
          </div>

          {/* Two-panel body */}
          <div className="move-body move-split">
            {/* Left: Source */}
            <div className="move-pane">
              <div className="move-pane-label">Source</div>
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
              <div className="move-dest-select">
                <select
                  value={move.targetUnitId}
                  onChange={(e) => move.handleTargetUnitChange(e.target.value)}
                >
                  <option value="">Select destination...</option>
                  {storageUnits
                    .filter((u) => !(excludeUnitIdsProp ?? []).includes(u.id))
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}{u.temperature ? ` (${u.temperature})` : ""}{u.is_temporary ? " — Temp" : ""}
                      </option>
                    ))}
                </select>
              </div>

              {!move.targetUnitId && (
                <div className="move-dest-empty">
                  <div className="move-dest-empty-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </div>
                  <p>Choose a destination container above to see available cells</p>
                </div>
              )}

              {move.targetGrid && (
                <div className="move-dest-grid">
                  {move.destMode !== "auto" && (
                    <div className="move-dest-status">
                      <span>
                        {move.destMode === "start" && "Filling from selected cell"}
                        {move.destMode === "pick" && `${move.destPickedCellIds.size}/${selectedCount} cells picked`}
                      </span>
                      <button className="move-dest-reset" onClick={() => move.clearMode()}>Reset</button>
                    </div>
                  )}
                  <StorageGrid
                    rows={move.targetGrid.unit.rows}
                    cols={move.targetGrid.unit.cols}
                    cells={move.targetGrid.cells}
                    highlightVialIds={move.movedVialIds}
                    selectedCellId={move.destMode === "start" ? move.destStartCellId : undefined}
                    selectedCellIds={move.destMode === "pick" ? move.destPickedCellIds : undefined}
                    onCellClick={move.handleTargetCellClick}
                    selectionMode="destination"
                    previewCellIds={move.destMode === "start" ? move.previewCellIds : undefined}
                    fluorochromes={fluorochromes}
                  />
                  {move.insufficientCells && (
                    <p className="move-dest-warn">
                      {move.destMode === "pick"
                        ? `Select exactly ${selectedCount} cell(s).`
                        : "Not enough empty cells from here."}
                    </p>
                  )}
                </div>
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
        </div>
      )}

      {/* Open/deplete dialog */}
      {vialActions.openTarget && (
        <OpenVialDialog
          cell={vialActions.openTarget}
          loading={vialActions.openLoading}
          onConfirm={vialActions.handleOpenVial}
          onDeplete={vialActions.handleDepleteVial}
          onCancel={() => vialActions.setOpenTarget(null)}
        />
      )}
    </>
  );

  if (className) {
    return <div className={className}>{content}</div>;
  }

  return content;
});
