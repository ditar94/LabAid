import { useState, useRef, useEffect, type FormEvent } from "react";
import api from "../api/client";
import type {
  ScanLookupResult,
  ScanIntent,
  StorageCell,
  Vial,
  Antibody,
  StorageUnit,
  Fluorochrome,
  VialMoveResult,
} from "../api/types";
import StorageGrid from "../components/StorageGrid";
import BarcodeScannerButton from "../components/BarcodeScannerButton";
import { useAuth } from "../context/AuthContext";
import DatePicker from "../components/DatePicker";

export default function ScanPage() {
  const { user, labSettings } = useAuth();
  const sealedOnly = labSettings.sealed_counts_only ?? false;
  const [barcode, setBarcode] = useState("");
  const [result, setResult] = useState<ScanLookupResult | null>(null);
  const [intent, setIntent] = useState<ScanIntent>(null);
  const [selectedCell, setSelectedCell] = useState<StorageCell | null>(null);
  const [selectedVial, setSelectedVial] = useState<Vial | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Inline registration state
  const [showRegister, setShowRegister] = useState(false);
  const [scannedBarcode, setScannedBarcode] = useState("");
  const [antibodies, setAntibodies] = useState<Antibody[]>([]);
  const [storageUnits, setStorageUnits] = useState<StorageUnit[]>([]);
  const [fluorochromes, setFluorochromes] = useState<Fluorochrome[]>([]);
  const [regForm, setRegForm] = useState({
    antibody_id: "",
    lot_number: "",
    expiration_date: "",
    quantity: "1",
    storage_unit_id: "",
  });

  // QC confirmation state
  const [showQcConfirm, setShowQcConfirm] = useState(false);

  // Receive More form state
  const [receiveQty, setReceiveQty] = useState(1);
  const [receiveStorageId, setReceiveStorageId] = useState("");

  const canEdit =
    user?.role === "super_admin" ||
    user?.role === "lab_admin" ||
    user?.role === "supervisor";

  // Auto-focus the scanner input field for keyboard wedge scanners
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Re-focus after actions complete
  useEffect(() => {
    if (!loading && !result && !showRegister) {
      inputRef.current?.focus();
    }
  }, [loading, result, showRegister]);

  const resetActionState = () => {
    setIntent(null);
    setSelectedCell(null);
    setSelectedVial(null);
    setShowQcConfirm(false);
    setSelectedMoveVialIds(new Set());
    setTargetMoveUnitId("");
    setError(null);
  };

  const handleScan = async (override?: string) => {
    const code = (override ?? barcode).trim();
    if (!code) return;
    setResult(null);
    resetActionState();
    setMessage(null);
    setError(null);
    setShowRegister(false);
    setLoading(true);

    try {
      const res = await api.post("/scan/lookup", { barcode: code });
      setResult(res.data);
      if (res.data) {
        api.get("/fluorochromes/").then((r) => setFluorochromes(r.data));
      }
    } catch (err: any) {
      const detail = err.response?.data?.detail || "";
      if (err.response?.status === 404 && detail.includes("No lot found")) {
        setScannedBarcode(code);
        setShowRegister(true);
        setRegForm({
          antibody_id: "",
          lot_number: "",
          expiration_date: "",
          quantity: "1",
          storage_unit_id: "",
        });
        const [abRes, suRes] = await Promise.all([
          api.get("/antibodies/"),
          api.get("/storage/units"),
        ]);
        setAntibodies(abRes.data);
        setStorageUnits(suRes.data);
      } else {
        setError(detail || "Scan lookup failed");
      }
    } finally {
      setLoading(false);
    }
  };

  // Re-run scan to refresh data after an action
  const refreshScan = async () => {
    if (!barcode.trim()) return;
    try {
      const res = await api.post("/scan/lookup", { barcode: barcode.trim() });
      setResult(res.data);
    } catch {
      // If refresh fails, clear result
      setResult(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleScan();
    }
  };

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const quantity = regForm.quantity.trim()
        ? parseInt(regForm.quantity, 10)
        : NaN;
      if (!Number.isFinite(quantity) || quantity < 1) {
        setError("Please enter a valid vial quantity.");
        setLoading(false);
        return;
      }
      const lotRes = await api.post("/lots/", {
        antibody_id: regForm.antibody_id,
        lot_number: regForm.lot_number,
        vendor_barcode: scannedBarcode,
        expiration_date: regForm.expiration_date || null,
      });
      const lot = lotRes.data;

      await api.post("/vials/receive", {
        lot_id: lot.id,
        quantity,
        storage_unit_id: regForm.storage_unit_id || null,
      });

      setMessage(
        `Lot "${regForm.lot_number}" registered with ${quantity} vial(s). Barcode: ${scannedBarcode}`
      );
      setShowRegister(false);
      setBarcode("");
      inputRef.current?.focus();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  const handleCellClick = (cell: StorageCell) => {
    setSelectedCell(cell);
    setMessage(null);
    setError(null);
  };

  // ── Intent: Open New ────────────────────────────────────────────────

  const confirmOpen = async (force = false) => {
    if (!selectedCell || !result) return;

    const vial = result.vials.find(
      (v) => v.location_cell_id === selectedCell.id
    );
    if (!vial) {
      setError("No vial found at this location");
      return;
    }

    // QC gate: if lot is not approved and user hasn't confirmed, show warning
    if (result.qc_warning && !force) {
      setShowQcConfirm(true);
      return;
    }

    setLoading(true);
    setShowQcConfirm(false);
    try {
      await api.post(`/vials/${vial.id}/open?force=${!!result.qc_warning}`, {
        cell_id: selectedCell.id,
      });
      setMessage(
        `Vial opened from cell ${selectedCell.label}. Status updated.`
      );
      resetActionState();
      await refreshScan();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to open vial");
    } finally {
      setLoading(false);
    }
  };

  // ── Intent: Store Open Vial ─────────────────────────────────────────

  const confirmStoreOpen = async () => {
    const vial = selectedVial;
    const cell = selectedCell;
    if (!vial || !cell) return;

    setLoading(true);
    try {
      await api.post(`/vials/${vial.id}/return-to-storage`, { cell_id: cell.id });
      setMessage(`Open vial stored in cell ${cell.label}.`);
      resetActionState();
      await refreshScan();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to store vial");
    } finally {
      setLoading(false);
    }
  };

  // ── Intent: Receive More ────────────────────────────────────────────

  const handleReceive = async (e: FormEvent) => {
    e.preventDefault();
    if (!result) return;

    setLoading(true);
    setError(null);
    try {
      await api.post("/vials/receive", {
        lot_id: result.lot.id,
        quantity: receiveQty,
        storage_unit_id: receiveStorageId || null,
      });
      setMessage(`${receiveQty} vial(s) received for lot ${result.lot.lot_number}.`);
      setReceiveQty(1);
      setReceiveStorageId("");
      resetActionState();
      await refreshScan();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to receive vials");
    } finally {
      setLoading(false);
    }
  };

  // ── Intent: Deplete ─────────────────────────────────────────────────

  const confirmDeplete = async () => {
    if (!selectedVial) return;

    setLoading(true);
    try {
      await api.post(`/vials/${selectedVial.id}/deplete`);
      setMessage(`Vial depleted. Status updated.`);
      resetActionState();
      await refreshScan();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to deplete vial");
    } finally {
      setLoading(false);
    }
  };

  // ── Intent: Deplete All ────────────────────────────────────────────

  const [showDepleteAllConfirm, setShowDepleteAllConfirm] = useState(false);

  // ── Intent: Move Vials ─────────────────────────────────────────────

  const [selectedMoveVialIds, setSelectedMoveVialIds] = useState<Set<string>>(new Set());
  const [targetMoveUnitId, setTargetMoveUnitId] = useState<string>("");
  const [moveLoading, setMoveLoading] = useState(false);

  const confirmDepleteAll = async () => {
    if (!result) return;
    setLoading(true);
    setShowDepleteAllConfirm(false);
    try {
      const res = await api.post(`/lots/${result.lot.id}/deplete-all`);
      setMessage(`${res.data.length} vial(s) depleted for lot ${result.lot.lot_number}.`);
      resetActionState();
      await refreshScan();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to deplete all vials");
    } finally {
      setLoading(false);
    }
  };

  // ── Intent: Move Vials ────────────────────────────────────────────

  const getVialsInStorage = () => {
    if (!result) return [];
    const vialsInStorage: { vial: Vial; cell?: StorageCell }[] = [];
    // Helper to find cell across all grids
    const findCell = (cellId: string) => {
      for (const grid of result.storage_grids) {
        const cell = grid.cells.find((c) => c.id === cellId);
        if (cell) return cell;
      }
      return undefined;
    };
    // Add sealed vials
    for (const v of result.vials) {
      if (v.location_cell_id) {
        const cell = findCell(v.location_cell_id);
        vialsInStorage.push({ vial: v, cell });
      }
    }
    // Add opened vials
    for (const v of result.opened_vials ?? []) {
      if (v.location_cell_id) {
        const cell = findCell(v.location_cell_id);
        vialsInStorage.push({ vial: v, cell });
      }
    }
    return vialsInStorage;
  };

  const toggleMoveVial = (vialId: string) => {
    setSelectedMoveVialIds((prev) => {
      const next = new Set(prev);
      if (next.has(vialId)) {
        next.delete(vialId);
      } else {
        next.add(vialId);
      }
      return next;
    });
  };

  const selectAllVialsForMove = () => {
    const vialsInStorage = getVialsInStorage();
    setSelectedMoveVialIds(new Set(vialsInStorage.map((v) => v.vial.id)));
  };

  const handleMoveVials = async () => {
    if (selectedMoveVialIds.size === 0 || !targetMoveUnitId) return;
    setMoveLoading(true);
    setError(null);
    try {
      const res = await api.post<VialMoveResult>("/vials/move", {
        vial_ids: Array.from(selectedMoveVialIds),
        target_unit_id: targetMoveUnitId,
      });
      setMessage(`Moved ${res.data.moved_count} vial(s) successfully.`);
      setSelectedMoveVialIds(new Set());
      setTargetMoveUnitId("");
      await refreshScan();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to move vials");
    } finally {
      setMoveLoading(false);
    }
  };

  // ── Computed values ─────────────────────────────────────────────────

  // Helper to find cell across all grids
  const findCellInGrids = (cellId: string | null) => {
    if (!cellId || !result) return null;
    for (const grid of result.storage_grids) {
      const cell = grid.cells.find((c) => c.id === cellId);
      if (cell) return cell;
    }
    return null;
  };

  // Sealed vials highlighted in grid (by vial ID for each grid)
  const highlightCellVialIds = new Set<string>();
  if (result?.storage_grids.length && intent === "open") {
    for (const grid of result.storage_grids) {
      for (const cell of grid.cells) {
        if (cell.vial_id && result.vials.some((v) => v.id === cell.vial_id)) {
          highlightCellVialIds.add(cell.vial_id);
        }
      }
    }
  }

  // Oldest sealed vial recommendation
  const recommendation = result?.vials
    .filter((v) => v.location_cell_id)
    .sort(
      (a, b) =>
        new Date(a.received_at).getTime() - new Date(b.received_at).getTime()
    )[0];

  const recommendedCell = recommendation
    ? findCellInGrids(recommendation.location_cell_id)
    : null;

  // Find which grid contains the recommended cell
  const recommendedGridIndex = recommendation
    ? result?.storage_grids.findIndex((g) =>
        g.cells.some((c) => c.id === recommendation.location_cell_id)
      ) ?? -1
    : -1;

  // First empty cell for store-open suggestion (from first grid)
  const firstEmptyCell = result?.storage_grids[0]?.cells.find(
    (c) => !c.vial_id
  );

  // Intent button enabled states
  const canOpen = (result?.vials.length ?? 0) > 0;
  const canStoreOpen =
    (result?.opened_vials?.length ?? 0) > 0 && result?.storage_grids.length > 0;
  const canDeplete = (result?.opened_vials?.length ?? 0) > 0;

  const fluoroMap = new Map<string, string>();
  for (const f of fluorochromes) {
    fluoroMap.set(f.name.toLowerCase(), f.color);
  }

  return (
    <div>
      <h1>Scan</h1>
      <p className="page-desc">
        Scan a vendor barcode to look up a lot, then choose an action.
      </p>

      <div className="scan-input-container">
        <input
          ref={inputRef}
          className="scan-input"
          placeholder="Scan barcode here..."
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        <BarcodeScannerButton
          onDetected={(value) => {
            setBarcode(value);
            handleScan(value);
          }}
          disabled={loading}
        />
        <button onClick={() => handleScan()} disabled={loading}>
          {loading ? "Looking up..." : "Lookup"}
        </button>
      </div>

      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}

      {/* ── Inline Registration Form ─────────────────────────────────── */}
      {showRegister && canEdit && (
        <div className="register-panel">
          <h2>New Lot — Barcode "{scannedBarcode}"</h2>
          <p className="page-desc">
            This barcode isn't registered yet. Fill in the details below to
            register the lot, receive vials, and assign storage.
          </p>
          <form className="register-form" onSubmit={handleRegister}>
            <div className="form-group">
              <label>Antibody</label>
              <select
                value={regForm.antibody_id}
                onChange={(e) =>
                  setRegForm({ ...regForm, antibody_id: e.target.value })
                }
                required
              >
                <option value="">Select Antibody</option>
                {antibodies.map((ab) => (
                  <option key={ab.id} value={ab.id}>
                    {ab.target} - {ab.fluorochrome}
                    {ab.clone ? ` (${ab.clone})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Lot Number</label>
              <input
                placeholder="e.g., 12345"
                value={regForm.lot_number}
                onChange={(e) =>
                  setRegForm({ ...regForm, lot_number: e.target.value })
                }
                required
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Vials Received</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={regForm.quantity}
                  onChange={(e) =>
                    setRegForm({
                      ...regForm,
                      quantity: e.target.value,
                    })
                  }
                  required
                />
              </div>
              <div className="form-group">
                <label>Expiration Date</label>
                <DatePicker
                  value={regForm.expiration_date}
                  onChange={(v) =>
                    setRegForm({
                      ...regForm,
                      expiration_date: v,
                    })
                  }
                  placeholderText="Expiration date"
                />
              </div>
            </div>
            <div className="form-group">
              <label>Store in</label>
              <select
                value={regForm.storage_unit_id}
                onChange={(e) =>
                  setRegForm({ ...regForm, storage_unit_id: e.target.value })
                }
              >
                <option value="">No storage assignment</option>
                {storageUnits.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.rows}x{u.cols}){" "}
                    {u.temperature || ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="register-actions">
              <button type="submit" disabled={loading}>
                {loading ? "Registering..." : "Register Lot & Receive Vials"}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setShowRegister(false);
                  setBarcode("");
                  inputRef.current?.focus();
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {showRegister && !canEdit && (
        <div className="register-panel">
          <p className="error">
            Barcode "{scannedBarcode}" is not registered. Contact your
            supervisor to register this lot.
          </p>
        </div>
      )}

      {/* ── Scan Result ──────────────────────────────────────────────── */}
      {result && (
        <div className="scan-result-wrapper">
          <div className="scan-info">
            <h2>
              {fluoroMap.get(result.antibody.fluorochrome.toLowerCase()) && (
                <div
                  className="color-dot"
                  style={{
                    backgroundColor: fluoroMap.get(
                      result.antibody.fluorochrome.toLowerCase()
                    ),
                  }}
                />
              )}
              {result.antibody.target} - {result.antibody.fluorochrome}
            </h2>
            <p>
              Lot: <strong>{result.lot.lot_number}</strong> | QC:{" "}
              <span
                className={`badge ${
                  result.lot.qc_status === "approved"
                    ? "badge-green"
                    : result.lot.qc_status === "failed"
                    ? "badge-red"
                    : "badge-yellow"
                }`}
              >
                {result.lot.qc_status}
              </span>
            </p>
            <p>
              Sealed: <strong>{result.vials.length}</strong>
              {!sealedOnly && (
                <>
                  {" "}| Opened: <strong>{result.opened_vials?.length ?? 0}</strong>
                </>
              )}
            </p>

            {result.qc_warning && (
              <div className="qc-warning">{result.qc_warning}</div>
            )}
            {result.qc_warning && !canEdit && (
              <p className="error">
                This lot has not been QC-approved. Contact your supervisor.
              </p>
            )}
          </div>

          {/* ── Intent Menu ──────────────────────────────────────────── */}
          <div className="intent-menu">
            <button
              className={`intent-btn ${intent === "open" ? "active" : ""}`}
              onClick={() => {
                resetActionState();
                setIntent("open");
              }}
              disabled={!canOpen}
              title={!canOpen ? "No sealed vials" : ""}
            >
              {sealedOnly ? "Use Vial" : "Open New"}
            </button>
            {!sealedOnly && (
              <button
                className={`intent-btn ${intent === "store_open" ? "active" : ""}`}
                onClick={() => {
                  resetActionState();
                  setIntent("store_open");
                }}
                disabled={!canStoreOpen}
                title={!canStoreOpen ? "No opened vials or no storage grid" : ""}
              >
                Store Open Vial
              </button>
            )}
            <button
              className={`intent-btn ${intent === "receive" ? "active" : ""}`}
              onClick={() => {
                resetActionState();
                setIntent("receive");
                setReceiveQty(1);
                setReceiveStorageId(result.storage_grids[0]?.unit.id ?? "");
                // Load storage units for the dropdown
                api.get("/storage/units").then((r) => setStorageUnits(r.data));
              }}
            >
              Receive More
            </button>
            {!sealedOnly && (
              <button
                className={`intent-btn ${intent === "deplete" ? "active" : ""}`}
                onClick={() => {
                  resetActionState();
                  setIntent("deplete");
                }}
                disabled={!canDeplete}
                title={!canDeplete ? "No opened vials" : ""}
              >
                Deplete
              </button>
            )}
            <button
              className={`intent-btn ${intent === "move" ? "active" : ""}`}
              onClick={() => {
                resetActionState();
                setIntent("move");
                api.get("/storage/units").then((r) => setStorageUnits(r.data));
              }}
              disabled={getVialsInStorage().length === 0}
              title={getVialsInStorage().length === 0 ? "No vials in storage for this lot" : ""}
            >
              Move Vials
            </button>
            <button
              className={`intent-btn ${intent === "view_storage" ? "active" : ""}`}
              onClick={() => {
                resetActionState();
                setIntent("view_storage");
              }}
              disabled={result.storage_grids.length === 0}
              title={result.storage_grids.length === 0 ? "No vials in storage" : ""}
            >
              View Storage
            </button>
          </div>

          {/* ── Intent: Open New ─────────────────────────────────────── */}
          {intent === "open" && (
            <div className="intent-panel">
              {recommendedCell && (
                <p className="recommendation">
                  Suggestion: oldest vial is at cell{" "}
                  <strong>{recommendedCell.label}</strong> (received{" "}
                  {new Date(recommendation!.received_at).toLocaleDateString()}).
                  Click the cell you are actually pulling from.
                </p>
              )}

              {result.storage_grids.length > 0 ? (
                result.storage_grids.map((grid, idx) => (
                  <div key={grid.unit.id} className="grid-container">
                    <h3>{grid.unit.name}</h3>
                    <StorageGrid
                      rows={grid.unit.rows}
                      cols={grid.unit.cols}
                      cells={grid.cells}
                      highlightVialIds={highlightCellVialIds}
                      recommendedCellId={idx === recommendedGridIndex ? recommendedCell?.id : undefined}
                      onCellClick={handleCellClick}
                      selectedCellId={selectedCell?.id}
                      clickMode="highlighted"
                      fluorochromes={fluorochromes}
                    />
                  </div>
                ))
              ) : result.vials.length > 0 ? (
                <p className="info">
                  Vials found but not assigned to storage. Assign vials to a
                  storage unit to use the grid selection.
                </p>
              ) : null}

              {selectedCell && !showQcConfirm && (
                <div className="confirm-action">
                  <p>
                    You selected cell <strong>{selectedCell.label}</strong>.
                  </p>
                  <button
                    className="btn-green"
                    onClick={() => confirmOpen()}
                    disabled={loading}
                  >
                    Confirm Open Vial
                  </button>
                </div>
              )}

              {showQcConfirm && (
                <div className="qc-confirm-dialog">
                  <p className="qc-confirm-warning">
                    This lot hasn't been approved yet. Are you sure you wish
                    to open this vial?
                  </p>
                  <div className="qc-confirm-actions">
                    <button
                      className="btn-red"
                      onClick={() => confirmOpen(true)}
                      disabled={loading}
                    >
                      Yes, Open Anyway
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => setShowQcConfirm(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Intent: Store Open Vial ─────────────────────────────── */}
          {intent === "store_open" && result.storage_grids.length > 0 && (
            <div className="intent-panel">
              <p className="page-desc">
                Select the opened vial to store, then click an empty cell in the
                grid.
              </p>

              <div className="vial-select-list">
                {result.opened_vials.map((v) => {
                  const isExpired =
                    v.open_expiration &&
                    new Date(v.open_expiration) < new Date();
                  return (
                    <div
                      key={v.id}
                      className={`vial-select-item ${
                        selectedVial?.id === v.id ? "selected" : ""
                      }`}
                      onClick={() => {
                        setSelectedVial(v);
                        setSelectedCell(null);
                      }}
                    >
                      <span className="vial-id">{v.id.slice(0, 8)}</span>
                      <span className="vial-detail">
                        Opened{" "}
                        {v.opened_at
                          ? new Date(v.opened_at).toLocaleDateString()
                          : "—"}
                      </span>
                      {v.open_expiration && (
                        <span
                          className={`vial-expiration ${
                            isExpired ? "expired" : ""
                          }`}
                        >
                          {isExpired ? "Expired" : `Exp: ${v.open_expiration}`}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {selectedVial && (
                <>
                  {result.storage_grids.map((grid, idx) => {
                    const gridFirstEmpty = grid.cells.find((c) => !c.vial_id);
                    return (
                      <div key={grid.unit.id} className="grid-container">
                        <h3>{grid.unit.name}</h3>
                        <StorageGrid
                          rows={grid.unit.rows}
                          cols={grid.unit.cols}
                          cells={grid.cells}
                          highlightVialIds={new Set()}
                          highlightNextCellId={idx === 0 ? gridFirstEmpty?.id : undefined}
                          onCellClick={handleCellClick}
                          selectedCellId={selectedCell?.id}
                          clickMode="empty"
                          fluorochromes={fluorochromes}
                        />
                      </div>
                    );
                  })}

                  {selectedCell && (
                    <div className="confirm-action">
                      <p>
                        Store vial in cell{" "}
                        <strong>{selectedCell.label}</strong>.
                      </p>
                      <button
                        className="btn-green"
                        onClick={() => confirmStoreOpen()}
                        disabled={loading}
                      >
                        Confirm Store Open Vial
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Intent: Receive More ─────────────────────────────────── */}
          {intent === "receive" && (
            <div className="intent-panel">
              <form className="receive-form" onSubmit={handleReceive}>
                <p className="page-desc">
                  Receive additional vials for lot{" "}
                  <strong>{result.lot.lot_number}</strong>.
                </p>
                <div className="form-row">
                  <div className="form-group">
                    <label>Quantity</label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={receiveQty}
                      onChange={(e) =>
                        setReceiveQty(parseInt(e.target.value) || 1)
                      }
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Store in</label>
                    <select
                      value={receiveStorageId}
                      onChange={(e) => setReceiveStorageId(e.target.value)}
                    >
                      <option value="">No storage assignment</option>
                      {storageUnits.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} ({u.rows}x{u.cols}){" "}
                          {u.temperature || ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <button type="submit" disabled={loading}>
                  {loading ? "Receiving..." : "Receive Vials"}
                </button>
              </form>
            </div>
          )}

          {/* ── Intent: Deplete ──────────────────────────────────────── */}
          {intent === "deplete" && (
            <div className="intent-panel">
              <p className="page-desc">
                Select the opened vial to mark as depleted.
              </p>

              {result.opened_vials.length > 1 && !showDepleteAllConfirm && (
                <button
                  className="btn-red"
                  style={{ marginBottom: "0.75rem" }}
                  onClick={() => setShowDepleteAllConfirm(true)}
                  disabled={loading}
                >
                  Deplete All ({result.opened_vials.length} vials)
                </button>
              )}

              {showDepleteAllConfirm && (
                <div className="confirm-action">
                  <p>
                    Deplete all <strong>{result.opened_vials.length}</strong> opened
                    vials for lot <strong>{result.lot.lot_number}</strong>?
                  </p>
                  <div className="action-btns">
                    <button
                      className="btn-red"
                      onClick={confirmDepleteAll}
                      disabled={loading}
                    >
                      {loading ? "Depleting..." : "Yes, Deplete All"}
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => setShowDepleteAllConfirm(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              <div className="vial-select-list">
                {result.opened_vials.map((v) => {
                  const isExpired =
                    v.open_expiration &&
                    new Date(v.open_expiration) < new Date();
                  return (
                    <div
                      key={v.id}
                      className={`vial-select-item ${
                        selectedVial?.id === v.id ? "selected" : ""
                      }`}
                      onClick={() => setSelectedVial(v)}
                    >
                      <span className="vial-id">{v.id.slice(0, 8)}</span>
                      <span className="vial-detail">
                        Opened{" "}
                        {v.opened_at
                          ? new Date(v.opened_at).toLocaleDateString()
                          : "—"}
                      </span>
                      {v.open_expiration && (
                        <span
                          className={`vial-expiration ${
                            isExpired ? "expired" : ""
                          }`}
                        >
                          {isExpired ? "Expired" : `Exp: ${v.open_expiration}`}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {selectedVial && (
                <div className="confirm-action">
                  <p>
                    Deplete vial <strong>{selectedVial.id.slice(0, 8)}</strong>
                    ?
                  </p>
                  <button
                    className="btn-red"
                    onClick={confirmDeplete}
                    disabled={loading}
                  >
                    Confirm Deplete
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Intent: Move Vials ───────────────────────────────────── */}
          {intent === "move" && (
            <div className="intent-panel">
              <p className="page-desc">
                Select vials from this lot to move to a different storage unit.
              </p>

              <div className="move-controls" style={{ marginBottom: "1rem" }}>
                <button
                  onClick={selectAllVialsForMove}
                  disabled={getVialsInStorage().length === 0}
                >
                  Select All ({getVialsInStorage().length})
                </button>
                <button
                  onClick={() => setSelectedMoveVialIds(new Set())}
                  disabled={selectedMoveVialIds.size === 0}
                >
                  Clear Selection
                </button>
              </div>

              <div className="vial-select-list">
                {getVialsInStorage().map(({ vial, cell }) => (
                  <div
                    key={vial.id}
                    className={`vial-select-item ${
                      selectedMoveVialIds.has(vial.id) ? "selected" : ""
                    }`}
                    onClick={() => toggleMoveVial(vial.id)}
                  >
                    <span className="vial-id">{vial.id.slice(0, 8)}</span>
                    <span className="vial-detail">
                      {vial.status === "sealed" ? "Sealed" : "Opened"}
                    </span>
                    {cell && (
                      <span className="vial-detail">
                        Cell {cell.label}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {selectedMoveVialIds.size > 0 && (
                <div className="move-action" style={{ marginTop: "1rem" }}>
                  <p>
                    <strong>{selectedMoveVialIds.size}</strong> vial(s) selected.
                    Choose destination:
                  </p>
                  <div className="form-row" style={{ marginTop: "0.5rem" }}>
                    <select
                      value={targetMoveUnitId}
                      onChange={(e) => setTargetMoveUnitId(e.target.value)}
                      style={{ minWidth: "200px" }}
                    >
                      <option value="">Select destination...</option>
                      {storageUnits
                        .filter((u) => !result.storage_grids.some((g) => g.unit.id === u.id))
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name} {u.is_temporary ? "(Temp)" : ""}
                          </option>
                        ))}
                    </select>
                    <button
                      className="btn-green"
                      onClick={handleMoveVials}
                      disabled={!targetMoveUnitId || moveLoading}
                    >
                      {moveLoading ? "Moving..." : `Move ${selectedMoveVialIds.size} Vial(s)`}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Intent: View Storage ─────────────────────────────────── */}
          {intent === "view_storage" && (
            <div className="intent-panel">
              <p className="page-desc">
                Showing all storage locations for lot <strong>{result.lot.lot_number}</strong>.
              </p>

              {result.storage_grids.length > 0 ? (
                result.storage_grids.map((grid) => {
                  // Highlight vials from this lot
                  const lotVialIds = new Set<string>();
                  for (const cell of grid.cells) {
                    if (cell.vial_id && (
                      result.vials.some((v) => v.id === cell.vial_id) ||
                      result.opened_vials.some((v) => v.id === cell.vial_id)
                    )) {
                      lotVialIds.add(cell.vial_id);
                    }
                  }
                  return (
                    <div key={grid.unit.id} className="grid-container">
                      <h3>
                        {grid.unit.name}
                        {grid.unit.is_temporary && <span className="temp-badge">Temp</span>}
                      </h3>
                      <StorageGrid
                        rows={grid.unit.rows}
                        cols={grid.unit.cols}
                        cells={grid.cells}
                        highlightVialIds={lotVialIds}
                        clickMode="highlighted"
                        fluorochromes={fluorochromes}
                      />
                      <div className="grid-legend">
                        <span className="legend-item"><span className="legend-box sealed" /> Sealed</span>
                        <span className="legend-item"><span className="legend-box opened" /> Opened</span>
                        <span className="legend-item"><span className="legend-box" /> Empty</span>
                        <span className="legend-item"><span className="legend-box highlighted-legend" /> This lot</span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="empty">No vials from this lot are currently in storage.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
