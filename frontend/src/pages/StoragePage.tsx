import { useEffect, useState, useRef, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/client";
import type {
  StorageGrid as StorageGridType,
  StorageCell,
} from "../api/types";
import { StorageView } from "../components/storage";
import type { StorageViewHandle } from "../components/storage";
import BarcodeScannerButton from "../components/BarcodeScannerButton";
import { useAuth } from "../context/AuthContext";
import { useSharedData } from "../context/SharedDataContext";

export default function StoragePage() {
  const { user, labSettings } = useAuth();
  const { labs, fluorochromes, storageUnits: units, selectedLab, setSelectedLab, refreshStorageUnits } = useSharedData();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const viewRef = useRef<StorageViewHandle>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const selectedGridRef = useRef<StorageGridType | null>(null);

  const [consolidateLotId, setConsolidateLotId] = useState<string | null>(null);
  const [selectedGrid, setSelectedGrid] = useState<StorageGridType | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [stockingMode, setStockingMode] = useState(false);
  const [nextEmptyCell, setNextEmptyCell] = useState<StorageCell | null>(null);
  const [barcode, setBarcode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isMoving, setIsMoving] = useState(false);
  const [form, setForm] = useState({ name: "", rows: 10, cols: 10, temperature: "" });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  selectedGridRef.current = selectedGrid;

  const canCreate = user?.role === "super_admin" || user?.role === "lab_admin" || user?.role === "supervisor";
  const canDelete = user?.role === "super_admin" || user?.role === "lab_admin";
  const canStock =
    user?.role === "super_admin" ||
    user?.role === "lab_admin" ||
    user?.role === "supervisor" ||
    user?.role === "tech";

  // Clear selected grid when lab changes
  useEffect(() => { setSelectedGrid(null); }, [selectedLab]);

  // Handle ?lotId=&unitId= consolidation deep-link, or ?unitId= direct navigation
  const [pendingMoveMode, setPendingMoveMode] = useState(false);
  useEffect(() => {
    const lotId = searchParams.get("lotId");
    const unitId = searchParams.get("unitId");
    const mode = searchParams.get("mode");
    if (lotId && unitId) {
      setConsolidateLotId(lotId);
      setSearchParams({}, { replace: true });
      loadGrid(unitId);
    } else if (unitId) {
      if (mode === "move") setPendingMoveMode(true);
      setSearchParams({}, { replace: true });
      loadGrid(unitId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-enter move mode when navigated with ?mode=move
  useEffect(() => {
    if (!pendingMoveMode || !selectedGrid) return;
    setPendingMoveMode(false);
    setMessage(null);
    setError(null);
    viewRef.current?.enterMoveMode(new Set());
  }, [selectedGrid, pendingMoveMode]);

  // After grid loads for consolidation, enter move mode and select the lot's vials
  useEffect(() => {
    if (!consolidateLotId || !selectedGrid) return;
    const lotId = consolidateLotId;
    setConsolidateLotId(null);
    setMessage(null);
    setError(null);
    const lots = getLotsInGrid();
    const lot = lots.find((l) => l.lot_id === lotId);
    viewRef.current?.enterMoveMode(lot ? new Set(lot.vial_ids) : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGrid, consolidateLotId]);

  // ── Grid loading ────────────────────────────────────────────────────────────

  const loadGrid = async (unitId: string) => {
    const res = await api.get(`/storage/units/${unitId}/grid`);
    setSelectedGrid(res.data);
    setStockingMode(false);
    setNextEmptyCell(null);
    setMessage(null);
    setError(null);
  };

  /** Refresh grid data without resetting mode/messages (used by StorageView after open/deplete/move). */
  const refreshGrid = async () => {
    const grid = selectedGridRef.current;
    if (!grid) return;
    const res = await api.get(`/storage/units/${grid.unit.id}/grid`);
    setSelectedGrid(res.data);
  };

  // ── Delete storage unit ────────────────────────────────────────────────────

  const handleDeleteUnit = async (unitId: string) => {
    setDeleteLoading(true);
    try {
      const res = await api.delete(`/storage/units/${unitId}`);
      setMessage(res.data.message);
      setError(null);
      setConfirmDeleteId(null);
      if (selectedGrid?.unit.id === unitId) setSelectedGrid(null);
      refreshStorageUnits();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to delete storage unit");
      setConfirmDeleteId(null);
    } finally {
      setDeleteLoading(false);
    }
  };

  // ── Stocking mode ──────────────────────────────────────────────────────────

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

  const exitStockingMode = () => {
    setStockingMode(false);
    setNextEmptyCell(null);
    setMessage(null);
    setError(null);
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleStock();
    }
  };

  // ── Lot selector for move mode ─────────────────────────────────────────────

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

  // ── Create storage unit form ───────────────────────────────────────────────

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

  // ── Render ─────────────────────────────────────────────────────────────────

  if (labSettings.storage_enabled === false) {
    return (
      <div>
        <h1>Storage Units</h1>
        <p className="page-desc">
          Storage tracking is disabled for this lab. Enable it in Dashboard Settings to manage storage grids and container locations.
        </p>
      </div>
    );
  }

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
            {canDelete && !unit.is_temporary && (
              confirmDeleteId === unit.id ? (
                <div className="confirm-delete-bar" onClick={(e) => e.stopPropagation()}>
                  <span>Delete this unit?</span>
                  <button className="btn-sm btn-danger" disabled={deleteLoading} onClick={() => handleDeleteUnit(unit.id)}>
                    {deleteLoading ? "Deleting…" : "Yes, delete"}
                  </button>
                  <button className="btn-sm btn-secondary" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                </div>
              ) : (
                <button
                  className="btn-icon btn-delete-unit"
                  title="Delete storage unit"
                  onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(unit.id); }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  </svg>
                </button>
              )
            )}
          </div>
        ))}
        {units.length === 0 && (
          <p className="empty">No storage units created</p>
        )}
      </div>

      {selectedGrid && (
        <>
          {selectedGrid.unit.is_temporary && !isMoving && (
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

          <StorageView
            ref={viewRef}
            grids={[selectedGrid]}
            fluorochromes={fluorochromes}
            onRefresh={refreshGrid}
            readOnly={stockingMode}
            highlightNextCellId={stockingMode ? nextEmptyCell?.id : undefined}
            excludeUnitIds={[]}
            onMoveChange={setIsMoving}
            extraPopoutActions={(cell) => {
              if (!cell.vial?.antibody_id) return [];
              return [{
                label: "View Lot",
                onClick: () => navigate(`/inventory?antibodyId=${cell.vial!.antibody_id}`),
              }];
            }}
            headerActions={({ enterMoveMode }) => (
              <div className="move-header-actions">
                {canStock && !stockingMode && !selectedGrid.unit.is_temporary && (
                  <button className="move-header-btn" onClick={enterStockingMode}>Stock</button>
                )}
                {canStock && !stockingMode && (
                  <button className="move-header-btn" onClick={enterMoveMode}>Move</button>
                )}
                {stockingMode && (
                  <button className="move-header-btn" onClick={exitStockingMode}>Exit Stocking</button>
                )}
              </div>
            )}
            moveHeaderExtra={({ addVialIds }) => (
              <select value="" onChange={(e) => {
                if (!e.target.value) return;
                const lot = getLotsInGrid().find(l => l.lot_id === e.target.value);
                if (lot) addVialIds(lot.vial_ids);
              }}>
                <option value="">Select lot...</option>
                {getLotsInGrid().map(lot => (
                  <option key={lot.lot_id} value={lot.lot_id}>{lot.label} ({lot.vial_ids.length})</option>
                ))}
              </select>
            )}
            legendExtra={
              stockingMode ? (
                <span className="legend-item"><span className="legend-box next-empty-legend" /> Next slot</span>
              ) : canStock ? (
                <span className="legend-item">Tap a vial to see actions</span>
              ) : undefined
            }
          />

          {/* Status messages (outside stocking mode) */}
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
        </>
      )}
    </div>
  );
}
