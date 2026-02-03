import { useState, useRef, useEffect, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/client";
import type {
  ScanLookupResult,
  ScanEnrichResult,
  GUDIDDevice,
  ScanIntent,
  StorageCell,
  Vial,
  Antibody,
  StorageUnit,
  Fluorochrome,
  AntibodySearchResult,
  StorageGrid as StorageGridType,
} from "../api/types";
import StorageGrid from "../components/StorageGrid";
import OpenVialDialog from "../components/OpenVialDialog";
import BarcodeScannerButton from "../components/BarcodeScannerButton";
import { useAuth } from "../context/AuthContext";
import DatePicker from "../components/DatePicker";

type ResultMode = "idle" | "scan" | "search" | "register";
const NEW_ANTIBODY_VALUE = "__new__";
const NEW_FLUORO_VALUE = "__new_fluoro__";
const DEFAULT_FLUORO_COLOR = "#9ca3af";

export default function ScanSearchPage() {
  const { user, labSettings } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const sealedOnly = labSettings.sealed_counts_only ?? false;
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<ResultMode>("idle");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Scan state ──────────────────────────────────────────────────────
  const [result, setResult] = useState<ScanLookupResult | null>(null);
  const [intent, setIntent] = useState<ScanIntent>(null);
  const [selectedCell, setSelectedCell] = useState<StorageCell | null>(null);
  const [selectedVial, setSelectedVial] = useState<Vial | null>(null);
  const [showQcConfirm, setShowQcConfirm] = useState(false);
  const [showDepleteAllConfirm, setShowDepleteAllConfirm] = useState(false);
  const [showDepleteLotConfirm, setShowDepleteLotConfirm] = useState(false);
  const [receiveQty, setReceiveQty] = useState(1);
  const [receiveStorageId, setReceiveStorageId] = useState("");
  const [storeOpenUnitId, setStoreOpenUnitId] = useState("");
  const [storeOpenGrid, setStoreOpenGrid] = useState<StorageGridType | null>(null);

  // ── Registration state ──────────────────────────────────────────────
  const [scannedBarcode, setScannedBarcode] = useState("");
  const [antibodies, setAntibodies] = useState<Antibody[]>([]);
  const [storageUnits, setStorageUnits] = useState<StorageUnit[]>([]);
  const [regForm, setRegForm] = useState({
    antibody_id: "",
    lot_number: "",
    vendor_barcode: "",
    expiration_date: "",
    quantity: "1",
    storage_unit_id: "",
  });
  const [newAbForm, setNewAbForm] = useState({
    target: "",
    fluorochrome_choice: "",
    new_fluorochrome: "",
    new_fluoro_color: DEFAULT_FLUORO_COLOR,
    clone: "",
    vendor: "",
    catalog_number: "",
    stability_days: "",
    low_stock_threshold: "",
    approved_low_threshold: "",
  });

  // ── GS1 Enrich state ───────────────────────────────────────────────
  const [enrichResult, setEnrichResult] = useState<ScanEnrichResult | null>(null);
  const [enrichLoading, setEnrichLoading] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<GUDIDDevice | null>(null);

  // ── Search state ────────────────────────────────────────────────────
  const [searchResults, setSearchResults] = useState<AntibodySearchResult[]>([]);
  const [selectedSearchResult, setSelectedSearchResult] = useState<AntibodySearchResult | null>(null);
  const [searchGrids, setSearchGrids] = useState<Map<string, StorageGridType>>(new Map());
  const [openTarget, setOpenTarget] = useState<StorageCell | null>(null);
  const [openLoading, setOpenLoading] = useState(false);

  // ── Shared state ────────────────────────────────────────────────────
  const [fluorochromes, setFluorochromes] = useState<Fluorochrome[]>([]);

  const canEdit =
    user?.role === "super_admin" ||
    user?.role === "lab_admin" ||
    user?.role === "supervisor";

  const canOpen =
    user?.role === "super_admin" ||
    user?.role === "lab_admin" ||
    user?.role === "supervisor" ||
    user?.role === "tech";

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!loading && mode === "idle") {
      inputRef.current?.focus();
    }
  }, [loading, mode]);

  // Auto-trigger lookup if ?barcode= query param is present (e.g. from StoragePage link)
  useEffect(() => {
    const bc = searchParams.get("barcode");
    if (bc && mode === "idle") {
      setInput(bc);
      setSearchParams({}, { replace: true });
      handleLookup(bc);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetScanState = () => {
    setIntent(null);
    setSelectedCell(null);
    setSelectedVial(null);
    setShowQcConfirm(false);
    setShowDepleteAllConfirm(false);
    setShowDepleteLotConfirm(false);
    setStoreOpenUnitId("");
    setStoreOpenGrid(null);
    setError(null);
  };

  const resetAll = () => {
    resetScanState();
    setResult(null);
    setSearchResults([]);
    setSelectedSearchResult(null);
    setSearchGrids(new Map());
    setOpenTarget(null);
    setMessage(null);
    setError(null);
    setMode("idle");
  };

  // ── Main lookup: try scan first, then search ──────────────────────
  const handleLookup = async (override?: string) => {
    const q = (override ?? input).trim();
    if (!q) return;
    resetAll();
    setLoading(true);

    try {
      // Try barcode scan first
      const res = await api.post("/scan/lookup", { barcode: q });
      setResult(res.data);
      setMode("scan");
      api.get("/fluorochromes/").then((r) => setFluorochromes(r.data));
    } catch (scanErr: any) {
      // If 404, try antibody search
      if (scanErr.response?.status === 404) {
        try {
          const searchRes = await api.get("/antibodies/search", { params: { q } });
          if (searchRes.data.length > 0) {
            setSearchResults(searchRes.data);
            setMode("search");
          } else {
            // Neither scan nor search found results — offer registration
            setScannedBarcode(q);
            setMode("register");
            setEnrichResult(null);
            setSelectedDevice(null);

            const regDefaults = {
              antibody_id: "",
              lot_number: "",
              vendor_barcode: q,
              expiration_date: "",
              quantity: "1",
              storage_unit_id: "",
            };
            const abDefaults = {
              target: "",
              fluorochrome_choice: "",
              new_fluorochrome: "",
              new_fluoro_color: DEFAULT_FLUORO_COLOR,
              clone: "",
              vendor: "",
              catalog_number: "",
              stability_days: "",
              low_stock_threshold: "",
              approved_low_threshold: "",
            };

            setRegForm(regDefaults);
            setNewAbForm(abDefaults);

            const [abRes, suRes, fluoroRes] = await Promise.all([
              api.get("/antibodies/"),
              api.get("/storage/units"),
              api.get("/fluorochromes/"),
            ]);
            setAntibodies(abRes.data);
            setStorageUnits(suRes.data);
            setFluorochromes(fluoroRes.data);

            // Try GS1 enrichment in the background
            setEnrichLoading(true);
            try {
              const enrichRes = await api.post<ScanEnrichResult>("/scan/enrich", { barcode: q });
              const enrich = enrichRes.data;
              setEnrichResult(enrich);

              if (enrich.parsed) {
                // Auto-populate lot fields from parsed GS1 data
                setRegForm((prev) => ({
                  ...prev,
                  lot_number: enrich.lot_number || prev.lot_number,
                  expiration_date: enrich.expiration_date || prev.expiration_date,
                }));

                // If single GUDID match, auto-populate antibody fields
                if (enrich.gudid_devices.length === 1) {
                  const device = enrich.gudid_devices[0];
                  setSelectedDevice(device);
                  setNewAbForm((prev) => ({
                    ...prev,
                    vendor: device.company_name || prev.vendor,
                    catalog_number: device.catalog_number || prev.catalog_number,
                  }));
                }
              }
            } catch {
              // Enrich failure is non-blocking — user can still register manually
            } finally {
              setEnrichLoading(false);
            }
          }
        } catch {
          setError("Search failed");
        }
      } else {
        setError(scanErr.response?.data?.detail || "Lookup failed");
      }
    } finally {
      setLoading(false);
    }
  };

  const refreshScan = async () => {
    if (!input.trim()) return;
    try {
      const res = await api.post("/scan/lookup", { barcode: input.trim() });
      setResult(res.data);
    } catch {
      setResult(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleLookup();
    }
  };

  // ── Scan: Open New ──────────────────────────────────────────────────
  const confirmOpen = async (force = false) => {
    if (!selectedCell || !result) return;
    const vial = result.vials.find((v) => v.location_cell_id === selectedCell.id);
    if (!vial) { setError("No vial found at this location"); return; }
    if (result.qc_warning && !force) { setShowQcConfirm(true); return; }
    setLoading(true);
    setShowQcConfirm(false);
    try {
      await api.post(`/vials/${vial.id}/open?force=${!!result.qc_warning}`, { cell_id: selectedCell.id });
      setMessage(`Vial opened from cell ${selectedCell.label}. Status updated.`);
      resetScanState();
      await refreshScan();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to open vial");
    } finally {
      setLoading(false);
    }
  };

  // ── Scan: Receive More ──────────────────────────────────────────────
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
      resetScanState();
      await refreshScan();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to receive vials");
    } finally {
      setLoading(false);
    }
  };

  // ── Scan: Deplete ───────────────────────────────────────────────────
  const confirmDeplete = async () => {
    if (!selectedVial) return;
    setLoading(true);
    try {
      await api.post(`/vials/${selectedVial.id}/deplete`);
      setMessage("Vial depleted. Status updated.");
      resetScanState();
      await refreshScan();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to deplete vial");
    } finally {
      setLoading(false);
    }
  };

  const confirmDepleteAll = async () => {
    if (!result) return;
    setLoading(true);
    setShowDepleteAllConfirm(false);
    try {
      const res = await api.post(`/lots/${result.lot.id}/deplete-all`);
      setMessage(`${res.data.length} vial(s) depleted for lot ${result.lot.lot_number}.`);
      resetScanState();
      await refreshScan();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to deplete all vials");
    } finally {
      setLoading(false);
    }
  };

  const confirmDepleteLot = async () => {
    if (!result) return;
    setLoading(true);
    setShowDepleteLotConfirm(false);
    try {
      const res = await api.post(`/lots/${result.lot.id}/deplete-all-lot`);
      setMessage(`${res.data.length} vial(s) depleted (entire lot) for lot ${result.lot.lot_number}.`);
      resetScanState();
      await refreshScan();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to deplete lot");
    } finally {
      setLoading(false);
    }
  };

  // ── Scan: Store Open Vial ──────────────────────────────────────────
  const loadStoreOpenGrid = async (unitId: string) => {
    if (!unitId) { setStoreOpenGrid(null); return; }
    try {
      const res = await api.get(`/storage/units/${unitId}/grid`);
      setStoreOpenGrid(res.data);
    } catch {
      setStoreOpenGrid(null);
    }
  };

  const confirmStoreOpen = async () => {
    if (!selectedVial || !selectedCell) return;
    setLoading(true);
    try {
      await api.post(`/vials/${selectedVial.id}/return-to-storage`, { cell_id: selectedCell.id });
      setMessage(`Open vial stored in cell ${selectedCell.label}.`);
      resetScanState();
      await refreshScan();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to store vial");
    } finally {
      setLoading(false);
    }
  };

  // ── Registration ────────────────────────────────────────────────────
  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const quantity = regForm.quantity.trim() ? parseInt(regForm.quantity, 10) : NaN;
      if (!Number.isFinite(quantity) || quantity < 1) {
        setError("Please enter a valid vial quantity.");
        setLoading(false);
        return;
      }
      let antibodyId = regForm.antibody_id;
      if (antibodyId === NEW_ANTIBODY_VALUE) {
        const target = newAbForm.target.trim();
        let fluoroName = newAbForm.fluorochrome_choice;
        if (fluoroName === NEW_FLUORO_VALUE) {
          const name = newAbForm.new_fluorochrome.trim();
          if (!name) {
            setError("Please enter a fluorochrome name.");
            setLoading(false);
            return;
          }
          const existing = fluorochromes.find(
            (f) => f.name.toLowerCase() === name.toLowerCase()
          );
          if (!existing) {
            await api.post("/fluorochromes/", {
              name,
              color: newAbForm.new_fluoro_color,
            });
          } else if (existing.color !== newAbForm.new_fluoro_color) {
            await api.patch(`/fluorochromes/${existing.id}`, {
              color: newAbForm.new_fluoro_color,
            });
          }
          fluoroName = name;
        }
        if (!target || !fluoroName) {
          setError("Please enter antibody name and select a fluorochrome.");
          setLoading(false);
          return;
        }
        const abRes = await api.post("/antibodies/", {
          target,
          fluorochrome: fluoroName,
          clone: newAbForm.clone.trim() || null,
          vendor: newAbForm.vendor.trim() || null,
          catalog_number: newAbForm.catalog_number.trim() || null,
          stability_days: newAbForm.stability_days.trim()
            ? parseInt(newAbForm.stability_days, 10)
            : null,
          low_stock_threshold: newAbForm.low_stock_threshold.trim()
            ? parseInt(newAbForm.low_stock_threshold, 10)
            : null,
          approved_low_threshold: newAbForm.approved_low_threshold.trim()
            ? parseInt(newAbForm.approved_low_threshold, 10)
            : null,
        });
        antibodyId = abRes.data.id;
      }
      const lotRes = await api.post("/lots/", {
        antibody_id: antibodyId,
        lot_number: regForm.lot_number,
        vendor_barcode: regForm.vendor_barcode.trim() || scannedBarcode,
        expiration_date: regForm.expiration_date || null,
        gs1_ai: enrichResult?.all_ais || null,
      });
      await api.post("/vials/receive", {
        lot_id: lotRes.data.id,
        quantity,
        storage_unit_id: regForm.storage_unit_id || null,
      });
      setMessage(`Lot "${regForm.lot_number}" registered with ${quantity} vial(s). Barcode: ${scannedBarcode}`);
      setMode("idle");
      setInput("");
      inputRef.current?.focus();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  // ── Search: select result ───────────────────────────────────────────
  const handleSearchSelect = async (r: AntibodySearchResult) => {
    setSelectedSearchResult(r);
    if (r.storage_locations.length === 0) { setSearchGrids(new Map()); return; }
    const newGrids = new Map<string, StorageGridType>();
    await Promise.all(
      r.storage_locations.map(async (loc) => {
        try {
          const res = await api.get(`/storage/units/${loc.unit_id}/grid`);
          newGrids.set(loc.unit_id, res.data);
        } catch { /* skip */ }
      })
    );
    setSearchGrids(newGrids);
  };

  const handleSearchGridCellClick = (cell: StorageCell) => {
    if (!cell.vial || cell.vial.status !== "sealed") return;
    setOpenTarget(cell);
  };

  const handleOpenVialFromSearch = async (force: boolean) => {
    if (!openTarget?.vial) return;
    setOpenLoading(true);
    try {
      await api.post(`/vials/${openTarget.vial.id}/open?force=${force}`, { cell_id: openTarget.id });
      setMessage(`Vial opened from cell ${openTarget.label}. Status updated.`);
      setOpenTarget(null);
      if (selectedSearchResult) await handleSearchSelect(selectedSearchResult);
    } catch (err: any) {
      setOpenTarget(null);
    } finally {
      setOpenLoading(false);
    }
  };

  const handleCellClick = (cell: StorageCell) => {
    setSelectedCell(cell);
    setMessage(null);
    setError(null);
  };

  // ── Computed values (scan) ──────────────────────────────────────────
  const highlightCellVialIds = new Set<string>();
  if (result?.storage_grid && intent === "open") {
    for (const cell of result.storage_grid.cells) {
      if (cell.vial_id && result.vials.some((v) => v.id === cell.vial_id)) {
        highlightCellVialIds.add(cell.vial_id);
      }
    }
  }

  const recommendation = result?.vials
    .filter((v) => v.location_cell_id)
    .sort((a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime())[0];

  const recommendedCell = recommendation
    ? result?.storage_grid?.cells.find((c) => c.id === recommendation.location_cell_id)
    : null;

  const canOpenScan = (result?.vials.length ?? 0) > 0;
  const canDeplete = (result?.opened_vials?.length ?? 0) > 0;
  const unstored_opened = result?.opened_vials?.filter((v) => !v.location_cell_id) ?? [];
  const canStoreOpen = unstored_opened.length > 0;

  const fluoroMap = new Map<string, string>();
  for (const f of fluorochromes) {
    fluoroMap.set(f.name.toLowerCase(), f.color);
  }

  return (
    <div>
      <h1>Scan / Search</h1>
      <p className="page-desc">
        Scan a vendor barcode to look up a lot, or type to search antibodies by name, fluorochrome, clone, or catalog number.
      </p>

      <div className="scan-input-container">
        <input
          ref={inputRef}
          className="scan-input"
          placeholder="Scan barcode or search antibodies..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        <BarcodeScannerButton
          onDetected={(value) => {
            setInput(value);
            handleLookup(value);
          }}
          disabled={loading}
        />
        <button onClick={() => handleLookup()} disabled={loading}>
          {loading ? "Looking up..." : "Go"}
        </button>
        {mode !== "idle" && (
          <button
            className="btn-secondary"
            onClick={() => { resetAll(); setInput(""); inputRef.current?.focus(); }}
          >
            Clear
          </button>
        )}
      </div>

      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}

      {/* ── Registration Form ──────────────────────────────────────── */}
      {mode === "register" && canEdit && (
        <div className="register-panel">
          <h2>New Lot — Barcode "{scannedBarcode}"</h2>
          <p className="page-desc">
            This barcode isn't registered and no antibodies match. Fill in the details below to register a new lot.
          </p>

          {enrichLoading && (
            <p className="info">Parsing barcode...</p>
          )}

          {enrichResult && enrichResult.warnings.length > 0 && (
            <div className="enrich-warnings">
              {enrichResult.warnings.map((w, i) => (
                <p key={i} className="info">{w}</p>
              ))}
            </div>
          )}

          {enrichResult?.parsed && enrichResult.gudid_devices.length === 1 && selectedDevice && (
            <div className="enrich-info">
              <p className="success">Device info auto-filled from FDA database: {selectedDevice.brand_name} — {selectedDevice.company_name}</p>
            </div>
          )}

          {enrichResult?.parsed && enrichResult.gudid_devices.length > 1 && !selectedDevice && (
            <div className="gudid-picker">
              <p className="page-desc"><strong>Multiple devices found for this GTIN. Select the matching device:</strong></p>
              <div className="gudid-picker-list">
                {enrichResult.gudid_devices.map((d, i) => (
                  <div key={i} className="gudid-picker-item" onClick={() => {
                    setSelectedDevice(d);
                    setNewAbForm((prev) => ({
                      ...prev,
                      vendor: d.company_name || prev.vendor,
                      catalog_number: d.catalog_number || prev.catalog_number,
                    }));
                  }}>
                    <div><strong>{d.brand_name}</strong></div>
                    <div>{d.company_name} — {d.catalog_number || "No catalog #"}</div>
                    <div className="gudid-picker-desc">{d.description}</div>
                  </div>
                ))}
                <button type="button" className="btn-secondary btn-sm" onClick={() => setSelectedDevice({} as GUDIDDevice)}>
                  Skip — enter manually
                </button>
              </div>
            </div>
          )}

          {enrichResult?.parsed && enrichResult.gudid_devices.length > 1 && selectedDevice && selectedDevice.company_name && (
            <div className="enrich-info">
              <p className="success">Selected: {selectedDevice.brand_name} — {selectedDevice.company_name}
                <button type="button" className="btn-secondary btn-sm" style={{ marginLeft: "0.5rem" }} onClick={() => setSelectedDevice(null)}>Change</button>
              </p>
            </div>
          )}

          <form className="register-form" onSubmit={handleRegister}>
            <div className="form-group">
              <label>Antibody</label>
              <select value={regForm.antibody_id} onChange={(e) => setRegForm({ ...regForm, antibody_id: e.target.value })} required>
                <option value="">Select Antibody</option>
                <option value={NEW_ANTIBODY_VALUE}>+ New Antibody</option>
                {antibodies.map((ab) => (
                  <option key={ab.id} value={ab.id}>{ab.target} - {ab.fluorochrome}{ab.clone ? ` (${ab.clone})` : ""}</option>
                ))}
              </select>
            </div>
            {regForm.antibody_id === NEW_ANTIBODY_VALUE && (
              <>
                <div className="form-row">
                  <div className="form-group">
                    <label>New Antibody</label>
                    <input
                      placeholder="Target (e.g., CD3)"
                      value={newAbForm.target}
                      onChange={(e) => setNewAbForm({ ...newAbForm, target: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Fluorochrome</label>
                    <select
                      value={newAbForm.fluorochrome_choice}
                      onChange={(e) =>
                        setNewAbForm({ ...newAbForm, fluorochrome_choice: e.target.value })
                      }
                      required
                    >
                      <option value="">Select Fluorochrome</option>
                      <option value={NEW_FLUORO_VALUE}>+ New Fluorochrome</option>
                      {fluorochromes.map((f) => (
                        <option key={f.id} value={f.name}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {newAbForm.fluorochrome_choice === NEW_FLUORO_VALUE && (
                  <div className="form-row">
                    <div className="form-group">
                      <label>New Fluorochrome</label>
                      <input
                        placeholder="e.g., FITC"
                        value={newAbForm.new_fluorochrome}
                        onChange={(e) =>
                          setNewAbForm({ ...newAbForm, new_fluorochrome: e.target.value })
                        }
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Color</label>
                      <input
                        type="color"
                        value={newAbForm.new_fluoro_color}
                        onChange={(e) =>
                          setNewAbForm({ ...newAbForm, new_fluoro_color: e.target.value })
                        }
                        required
                      />
                    </div>
                  </div>
                )}
                <div className="form-row">
                  <div className="form-group">
                    <label>Clone</label>
                    <input
                      placeholder="Clone"
                      value={newAbForm.clone}
                      onChange={(e) => setNewAbForm({ ...newAbForm, clone: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Vendor</label>
                    <input
                      placeholder="Vendor"
                      value={newAbForm.vendor}
                      onChange={(e) => setNewAbForm({ ...newAbForm, vendor: e.target.value })}
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Catalog #</label>
                    <input
                      placeholder="Catalog #"
                      value={newAbForm.catalog_number}
                      onChange={(e) => setNewAbForm({ ...newAbForm, catalog_number: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Stability (days)</label>
                    <input
                      type="number"
                      min={1}
                      placeholder="Stability (days)"
                      value={newAbForm.stability_days}
                      onChange={(e) => setNewAbForm({ ...newAbForm, stability_days: e.target.value })}
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Reorder Point <small style={{ fontWeight: "normal", color: "#888" }}>(total sealed vials)</small></label>
                    <input
                      type="number"
                      min={1}
                      placeholder="Reorder Point"
                      title="Alert when total vials on hand drops below this level"
                      value={newAbForm.low_stock_threshold}
                      onChange={(e) => setNewAbForm({ ...newAbForm, low_stock_threshold: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Min Ready Stock <small style={{ fontWeight: "normal", color: "#888" }}>(approved vials)</small></label>
                    <input
                      type="number"
                      min={1}
                      placeholder="Min Ready Stock"
                      title="Alert when QC-approved vials drops below this level"
                      value={newAbForm.approved_low_threshold}
                      onChange={(e) => setNewAbForm({ ...newAbForm, approved_low_threshold: e.target.value })}
                    />
                  </div>
                </div>
              </>
            )}
            <div className="form-group">
              <label>Lot Number</label>
              <input placeholder="e.g., 12345" value={regForm.lot_number} onChange={(e) => setRegForm({ ...regForm, lot_number: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>Vendor Barcode</label>
              <div className="input-with-scan">
                <input
                  placeholder="Vendor barcode"
                  value={regForm.vendor_barcode}
                  onChange={(e) => setRegForm({ ...regForm, vendor_barcode: e.target.value })}
                />
                <BarcodeScannerButton
                  label="Scan"
                  onDetected={(value) => setRegForm({ ...regForm, vendor_barcode: value })}
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Vials Received</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={regForm.quantity}
                  onChange={(e) => setRegForm({ ...regForm, quantity: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Expiration Date</label>
                <DatePicker value={regForm.expiration_date} onChange={(v) => setRegForm({ ...regForm, expiration_date: v })} placeholderText="Expiration date" />
              </div>
            </div>
            <div className="form-group">
              <label>Store in</label>
              <select value={regForm.storage_unit_id} onChange={(e) => setRegForm({ ...regForm, storage_unit_id: e.target.value })}>
                <option value="">No storage assignment</option>
                {storageUnits.map((u) => (
                  <option key={u.id} value={u.id}>{u.name} ({u.rows}x{u.cols}) {u.temperature || ""}</option>
                ))}
              </select>
            </div>
            <div className="register-actions">
              <button type="submit" disabled={loading}>{loading ? "Registering..." : "Register Lot & Receive Vials"}</button>
              <button type="button" className="btn-secondary" onClick={() => { setMode("idle"); setInput(""); inputRef.current?.focus(); }}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {mode === "register" && !canEdit && (
        <div className="register-panel">
          <p className="error">Barcode "{scannedBarcode}" is not registered. Contact your supervisor to register this lot.</p>
        </div>
      )}

      {/* ── Scan Result ────────────────────────────────────────────── */}
      {mode === "scan" && result && (
        <div className="scan-result-wrapper">
          <div className="scan-info">
            <h2>
              {fluoroMap.get(result.antibody.fluorochrome.toLowerCase()) && (
                <div className="color-dot" style={{ backgroundColor: fluoroMap.get(result.antibody.fluorochrome.toLowerCase()) }} />
              )}
              {result.antibody.target} - {result.antibody.fluorochrome}
            </h2>
            <p>Lot: <strong>{result.lot.lot_number}</strong> | QC: <span className={`badge ${result.lot.qc_status === "approved" ? "badge-green" : result.lot.qc_status === "failed" ? "badge-red" : "badge-yellow"}`}>{result.lot.qc_status}</span></p>
            <p>
              Sealed: <strong>{result.vials.length}</strong>
              {!sealedOnly && (
                <>
                  {" "}| Opened: <strong>{result.opened_vials?.length ?? 0}</strong>
                </>
              )}
            </p>
            {result.qc_warning && <div className="qc-warning">{result.qc_warning}</div>}
            {result.qc_warning && !canEdit && <p className="error">This lot has not been QC-approved. Contact your supervisor.</p>}
          </div>

          {/* Intent Menu */}
          <div className="intent-menu">
            <button className={`intent-btn ${intent === "open" ? "active" : ""}`} onClick={() => { resetScanState(); setIntent("open"); }} disabled={!canOpenScan} title={!canOpenScan ? "No sealed vials" : ""}>{sealedOnly ? "Use Vial" : "Open New"}</button>
            <button className={`intent-btn ${intent === "receive" ? "active" : ""}`} onClick={() => { resetScanState(); setIntent("receive"); setReceiveQty(1); setReceiveStorageId(result.storage_grid?.unit.id ?? ""); api.get("/storage/units").then((r) => setStorageUnits(r.data)); }}>Receive More</button>
            {!sealedOnly && <button className={`intent-btn ${intent === "store_open" ? "active" : ""}`} onClick={() => { resetScanState(); setIntent("store_open"); setStoreOpenUnitId(""); setStoreOpenGrid(null); api.get("/storage/units").then((r) => setStorageUnits(r.data)); }} disabled={!canStoreOpen} title={!canStoreOpen ? "No unstored opened vials" : ""}>Store Open Vial</button>}
            {!sealedOnly && <button className={`intent-btn ${intent === "deplete" ? "active" : ""}`} onClick={() => { resetScanState(); setIntent("deplete"); }} disabled={!canDeplete} title={!canDeplete ? "No opened vials" : ""}>Deplete</button>}
            <button className="intent-btn" onClick={() => navigate(`/inventory?antibodyId=${result.antibody.id}`)}>View Lot</button>
          </div>

          {/* Intent: Open New */}
          {intent === "open" && (
            <div className="intent-panel">
              {recommendedCell && (
                <p className="recommendation">
                  Suggestion: oldest vial is at cell <strong>{recommendedCell.label}</strong> (received {new Date(recommendation!.received_at).toLocaleDateString()}). Click the cell you are actually pulling from.
                </p>
              )}
              {result.storage_grid && (
                <div className="grid-container">
                  <h3>{result.storage_grid.unit.name}</h3>
                  <StorageGrid rows={result.storage_grid.unit.rows} cols={result.storage_grid.unit.cols} cells={result.storage_grid.cells} highlightVialIds={highlightCellVialIds} recommendedCellId={recommendedCell?.id} onCellClick={handleCellClick} selectedCellId={selectedCell?.id} clickMode="highlighted" fluorochromes={fluorochromes} />
                  {selectedCell && !showQcConfirm && (
                    <div className="confirm-action">
                      <p>You selected cell <strong>{selectedCell.label}</strong>.</p>
                      <button className="btn-green" onClick={() => confirmOpen()} disabled={loading}>Confirm Open Vial</button>
                    </div>
                  )}
                  {showQcConfirm && (
                    <div className="qc-confirm-dialog">
                      <p className="qc-confirm-warning">This lot hasn't been approved yet. Are you sure you wish to open this vial?</p>
                      <div className="qc-confirm-actions">
                        <button className="btn-red" onClick={() => confirmOpen(true)} disabled={loading}>Yes, Open Anyway</button>
                        <button className="btn-secondary" onClick={() => setShowQcConfirm(false)}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {!result.storage_grid && result.vials.length > 0 && (
                <p className="info">Vials found but not assigned to storage. Assign vials to a storage unit to use the grid selection.</p>
              )}
            </div>
          )}

          {/* Intent: Receive More */}
          {intent === "receive" && (
            <div className="intent-panel">
              <form className="receive-form" onSubmit={handleReceive}>
                <p className="page-desc">Receive additional vials for lot <strong>{result.lot.lot_number}</strong>.</p>
                <div className="form-row">
                  <div className="form-group">
                    <label>Quantity</label>
                    <input type="number" min={1} max={100} value={receiveQty} onChange={(e) => setReceiveQty(parseInt(e.target.value) || 1)} required />
                  </div>
                  <div className="form-group">
                    <label>Store in</label>
                    <select value={receiveStorageId} onChange={(e) => setReceiveStorageId(e.target.value)}>
                      <option value="">No storage assignment</option>
                      {storageUnits.map((u) => (
                        <option key={u.id} value={u.id}>{u.name} ({u.rows}x{u.cols}) {u.temperature || ""}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <button type="submit" disabled={loading}>{loading ? "Receiving..." : "Receive Vials"}</button>
              </form>
            </div>
          )}

          {/* Intent: Deplete */}
          {intent === "deplete" && (
            <div className="intent-panel">
              <p className="page-desc">Select the opened vial to mark as depleted.</p>
              {result.opened_vials.length > 1 && !showDepleteAllConfirm && (
                <button className="btn-red" style={{ marginBottom: "0.75rem" }} onClick={() => setShowDepleteAllConfirm(true)} disabled={loading}>
                  Deplete All ({result.opened_vials.length} vials)
                </button>
              )}
              {showDepleteAllConfirm && (
                <div className="confirm-action">
                  <p>Deplete all <strong>{result.opened_vials.length}</strong> opened vials for lot <strong>{result.lot.lot_number}</strong>?</p>
                  <div className="action-btns">
                    <button className="btn-red" onClick={confirmDepleteAll} disabled={loading}>{loading ? "Depleting..." : "Yes, Deplete All"}</button>
                    <button className="btn-secondary" onClick={() => setShowDepleteAllConfirm(false)}>Cancel</button>
                  </div>
                </div>
              )}
              {canEdit && !showDepleteLotConfirm && (
                <button className="btn-red" style={{ marginBottom: "0.75rem" }} onClick={() => setShowDepleteLotConfirm(true)} disabled={loading}>
                  Deplete Entire Lot ({result.vials.length + result.opened_vials.length} vials)
                </button>
              )}
              {showDepleteLotConfirm && (
                <div className="confirm-action">
                  <p>Deplete ALL vials (sealed + opened) for lot <strong>{result.lot.lot_number}</strong>? This cannot be undone.</p>
                  <div className="action-btns">
                    <button className="btn-red" onClick={confirmDepleteLot} disabled={loading}>{loading ? "Depleting..." : "Yes, Deplete Entire Lot"}</button>
                    <button className="btn-secondary" onClick={() => setShowDepleteLotConfirm(false)}>Cancel</button>
                  </div>
                </div>
              )}
              <div className="vial-select-list">
                {result.opened_vials.map((v) => {
                  const isExpired = v.open_expiration && new Date(v.open_expiration) < new Date();
                  return (
                    <div key={v.id} className={`vial-select-item ${selectedVial?.id === v.id ? "selected" : ""}`} onClick={() => setSelectedVial(v)}>
                      <span className="vial-id">{v.id.slice(0, 8)}</span>
                      <span className="vial-detail">Opened {v.opened_at ? new Date(v.opened_at).toLocaleDateString() : "—"}</span>
                      {v.open_expiration && <span className={`vial-expiration ${isExpired ? "expired" : ""}`}>{isExpired ? "Expired" : `Exp: ${v.open_expiration}`}</span>}
                    </div>
                  );
                })}
              </div>
              {selectedVial && (
                <div className="confirm-action">
                  <p>Deplete vial <strong>{selectedVial.id.slice(0, 8)}</strong>?</p>
                  <button className="btn-red" onClick={confirmDeplete} disabled={loading}>Confirm Deplete</button>
                </div>
              )}
            </div>
          )}
          {/* Intent: Store Open Vial */}
          {intent === "store_open" && (
            <div className="intent-panel">
              <p className="page-desc">Select an opened vial, choose a storage unit, then click an empty cell to store it.</p>
              <div className="vial-select-list">
                {unstored_opened.map((v) => {
                  const isExpired = v.open_expiration && new Date(v.open_expiration) < new Date();
                  return (
                    <div key={v.id} className={`vial-select-item ${selectedVial?.id === v.id ? "selected" : ""}`} onClick={() => { setSelectedVial(v); setSelectedCell(null); }}>
                      <span className="vial-id">{v.id.slice(0, 8)}</span>
                      <span className="vial-detail">Opened {v.opened_at ? new Date(v.opened_at).toLocaleDateString() : "—"}</span>
                      {v.open_expiration && <span className={`vial-expiration ${isExpired ? "expired" : ""}`}>{isExpired ? "Expired" : `Exp: ${v.open_expiration}`}</span>}
                    </div>
                  );
                })}
              </div>
              {selectedVial && (
                <>
                  <div className="form-group" style={{ marginTop: "0.75rem" }}>
                    <label>Storage Unit</label>
                    <select value={storeOpenUnitId} onChange={(e) => { setStoreOpenUnitId(e.target.value); setSelectedCell(null); loadStoreOpenGrid(e.target.value); }}>
                      <option value="">Select storage unit</option>
                      {storageUnits.map((u) => (
                        <option key={u.id} value={u.id}>{u.name} ({u.rows}x{u.cols}) {u.temperature || ""}</option>
                      ))}
                    </select>
                  </div>
                  {storeOpenGrid && (
                    <div className="grid-container">
                      <h3>{storeOpenGrid.unit.name}</h3>
                      <StorageGrid rows={storeOpenGrid.unit.rows} cols={storeOpenGrid.unit.cols} cells={storeOpenGrid.cells} highlightVialIds={new Set()} onCellClick={handleCellClick} selectedCellId={selectedCell?.id} clickMode="empty" showVialInfo fluorochromes={fluorochromes} />
                    </div>
                  )}
                  {selectedCell && (
                    <div className="confirm-action">
                      <p>Store vial <strong>{selectedVial.id.slice(0, 8)}</strong> in cell <strong>{selectedCell.label}</strong>?</p>
                      <button className="btn-green" onClick={confirmStoreOpen} disabled={loading}>{loading ? "Storing..." : "Confirm Store"}</button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Search Results ─────────────────────────────────────────── */}
      {mode === "search" && (
        <>
          {searchResults.length > 0 && (
            <table className="search-results-table">
              <thead>
                <tr>
                  <th>Target</th>
                  <th>Fluorochrome</th>
                  <th>Clone</th>
                  <th>Catalog #</th>
                  <th>Sealed</th>
                  <th>Opened</th>
                  <th>Depleted</th>
                  <th>Lots</th>
                  <th>Locations</th>
                </tr>
              </thead>
              <tbody>
                {searchResults.map((r) => (
                  <tr key={r.antibody.id} className={`clickable-row ${selectedSearchResult?.antibody.id === r.antibody.id ? "active" : ""}`} onClick={() => handleSearchSelect(r)}>
                    <td>{r.antibody.target}</td>
                    <td>{r.antibody.fluorochrome}</td>
                    <td>{r.antibody.clone || "—"}</td>
                    <td>{r.antibody.catalog_number || "—"}</td>
                    <td>{r.total_vial_counts.sealed}</td>
                    <td>{r.total_vial_counts.opened}</td>
                    <td>{r.total_vial_counts.depleted}</td>
                    <td>{r.lots.length}</td>
                    <td>{r.storage_locations.length > 0 ? r.storage_locations.map((l) => l.unit_name).join(", ") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {selectedSearchResult && (
            <div className="locator-panel">
              <h2>{selectedSearchResult.antibody.target} - {selectedSearchResult.antibody.fluorochrome}</h2>
              {selectedSearchResult.lots.length > 0 && (
                <div className="lot-summaries">
                  {selectedSearchResult.lots.map((lot) => (
                    <div key={lot.id} className="lot-summary-item">
                      <span className="lot-summary-number">Lot {lot.lot_number}</span>
                      <span className={`badge ${lot.qc_status === "approved" ? "badge-green" : lot.qc_status === "failed" ? "badge-red" : "badge-yellow"}`}>{lot.qc_status}</span>
                      <span className="lot-summary-counts">{lot.vial_counts.sealed} sealed, {lot.vial_counts.opened} opened</span>
                      {lot.expiration_date && <span className="lot-summary-exp">Exp: {lot.expiration_date}</span>}
                    </div>
                  ))}
                </div>
              )}
              {selectedSearchResult.storage_locations.length === 0 ? (
                <p className="empty">No vials currently in storage for this antibody.</p>
              ) : (
                selectedSearchResult.storage_locations.map((loc) => {
                  const grid = searchGrids.get(loc.unit_id);
                  if (!grid) return null;
                  return (
                    <div key={loc.unit_id} className="grid-container">
                      <h3>{loc.unit_name}{loc.temperature ? ` (${loc.temperature})` : ""}</h3>
                      <StorageGrid rows={grid.unit.rows} cols={grid.unit.cols} cells={grid.cells} highlightVialIds={new Set(loc.vial_ids)} onCellClick={canOpen ? handleSearchGridCellClick : undefined} clickMode={canOpen ? "occupied" : "highlighted"} showVialInfo />
                    </div>
                  );
                })
              )}
            </div>
          )}
        </>
      )}

      {openTarget && (
        <OpenVialDialog
          cell={openTarget}
          loading={openLoading}
          onConfirm={handleOpenVialFromSearch}
          onViewLot={() => {
            const abId = openTarget.vial?.antibody_id;
            setOpenTarget(null);
            if (abId) navigate(`/inventory?antibodyId=${abId}`);
          }}
          onCancel={() => setOpenTarget(null)}
        />
      )}
    </div>
  );
}
