import type { Fluorochrome, StorageUnit } from "../api/types";
import type { UseMoveVialsReturn } from "../hooks/useMoveVials";
import StorageGrid from "./StorageGrid";

interface MoveDestinationProps {
  move: UseMoveVialsReturn;
  selectedVialCount: number;
  fluorochromes: Fluorochrome[];
  storageUnits: StorageUnit[];
  excludeUnitIds?: string[];
}

export default function MoveDestination({
  move,
  selectedVialCount,
  fluorochromes,
  storageUnits,
  excludeUnitIds = [],
}: MoveDestinationProps) {
  return (
    <>
      <div className="move-dest-select">
        <select
          value={move.targetUnitId}
          onChange={(e) => move.handleTargetUnitChange(e.target.value)}
        >
          <option value="">Select destination...</option>
          {storageUnits
            .filter((u) => !excludeUnitIds.includes(u.id))
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
                {move.destMode === "pick" && `${move.destPickedCellIds.size}/${selectedVialCount} cells picked`}
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
            clickMode="empty"
            singleClickSelect
            previewCellIds={move.destMode === "start" ? move.previewCellIds : undefined}
            fluorochromes={fluorochromes}
          />
          {move.insufficientCells && (
            <p className="move-dest-warn">
              {move.destMode === "pick"
                ? `Select exactly ${selectedVialCount} cell(s).`
                : "Not enough empty cells from here."}
            </p>
          )}
        </div>
      )}
    </>
  );
}
