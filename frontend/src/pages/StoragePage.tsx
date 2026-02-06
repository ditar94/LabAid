import { useEffect, useState, useRef, useMemo, useCallback, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/client";
import type {
  StorageUnit,
  StorageGrid as StorageGridType,
  StorageCell,
  Lab,
  Fluorochrome,
  VialMoveResult,
} from "../api/types";
import StorageGrid from "../components/StorageGrid";
import OpenVialDialog from "../components/OpenVialDialog";
import BarcodeScannerButton from "../components/BarcodeScannerButton";
import { useAuth } from "../context/AuthContext";

export default function StoragePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [consolidateLotId, setConsolidateLotId] = useState<string | null>(null);
  const [labs, setLabs] = useState<Lab[]>([]);
  const [selectedLab, setSelectedLab] = useState<string>("");
  const [units, setUnits] = useState<StorageUnit[]>([]);
  const [selectedGrid, setSelectedGrid] = useState<StorageGridType | null>(
    null
  );
  const [fluorochromes, setFluorochromes] = useState<Fluorochrome[]>([]);
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
  const [targetUnitId, setTargetUnitId] = useState<string>("");
  const [moveLoading, setMoveLoading] = useState(false);
  const [moveTargetGrid, setMoveTargetGrid] = useState<StorageGridType | null>(null);
  const [moveDestMode, setMoveDestMode] = useState<"auto" | "start" | "pick">("auto");
  const [moveDestStartCellId, setMoveDestStartCellId] = useState<string | null>(null);
  const [moveDestPickedCellIds, setMoveDestPickedCellIds] = useState<Set<string>>(new Set());

  const canCreate = user?.role === "super_admin" || user?.role === "lab_admin" || user?.role === "supervisor";
  const canStock =
    user?.role === "super_admin" ||
    user?.role === "lab_admin" ||
    user?.role === "supervisor" ||
    user?.role === "tech";

  const loadUnits = () => {
    const params: Record<string, string> = {};
    if (user?.role === "super_admin" && selectedLab) {
      params.lab_id = selectedLab;
    }
    api.get("/storage/units", { params }).then((r) => {
      setUnits(r.data);
      setSelectedGrid(null);
    });
  };

  const loadFluorochromes = () => {
    const params: Record<string, string> = {};
    if (user?.role === "super_admin" && selectedLab) {
      params.lab_id = selectedLab;
    }
    api.get("/fluorochromes/", { params }).then((r) => {
      setFluorochromes(r.data);
    });
  };

  useEffect(() => {
    if (user?.role === "super_admin") {
      api.get("/labs").then((r) => {
        setLabs(r.data);
        if (r.data.length > 0) {
          setSelectedLab(r.data[0].id);
        }
      });
    } else if (user) {
      setSelectedLab(user.lab_id);
    }
  }, [user]);

  useEffect(() => {
    if (selectedLab) {
      loadUnits();
      loadFluorochromes();
    }
  }, [selectedLab]);

  // Handle ?lotId=&unitId= consolidation deep-link
  useEffect(() => {
    const lotId = searchParams.get("lotId");
    const unitId = searchParams.get("unitId");
    if (lotId && unitId) {
      setConsolidateLotId(lotId);
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
    setTargetUnitId("");
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
      setMessage(
        `Stocked ${vialInfo?.antibody_target}-${vialInfo?.antibody_fluorochrome} (Lot ${vialInfo?.lot_number}) into cell ${cell.label}`
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
      setOpenTarget(null);
      if (selectedGrid) await loadGrid(selectedGrid.unit.id);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to open vial");
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
      setOpenTarget(null);
      if (selectedGrid) await loadGrid(selectedGrid.unit.id);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to deplete vial");
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
            label: `${cell.vial.antibody_target}-${cell.vial.antibody_fluorochrome} (${cell.vial.lot_number || "?"})`,
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
    setTargetUnitId("");
    setMoveTargetGrid(null);
    setMoveDestMode("auto");
    setMoveDestStartCellId(null);
    setMoveDestPickedCellIds(new Set());
    setMessage(null);
    setError(null);
  };

  const exitMoveMode = () => {
    setMoveMode(false);
    setSelectedVialIds(new Set());
    setTargetUnitId("");
    setMoveTargetGrid(null);
    setMoveDestMode("auto");
    setMoveDestStartCellId(null);
    setMoveDestPickedCellIds(new Set());
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

  const handleMoveTargetChange = async (unitId: string) => {
    setTargetUnitId(unitId);
    setMoveDestMode("auto");
    setMoveDestStartCellId(null);
    setMoveDestPickedCellIds(new Set());
    setMoveTargetGrid(null);
    if (!unitId) return;
    try {
      const res = await api.get<StorageGridType>(`/storage/units/${unitId}/grid`);
      setMoveTargetGrid(res.data);
    } catch { /* skip */ }
  };

  const handleMoveTargetCellClick = (cell: StorageCell) => {
    if (cell.vial_id) return;
    if (moveDestMode === "auto") {
      setMoveDestMode("start");
      setMoveDestStartCellId(cell.id);
    } else if (moveDestMode === "start") {
      if (moveDestStartCellId === cell.id) {
        setMoveDestMode("auto");
        setMoveDestStartCellId(null);
      } else {
        setMoveDestMode("pick");
        setMoveDestPickedCellIds(new Set([moveDestStartCellId!, cell.id]));
        setMoveDestStartCellId(null);
      }
    } else {
      setMoveDestPickedCellIds((prev) => {
        const next = new Set(prev);
        if (next.has(cell.id)) next.delete(cell.id);
        else next.add(cell.id);
        return next;
      });
    }
  };

  const movePreviewCellIds = useMemo(() => {
    if (moveDestMode !== "start" || !moveTargetGrid || !moveDestStartCellId || selectedVialIds.size === 0) return new Set<string>();
    const emptyCells = moveTargetGrid.cells
      .filter((c) => !c.vial_id)
      .sort((a, b) => a.row - b.row || a.col - b.col);
    const startIdx = emptyCells.findIndex((c) => c.id === moveDestStartCellId);
    if (startIdx < 0) return new Set<string>();
    const preview = emptyCells.slice(startIdx, startIdx + selectedVialIds.size);
    return new Set(preview.map((c) => c.id));
  }, [moveTargetGrid, moveDestStartCellId, selectedVialIds, moveDestMode]);

  const moveInsufficientCells = useMemo(() => {
    if (moveDestMode === "start") {
      if (!moveDestStartCellId || !moveTargetGrid) return false;
      return movePreviewCellIds.size < selectedVialIds.size;
    }
    if (moveDestMode === "pick") {
      return moveDestPickedCellIds.size !== selectedVialIds.size;
    }
    return false;
  }, [movePreviewCellIds, selectedVialIds, moveDestStartCellId, moveTargetGrid, moveDestMode, moveDestPickedCellIds]);

  const handleMoveVials = async () => {
    if (selectedVialIds.size === 0 || !targetUnitId) return;
    setMoveLoading(true);
    setMessage(null);
    setError(null);
    try {
      const movePayload: Record<string, unknown> = {
        vial_ids: Array.from(selectedVialIds),
        target_unit_id: targetUnitId,
      };
      if (moveDestMode === "start" && moveDestStartCellId) {
        movePayload.start_cell_id = moveDestStartCellId;
      } else if (moveDestMode === "pick" && moveDestPickedCellIds.size > 0) {
        movePayload.target_cell_ids = Array.from(moveDestPickedCellIds);
      }
      const res = await api.post<VialMoveResult>("/vials/move", movePayload);
      setMessage(`Moved ${res.data.moved_count} vial(s) successfully.`);
      setSelectedVialIds(new Set());
      setTargetUnitId("");
      setMoveTargetGrid(null);
      setMoveDestMode("auto");
      setMoveDestStartCellId(null);
      setMoveDestPickedCellIds(new Set());
      // Refresh the grid
      if (selectedGrid) await loadGrid(selectedGrid.unit.id);
      setMoveMode(true); // Stay in move mode for more moves
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to move vials");
    } finally {
      setMoveLoading(false);
    }
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
    loadUnits();
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

      <div className="storage-list">
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
          <div className="page-header">
            <h2>
              {selectedGrid.unit.name}
              {selectedGrid.unit.is_temporary && <span className="temp-badge">Temporary</span>}
            </h2>
            <div className="header-buttons">
              {canStock && !stockingMode && !moveMode && !selectedGrid.unit.is_temporary && (
                <button onClick={enterStockingMode}>Stock Vials</button>
              )}
              {canStock && !stockingMode && !moveMode && (
                <button onClick={enterMoveMode}>Move Vials</button>
              )}
              {stockingMode && (
                <button
                  className="btn-red"
                  onClick={() => {
                    setStockingMode(false);
                    setNextEmptyCell(null);
                    setMessage(null);
                    setError(null);
                  }}
                >
                  Exit Stocking
                </button>
              )}
              {moveMode && (
                <button className="btn-red" onClick={exitMoveMode}>
                  Exit Move Mode
                </button>
              )}
            </div>
          </div>
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

          {moveMode && (
            <div className="move-panel">
              <p className="page-desc">
                Click vials to select/deselect. Selected: <strong>{selectedVialIds.size}</strong>
              </p>
              <div className="move-controls">
                <select
                  value=""
                  onChange={(e) => e.target.value && handleSelectLot(e.target.value)}
                >
                  <option value="">Select entire lot...</option>
                  {getLotsInGrid().map((lot) => (
                    <option key={lot.lot_id} value={lot.lot_id}>
                      {lot.label} ({lot.vial_ids.length} vials)
                    </option>
                  ))}
                </select>
                <select
                  value={targetUnitId}
                  onChange={(e) => handleMoveTargetChange(e.target.value)}
                >
                  <option value="">Move to...</option>
                  {units
                    .filter((u) => u.id !== selectedGrid?.unit.id)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} {u.is_temporary ? "(Temp)" : ""}
                      </option>
                    ))}
                </select>
                <button
                  onClick={handleMoveVials}
                  disabled={selectedVialIds.size === 0 || !targetUnitId || moveLoading || moveInsufficientCells}
                >
                  {moveLoading ? "Moving..." : `Move ${selectedVialIds.size} Vial(s)`}
                </button>
                <button onClick={() => setSelectedVialIds(new Set())} disabled={selectedVialIds.size === 0}>
                  Clear Selection
                </button>
              </div>
              {message && <p className="success">{message}</p>}
              {error && <p className="error">{error}</p>}
              {moveTargetGrid && (
                <div style={{ marginTop: "1rem" }}>
                  <h4 style={{ margin: "0 0 0.25rem" }}>Destination: {moveTargetGrid.unit.name}</h4>
                  <p className="page-desc" style={{ margin: "0 0 0.5rem", fontSize: "0.85em" }}>
                    {moveDestMode === "auto" && "Click an empty cell to set a starting position, or leave for auto-placement."}
                    {moveDestMode === "start" && "Vials will fill from the selected cell. Click another cell to pick individual positions."}
                    {moveDestMode === "pick" && `Pick mode: ${moveDestPickedCellIds.size}/${selectedVialIds.size} cells selected.`}
                    {moveDestMode !== "auto" && (
                      <button
                        className="btn-secondary btn-sm"
                        style={{ marginLeft: 8 }}
                        onClick={() => { setMoveDestMode("auto"); setMoveDestStartCellId(null); setMoveDestPickedCellIds(new Set()); }}
                      >
                        Clear
                      </button>
                    )}
                  </p>
                  <StorageGrid
                    rows={moveTargetGrid.unit.rows}
                    cols={moveTargetGrid.unit.cols}
                    cells={moveTargetGrid.cells}
                    highlightVialIds={new Set<string>()}
                    selectedCellId={moveDestMode === "start" ? moveDestStartCellId : undefined}
                    selectedCellIds={moveDestMode === "pick" ? moveDestPickedCellIds : undefined}
                    onCellClick={handleMoveTargetCellClick}
                    clickMode="empty"
                    singleClickSelect
                    previewCellIds={moveDestMode === "start" ? movePreviewCellIds : undefined}
                    fluorochromes={fluorochromes}
                  />
                  {moveInsufficientCells && (
                    <p className="error" style={{ marginTop: 4 }}>
                      {moveDestMode === "pick"
                        ? `Select exactly ${selectedVialIds.size} cell(s) to match the number of vials.`
                        : "Not enough empty cells from the selected position."}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {!stockingMode && !moveMode && message && <p className="success">{message}</p>}
          {!stockingMode && !moveMode && error && error.startsWith("not_registered:") ? (
            <p className="error">
              Barcode not registered.{" "}
              <Link to={`/scan?barcode=${encodeURIComponent(error.slice("not_registered:".length))}`}>
                Go to Scan/Search to register
              </Link>
            </p>
          ) : !stockingMode && !moveMode && error ? (
            <p className="error">{error}</p>
          ) : null}

          <StorageGrid
            rows={selectedGrid.unit.rows}
            cols={selectedGrid.unit.cols}
            cells={selectedGrid.cells}
            highlightVialIds={moveMode ? selectedVialIds : new Set()}
            highlightNextCellId={stockingMode ? nextEmptyCell?.id : undefined}
            onCellClick={
              moveMode
                ? handleMoveCellClick
                : !stockingMode && canStock
                ? handleGridCellClick
                : undefined
            }
            clickMode={moveMode ? "occupied" : !stockingMode && canStock ? "occupied" : "highlighted"}
            fluorochromes={fluorochromes}
            singleClickSelect={moveMode}
            popoutActions={!moveMode && !stockingMode ? getPopoutActions : undefined}
          />
          <div className="grid-legend">
            <span className="legend-item"><span className="legend-box sealed" /> Sealed</span>
            <span className="legend-item"><span className="legend-box opened" /> Opened</span>
            <span className="legend-item"><span className="legend-box" /> Empty</span>
            {stockingMode && (
              <span className="legend-item">
                <span className="legend-box next-empty-legend" /> Next slot
              </span>
            )}
            {moveMode && (
              <span className="legend-item">
                <span className="legend-box highlighted-legend" /> Selected
              </span>
            )}
            {!stockingMode && !moveMode && canStock && (
              <span className="legend-item">
                Tap a vial to see actions
              </span>
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
