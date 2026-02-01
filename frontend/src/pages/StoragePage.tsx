import { useEffect, useState, useRef, type FormEvent } from "react";
import api from "../api/client";
import type {
  StorageUnit,
  StorageGrid as StorageGridType,
  StorageCell,
  Lab,
  Fluorochrome,
} from "../api/types";
import StorageGrid from "../components/StorageGrid";
import { useAuth } from "../context/AuthContext";

export default function StoragePage() {
  const { user } = useAuth();
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

  const canCreate = user?.role === "super_admin" || user?.role === "lab_admin";
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

  const handleStock = async () => {
    if (!barcode.trim() || !selectedGrid) return;
    setMessage(null);
    setError(null);

    try {
      const res = await api.post(
        `/storage/units/${selectedGrid.unit.id}/stock`,
        { barcode: barcode.trim() }
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
      setError(err.response?.data?.detail || "Failed to stock vial");
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
            }`}
            onClick={() => loadGrid(unit.id)}
          >
            <h3>{unit.name}</h3>
            <p>
              {unit.rows} x {unit.cols} {unit.temperature || ""}
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
            <h2>{selectedGrid.unit.name}</h2>
            {canStock && !stockingMode && (
              <button onClick={enterStockingMode}>Stock Vials</button>
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
          </div>

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
                <button
                  onClick={handleStock}
                  disabled={!nextEmptyCell || !barcode.trim()}
                >
                  Stock
                </button>
              </div>
              {message && <p className="success">{message}</p>}
              {error && <p className="error">{error}</p>}
            </div>
          )}

          <StorageGrid
            rows={selectedGrid.unit.rows}
            cols={selectedGrid.unit.cols}
            cells={selectedGrid.cells}
            highlightVialIds={new Set()}
            highlightNextCellId={stockingMode ? nextEmptyCell?.id : undefined}
            showVialInfo
            fluorochromes={fluorochromes}
          />
          <div className="grid-legend">
            <span className="legend-item">
              <span className="legend-box occupied" /> Occupied (hover for
              details)
            </span>
            <span className="legend-item">
              <span className="legend-box" /> Empty
            </span>
            {stockingMode && (
              <span className="legend-item">
                <span className="legend-box next-empty-legend" /> Next slot
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
