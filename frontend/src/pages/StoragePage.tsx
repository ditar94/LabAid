import { useEffect, useState, useRef, useCallback, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/client";
import type {
  StorageGrid as StorageGridType,
  StorageCell,
} from "../api/types";
import StorageGrid from "../components/StorageGrid";
import MoveDestination from "../components/MoveDestination";
import OpenVialDialog from "../components/OpenVialDialog";
import BarcodeScannerButton from "../components/BarcodeScannerButton";
import { useAuth } from "../context/AuthContext";
import { useSharedData } from "../context/SharedDataContext";
import { useToast } from "../context/ToastContext";
import { useMoveVials } from "../hooks/useMoveVials";

const EMPTY_ARRAY: string[] = [];

export default function StoragePage() {
  const { user } = useAuth();
  const { labs, fluorochromes, storageUnits: units, selectedLab, setSelectedLab, refreshStorageUnits } = useSharedData();
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [consolidateLotId, setConsolidateLotId] = useState<string | null>(null);
  const [selectedGrid, setSelectedGrid] = useState<StorageGridType | null>(
    null
  );
  const [showForm, setShowForm] = useState(false);
  const [stockingMode, setStockingMode] = useState(false);
  const [nextEmptyCell, setNextEmptyCell] = useState<StorageCell | null>(null);
  const [barcode, setBarcode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    name: "",
    rows: 10,
    cols: 10,
    temperature: "",
  });

  // Open vial dialog state
  const [openTarget, setOpenTarget] = useState<StorageCell | null>(null);
  const [openLoading, setOpenLoading] = useState(false);

  // Move vials mode state
  const [moveMode, setMoveMode] = useState(false);
  const [selectedVialIds, setSelectedVialIds] = useState<Set<string>>(new Set());
  const [moveView, setMoveView] = useState<"source" | "destination">("source");

  // We need a ref to selectedGrid so the hook callbacks can access the latest value
  const selectedGridRef = useRef(selectedGrid);
  selectedGridRef.current = selectedGrid;

  const move = useMoveVials({
    selectedVialCount: selectedVialIds.size,
    onSuccess: (count) => {
      setMessage(`Moved ${count} vial(s) successfully.`);
      addToast(`Moved ${count} vial(s)`, "success");
      setSelectedVialIds(new Set());
      // Refresh the grid
      const grid = selectedGridRef.current;
      if (grid) loadGrid(grid.unit.id);
    },
    onError: (msg) => {
      setError(msg);
      addToast("Failed to move vials", "danger");
    },
  });

  const canCreate = user?.role === "super_admin" || user?.role === "lab_admin" || user?.role === "supervisor";
  const canStock =
    user?.role === "super_admin" ||
    user?.role === "lab_admin" ||
    user?.role === "supervisor" ||
    user?.role === "tech";

  // Clear selected grid when lab changes
  useEffect(() => {
    setSelectedGrid(null);
  }, [selectedLab]);

  // Handle ?lotId=&unitId= consolidation deep-link, or ?unitId= direct navigation
  useEffect(() => {
    const lotId = searchParams.get("lotId");
    const unitId = searchParams.get("unitId");
    if (lotId && unitId) {
      setConsolidateLotId(lotId);
      setSearchParams({}, { replace: true });
      loadGrid(unitId);
    } else if (unitId) {
      setSearchParams({}, { replace: true });
      loadGrid(unitId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After grid loads for consolidation, enter move mode and select the lot's vials
  useEffect(() => {
    if (!consolidateLotId || !selectedGrid) return;
    const lotId = consolidateLotId;
    setConsolidateLotId(null);
    setMoveMode(true);
    setSelectedVialIds(new Set());
    move.resetDestination();
    setMessage(null);
    setError(null);
    // Auto-select vials from the consolidation lot
    const lots = getLotsInGrid();
    const lot = lots.find((l) => l.lot_id === lotId);
    if (lot) {
      setSelectedVialIds(new Set(lot.vial_ids));
    }
  }, [selectedGrid, consolidateLotId]);

  const loadGrid = async (unitId: string) => {
    const res = await api.get(`/storage/units/${unitId}/grid`);
    setSelectedGrid(res.data);
    setStockingMode(false);
    setNextEmptyCell(null);
    setMessage(null);
    setError(null);
  };

  const loadNextEmpty = async (unitId: string) => {
    try {
      const res = await api.get(`/storage/units/${unitId}/next-empty`);
      setNextEmptyCell(res.data);
    } catch {
      setNextEmptyCell(null);
    }
  };

  const enterStockingMode = () => {
    if (!selectedGrid) return;
    setStockingMode(true);
    setMessage(null);
    setError(null);
    loadNextEmpty(selectedGrid.unit.id);
    setTimeout(() => scanRef.current?.focus(), 100);
  };

  const handleStock = async (override?: string) => {
    const code = (override ?? barcode).trim();
    if (!code || !selectedGrid) return;
    setMessage(null);
    setError(null);

    try {
      const res = await api.post(
        `/storage/units/${selectedGrid.unit.id}/stock`,
        { barcode: code }
      );
      const cell = res.data;
      const vialInfo = cell.vial;
      const stockLabel = vialInfo?.antibody_name || [vialInfo?.antibody_target, vialInfo?.antibody_fluorochrome].filter(Boolean).join("-") || "Unknown";
      setMessage(
        `Stocked ${stockLabel} (Lot ${vialInfo?.lot_number}) into cell ${cell.label}`
      );
      setBarcode("");
      // Refresh grid and next empty
      await loadGrid(selectedGrid.unit.id);
      setStockingMode(true);
      await loadNextEmpty(selectedGrid.unit.id);
      scanRef.current?.focus();
    } catch (err: any) {
      const status = err.response?.status;
      const detail = err.response?.data?.detail || "Failed to stock vial";
      if (status === 404) {
        setError(`not_registered:${code}`);
      } else {
        setError(detail);
      }
      setBarcode("");
      scanRef.current?.focus();
    }
  };

  const handleGridCellClick = (cell: StorageCell) => {
    if (!cell.vial || (cell.vial.status !== "sealed" && cell.vial.status !== "opened")) return;
    setOpenTarget(cell);
  };

  const getPopoutActions = useCallback(
    (cell: StorageCell) => {
      if (!cell.vial) return [];
      const vial = cell.vial;
      const actions: Array<{ label: string; onClick: () => void; variant?: "primary" | "danger" | "default" }> = [];

      if (vial.status === "sealed") {
        actions.push({ label: "Open", variant: "primary", onClick: () => setOpenTarget(cell) });
      } else if (vial.status === "opened") {
        actions.push({ label: "Deplete", variant: "danger", onClick: () => setOpenTarget(cell) });
      }

      actions.push({
        label: "View Lot",
        onClick: () => {
          const abId = vial.antibody_id;
          if (abId) navigate(`/inventory?antibodyId=${abId}`);
        },
      });

      return actions;
    },
    [navigate]
  );

  const handleOpenVial = async (force: boolean) => {
    if (!openTarget?.vial) return;
    setOpenLoading(true);
    try {
      await api.post(`/vials/${openTarget.vial.id}/open?force=${force}`, {
        cell_id: openTarget.id,
      });
      setMessage(`Vial opened from cell ${openTarget.label}. Status updated.`);
      addToast(`Vial opened from ${openTarget.label}`, "success");
      setOpenTarget(null);
      if (selectedGrid) await loadGrid(selectedGrid.unit.id);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to open vial");
      addToast("Failed to open vial", "danger");
      setOpenTarget(null);
    } finally {
      setOpenLoading(false);
    }
  };

  const handleDepleteVial = async () => {
    if (!openTarget?.vial) return;
    setOpenLoading(true);
    try {
      await api.post(`/vials/${openTarget.vial.id}/deplete`);
      setMessage(`Vial depleted from cell ${openTarget.label}. Status updated.`);
      addToast(`Vial depleted from ${openTarget.label}`, "success");
      setOpenTarget(null);
      if (selectedGrid) await loadGrid(selectedGrid.unit.id);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to deplete vial");
      addToast("Failed to deplete vial", "danger");
      setOpenTarget(null);
    } finally {
      setOpenLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleStock();
    }
  };

  // Get unique lots from current grid for "Select entire lot" dropdown
  const getLotsInGrid = () => {
    if (!selectedGrid) return [];
    const lotMap = new Map<string, { lot_id: string; lot_number: string; label: string; vial_ids: string[] }>();
    for (const cell of selectedGrid.cells) {
      if (cell.vial && (cell.vial.status === "sealed" || cell.vial.status === "opened")) {
        const lotId = cell.vial.lot_id;
        const existing = lotMap.get(lotId);
        if (existing) {
          existing.vial_ids.push(cell.vial.id);
        } else {
          lotMap.set(lotId, {
            lot_id: lotId,
            lot_number: cell.vial.lot_number || "Unknown",
            label: `${cell.vial.antibody_name || [cell.vial.antibody_target, cell.vial.antibody_fluorochrome].filter(Boolean).join("-") || "Unknown"} (${cell.vial.lot_number || "?"})`,
            vial_ids: [cell.vial.id],
          });
        }
      }
    }
    return Array.from(lotMap.values());
  };

  const enterMoveMode = () => {
    setMoveMode(true);
    setSelectedVialIds(new Set());
    move.resetDestination();
    setMoveView("source");
    setMessage(null);
    setError(null);
  };

  const exitMoveMode = () => {
    setMoveMode(false);
    setSelectedVialIds(new Set());
    move.resetDestination();
    setMessage(null);
    setError(null);
  };

  const handleMoveCellClick = (cell: StorageCell) => {
    if (!cell.vial || (cell.vial.status !== "sealed" && cell.vial.status !== "opened")) return;
    const vialId = cell.vial.id;
    setSelectedVialIds((prev) => {
      const next = new Set(prev);
      if (next.has(vialId)) {
        next.delete(vialId);
      } else {
        next.add(vialId);
      }
      return next;
    });
  };

  const handleSelectLot = (lotId: string) => {
    const lots = getLotsInGrid();
    const lot = lots.find((l) => l.lot_id === lotId);
    if (!lot) return;
    setSelectedVialIds((prev) => {
      const next = new Set(prev);
      for (const vid of lot.vial_ids) {
        next.add(vid);
      }
      return next;
    });
  };

  const handleMoveVials = async () => {
    if (selectedVialIds.size === 0 || !move.targetUnitId) return;
    setMessage(null);
    setError(null);
    await move.executeMove(Array.from(selectedVialIds));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const params: Record<string, string> = {};
    if (user?.role === "super_admin" && selectedLab) {
      params.lab_id = selectedLab;
    }
    await api.post(
      "/storage/units",
      {
        ...form,
        temperature: form.temperature || null,
      },
      { params }
    );
    setForm({ name: "", rows: 10, cols: 10, temperature: "" });
    setShowForm(false);
    refreshStorageUnits();
  };

  return (
    <div>
      <div className="page-header">
        <h1>Storage Units</h1>
        <div className="filters">
          {user?.role === "super_admin" && (
            <select
              value={selectedLab}
              onChange={(e) => setSelectedLab(e.target.value)}
            >
              {labs.map((lab) => (
                <option key={lab.id} value={lab.id}>
                  {lab.name}
                </option>
              ))}
            </select>
          )}
          {canCreate && (
            <button onClick={() => setShowForm(!showForm)}>
              {showForm ? "Cancel" : "+ New Storage Unit"}
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <form className="inline-form" onSubmit={handleSubmit}>
          <input
            placeholder="Name (e.g., Freezer Box A1)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <input
            type="number"
            placeholder="Rows"
            min={1}
            max={26}
            value={form.rows}
            onChange={(e) =>
              setForm({ ...form, rows: parseInt(e.target.value) || 1 })
            }
            required
          />
          <input
            type="number"
            placeholder="Columns"
            min={1}
            max={26}
            value={form.cols}
            onChange={(e) =>
              setForm({ ...form, cols: parseInt(e.target.value) || 1 })
            }
            required
          />
          <input
            placeholder="Temperature (e.g., -20C)"
            value={form.temperature}
            onChange={(e) =>
              setForm({ ...form, temperature: e.target.value })
            }
          />
          <button type="submit">Create</button>
        </form>
      )}

      <div className="storage-list stagger-reveal">
        {units.map((unit) => (
          <div
            key={unit.id}
            className={`storage-card ${
              selectedGrid?.unit.id === unit.id ? "active" : ""
            } ${unit.is_temporary ? "temp-storage" : ""}`}
            onClick={() => loadGrid(unit.id)}
          >
            <h3>
              {unit.name}
              {unit.is_temporary && <span className="temp-badge">Auto</span>}
            </h3>
            <p>
              {unit.is_temporary ? (
                "Dynamic sizing"
              ) : (
                <>
                  {unit.rows} x {unit.cols} {unit.temperature || ""}
                </>
              )}
            </p>
          </div>
        ))}
        {units.length === 0 && (
          <p className="empty">No storage units created</p>
        )}
      </div>

      {selectedGrid && (
        <div className="grid-container">
          {selectedGrid.unit.is_temporary && !moveMode && (
            <p className="page-desc">
              Newly received vials appear here. Use <strong>Move Vials</strong> to transfer them to permanent storage.
            </p>
          )}

          {stockingMode && (
            <div className="stocking-panel">
              <p className="page-desc">
                Scan a vial barcode to place it in the next open slot
                {nextEmptyCell ? (
                  <>
                    {" "}
                    — next slot:{" "}
                    <strong>{nextEmptyCell.label}</strong>
                  </>
                ) : (
                  " — storage unit is full"
                )}
              </p>
              <div className="scan-input-container">
                <input
                  ref={scanRef}
                  className="scan-input"
                  placeholder="Scan vial barcode..."
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={!nextEmptyCell}
                  autoFocus
                />
                <BarcodeScannerButton
                  label="Scan"
                  disabled={!nextEmptyCell}
                  onDetected={(value) => {
                    setBarcode(value);
                    handleStock(value);
                  }}
                />
                <button
                  onClick={() => handleStock()}
                  disabled={!nextEmptyCell || !barcode.trim()}
                >
                  Stock
                </button>
              </div>
              {message && <p className="success">{message}</p>}
              {error && error.startsWith("not_registered:") ? (
                <p className="error">
                  Barcode not registered.{" "}
                  <Link to={`/scan?barcode=${encodeURIComponent(error.slice("not_registered:".length))}`}>
                    Go to Scan/Search to register
                  </Link>
                </p>
              ) : error ? (
                <p className="error">{error}</p>
              ) : null}
            </div>
          )}

          <div className={`move-panel${!moveMode ? " compact" : ""}`}>
            <div className="move-header">
              {moveMode ? (
                <>
                  <div className="move-header-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M5 9l2-2 2 2M7 7v7a4 4 0 004 4h1M19 15l-2 2-2-2M17 17V10a4 4 0 00-4-4h-1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </div>
                  <span className="move-header-title">Transfer Vials</span>
                  <span className={`move-header-count${selectedVialIds.size === 0 ? " empty" : ""}`}>{selectedVialIds.size}</span>
                  <div className="move-header-actions">
                    <select
                      value=""
                      onChange={(e) => e.target.value && handleSelectLot(e.target.value)}
                    >
                      <option value="">Select lot...</option>
                      {getLotsInGrid().map((lot) => (
                        <option key={lot.lot_id} value={lot.lot_id}>
                          {lot.label} ({lot.vial_ids.length})
                        </option>
                      ))}
                    </select>
                    <button className="move-header-btn" onClick={() => setSelectedVialIds(new Set())} disabled={selectedVialIds.size === 0}>
                      Clear
                    </button>
                    <button className="move-header-btn" onClick={exitMoveMode}>
                      Exit
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="move-header-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </div>
                  <span className="move-header-title">
                    {selectedGrid.unit.name}
                    {selectedGrid.unit.is_temporary && <span className="temp-badge" style={{ marginLeft: "var(--space-sm)" }}>Auto</span>}
                  </span>
                  {selectedGrid.unit.temperature && (
                    <span className="move-header-temp">{selectedGrid.unit.temperature}</span>
                  )}
                  {(() => {
                    const totalCells = selectedGrid.cells.length;
                    const occupiedCount = selectedGrid.cells.filter(c => !!c.vial_id).length;
                    const occupiedPercent = totalCells > 0 ? Math.round((occupiedCount / totalCells) * 100) : 0;
                    const fillClass = occupiedPercent >= 90 ? "fill-danger" : occupiedPercent >= 70 ? "fill-warning" : "fill-ok";
                    return (
                      <div className="move-header-capacity">
                        <div className="capacity-bar">
                          <div className={`capacity-fill ${fillClass}`} style={{ width: `${occupiedPercent}%` }} />
                        </div>
                        <span className="capacity-text">{occupiedCount}/{totalCells}</span>
                      </div>
                    );
                  })()}
                  <div className="move-header-actions">
                    {canStock && !stockingMode && !selectedGrid.unit.is_temporary && (
                      <button className="move-header-btn" onClick={enterStockingMode}>Stock</button>
                    )}
                    {canStock && !stockingMode && (
                      <button className="move-header-btn" onClick={enterMoveMode}>Move</button>
                    )}
                    {stockingMode && (
                      <button className="move-header-btn" onClick={() => {
                        setStockingMode(false);
                        setNextEmptyCell(null);
                        setMessage(null);
                        setError(null);
                      }}>Exit Stocking</button>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="move-body">
              {!stockingMode && message && <p className="success">{message}</p>}
              {!stockingMode && error && error.startsWith("not_registered:") ? (
                <p className="error">
                  Barcode not registered.{" "}
                  <Link to={`/scan?barcode=${encodeURIComponent(error.slice("not_registered:".length))}`}>
                    Go to Scan/Search to register
                  </Link>
                </p>
              ) : !stockingMode && error ? (
                <p className="error">{error}</p>
              ) : null}

              {moveMode && (
                <div className="move-view-toggle">
                  <button className={moveView === "source" ? "active" : ""} onClick={() => setMoveView("source")}>Source</button>
                  <button className={moveView === "destination" ? "active" : ""} onClick={() => setMoveView("destination")}>Destination</button>
                </div>
              )}
              <div className="move-layout">
                <div className={`move-pane${moveMode && moveView === "destination" ? " move-hidden" : ""}`}>
                  {moveMode && <div className="move-pane-label">Source</div>}
                  {moveMode && (() => {
                    const totalCells = selectedGrid.cells.length;
                    const occupiedCount = selectedGrid.cells.filter(c => !!c.vial_id).length;
                    const occupiedPercent = totalCells > 0 ? Math.round((occupiedCount / totalCells) * 100) : 0;
                    const fillClass = occupiedPercent >= 90 ? "fill-danger" : occupiedPercent >= 70 ? "fill-warning" : "fill-ok";
                    return (
                      <div className="grid-info-header">
                        <span className="grid-info-name">{selectedGrid.unit.name}</span>
                        {selectedGrid.unit.temperature && (
                          <span className="grid-info-temp">{selectedGrid.unit.temperature}</span>
                        )}
                        <div className="capacity-bar">
                          <div className={`capacity-fill ${fillClass}`} style={{ width: `${occupiedPercent}%` }} />
                        </div>
                        <span className="capacity-text">{occupiedCount}/{totalCells}</span>
                      </div>
                    );
                  })()}
                  <StorageGrid
                    rows={selectedGrid.unit.rows}
                    cols={selectedGrid.unit.cols}
                    cells={selectedGrid.cells}
                    highlightVialIds={moveMode ? selectedVialIds : new Set()}
                    highlightNextCellId={!moveMode && stockingMode ? nextEmptyCell?.id : undefined}
                    onCellClick={
                      moveMode
                        ? handleMoveCellClick
                        : !stockingMode && canStock
                          ? handleGridCellClick
                          : undefined
                    }
                    clickMode={moveMode ? "occupied" : !stockingMode && canStock ? "occupied" : "highlighted"}
                    fluorochromes={fluorochromes}
                    singleClickSelect={moveMode ? true : undefined}
                    popoutActions={!moveMode && !stockingMode ? getPopoutActions : undefined}
                  />
                  <div className="grid-legend">
                    <span className="legend-item"><span className="legend-box sealed" /> Sealed</span>
                    <span className="legend-item"><span className="legend-box opened" /> Opened</span>
                    <span className="legend-item"><span className="legend-box" /> Empty</span>
                    {moveMode && (
                      <span className="legend-item"><span className="legend-box highlighted-legend" /> Selected</span>
                    )}
                    {!moveMode && stockingMode && (
                      <span className="legend-item">
                        <span className="legend-box next-empty-legend" /> Next slot
                      </span>
                    )}
                    {!moveMode && !stockingMode && canStock && (
                      <span className="legend-item">
                        Tap a vial to see actions
                      </span>
                    )}
                  </div>
                </div>
                {moveMode && (
                  <>
                    <div className={`move-arrow${move.targetUnitId ? " has-dest" : ""}`}>
                      <div className="move-arrow-line" />
                      <div className="move-arrow-icon">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M5 12H19M15 6L21 12L15 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </div>
                    </div>
                    <div className={`move-pane${moveView === "source" ? " move-hidden" : ""}`}>
                      <div className="move-pane-label">Destination</div>
                      <MoveDestination
                        move={move}
                        selectedVialCount={selectedVialIds.size}
                        fluorochromes={fluorochromes}
                        storageUnits={units}
                        excludeUnitIds={EMPTY_ARRAY}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>

            {moveMode && (
              <div className="move-footer">
                {move.targetGrid && (
                  <span className="move-footer-status">
                    {move.destMode === "auto" && "Vials will fill next available cells"}
                    {move.destMode === "start" && "Click a cell to set starting position"}
                    {move.destMode === "pick" && `${move.destPickedCellIds.size} of ${selectedVialIds.size} cells picked`}
                  </span>
                )}
                <button
                  className="move-go-btn"
                  onClick={handleMoveVials}
                  disabled={selectedVialIds.size === 0 || !move.targetUnitId || move.loading || move.insufficientCells}
                >
                  {move.loading ? "Moving..." : `Move ${selectedVialIds.size} Vial${selectedVialIds.size !== 1 ? "s" : ""}`}
                </button>
              </div>
            )}
          </div>

          {openTarget && (
            <OpenVialDialog
              cell={openTarget}
              loading={openLoading}
              onConfirm={handleOpenVial}
              onDeplete={handleDepleteVial}
              onViewLot={() => {
                const abId = openTarget.vial?.antibody_id;
                setOpenTarget(null);
                if (abId) navigate(`/inventory?antibodyId=${abId}`);
              }}
              onCancel={() => setOpenTarget(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}
