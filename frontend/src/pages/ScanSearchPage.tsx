import { useState, useRef, useEffect, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type {
  ScanLookupResult,
  ScanEnrichResult,
  GUDIDDevice,
  ScanIntent,
  StorageCell,
  Vial,
  Antibody,
  Designation,
  StorageUnit,
  AntibodySearchResult,
  StorageGrid as StorageGridType,
} from "../api/types";
import AntibodyCard from "../components/AntibodyCard";
import CocktailLotCard from "../components/CocktailLotCard";
import CocktailRecipeCard from "../components/CocktailRecipeCard";
import CopyButton from "../components/CopyButton";
import ViewToggle from "../components/ViewToggle";
import LotTable from "../components/LotTable";
import LotCardList from "../components/LotCardList";
import { StorageView } from "../components/storage";
import BarcodeScannerButton from "../components/BarcodeScannerButton";
import { useAuth } from "../context/AuthContext";
import { useSharedData } from "../context/SharedDataContext";
import { useToast } from "../context/ToastContext";
import { useViewPreference } from "../hooks/useViewPreference";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { lotSummaryToLot } from "../utils/lotAdapters";
import AntibodyForm, { NEW_FLUORO_VALUE, EMPTY_AB_FORM } from "../components/AntibodyForm";
import LotRegistrationForm, { EMPTY_LOT_FORM } from "../components/LotRegistrationForm";

type ResultMode = "idle" | "scan" | "search" | "register";
const NEW_ANTIBODY_VALUE = "__new__";
// NEW_FLUORO_VALUE, DEFAULT_FLUORO_COLOR imported from AntibodyForm

export default function ScanSearchPage() {
  const { user, labSettings } = useAuth();
  const { fluorochromes, storageUnits: sharedStorageUnits, refreshFluorochromes } = useSharedData();
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const sealedOnly = labSettings.sealed_counts_only ?? false;
  const storageEnabled = labSettings.storage_enabled !== false;
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
  const [showDepleteAllConfirm, setShowDepleteAllConfirm] = useState(false);
  const [showDepleteLotConfirm, setShowDepleteLotConfirm] = useState(false);
  const [receiveQty, setReceiveQty] = useState(1);
  const [receiveStorageId, setReceiveStorageId] = useState("");
  const [receiveAvailableSlots, setReceiveAvailableSlots] = useState<number | null>(null);
  const [receiveIsTemp, setReceiveIsTemp] = useState(false);
  const [overflowMode, setOverflowMode] = useState<"split" | "switch" | "temp" | null>(null);
  const [overflowSecondUnitId, setOverflowSecondUnitId] = useState("");
  const [storeOpenUnitId, setStoreOpenUnitId] = useState("");
  const [storeOpenGrid, setStoreOpenGrid] = useState<StorageGridType | null>(null);
  // ── Inline move mode (StorageView handles internals) ────────────────
  const [scanMoveMode, setScanMoveMode] = useState(false);

  // ── Bulk deplete state ─────────────────────────────────────────────
  const [depleteSelectedVialIds, setDepleteSelectedVialIds] = useState<Set<string>>(new Set());
  const [showBulkDepleteConfirm, setShowBulkDepleteConfirm] = useState(false);

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
  // New antibody form — uses shared AntibodyFormValues type
  const [newAbForm, setNewAbForm] = useState(EMPTY_AB_FORM);

  // ── GS1 Enrich state ───────────────────────────────────────────────
  const [enrichResult, setEnrichResult] = useState<ScanEnrichResult | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<GUDIDDevice | null>(null);

  // ── Search state ────────────────────────────────────────────────────
  const [searchResults, setSearchResults] = useState<AntibodySearchResult[]>([]);
  const [selectedSearchResult, setSelectedSearchResult] = useState<AntibodySearchResult | null>(null);
  const [searchGrids, setSearchGrids] = useState<Map<string, StorageGridType>>(new Map());
  const [showInactive, setShowInactive] = useState(false);
  const [selectedLotId, setSelectedLotId] = useState<string | null>(null);
  const [designationFilter, setDesignationFilter] = useState<string>("");

  // Card / list view preference (synced with InventoryPage + SearchPage)
  const [searchView, setSearchView] = useViewPreference();
  const isMobile = useMediaQuery("(max-width: 768px)");

  // fluorochromes come from SharedDataContext

  // Ref so the vialActions hook refresh callback can access current search result
  const selectedSearchResultRef = useRef(selectedSearchResult);
  selectedSearchResultRef.current = selectedSearchResult;



  const canEdit =
    user?.role === "super_admin" ||
    user?.role === "lab_admin" ||
    user?.role === "supervisor";
  const canReceive = canEdit || user?.role === "tech";

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
    setShowDepleteAllConfirm(false);
    setShowDepleteLotConfirm(false);
    setStoreOpenUnitId("");
    setStoreOpenGrid(null);
    setScanMoveMode(false);
    setDepleteSelectedVialIds(new Set());
    setShowBulkDepleteConfirm(false);
    setReceiveAvailableSlots(null);
    setReceiveIsTemp(false);
    setOverflowMode(null);
    setOverflowSecondUnitId("");
    setError(null);
  };

  const checkAvailableSlots = async (unitId: string) => {
    if (!unitId) {
      setReceiveAvailableSlots(null);
      setReceiveIsTemp(false);
      return;
    }
    try {
      const res = await api.get(`/storage/units/${unitId}/available-slots`);
      setReceiveAvailableSlots(res.data.available_cells);
      setReceiveIsTemp(res.data.is_temporary);
    } catch {
      setReceiveAvailableSlots(null);
      setReceiveIsTemp(false);
    }
  };

  const resetAll = () => {
    resetScanState();
    setResult(null);
    setSearchResults([]);
    setSelectedSearchResult(null);
    setSearchGrids(new Map());
    setSelectedLotId(null);
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

            // Reset registration form: antibody_id + lot fields from EMPTY_LOT_FORM
            const regDefaults = {
              antibody_id: "",
              ...EMPTY_LOT_FORM,
              vendor_barcode: q, // pre-fill with scanned barcode
            };
            // Reset antibody form to empty defaults
            const abDefaults = EMPTY_AB_FORM;

            setRegForm(regDefaults);
            setNewAbForm(abDefaults);

            const abRes = await api.get("/antibodies/");
            setAntibodies(abRes.data);
            setStorageUnits(sharedStorageUnits);

            // Try GS1 enrichment in the background
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

                // Auto-suggest IVD designation if GUDID found
                if (enrich.suggested_designation) {
                  setNewAbForm((prev) => ({
                    ...prev,
                    designation: enrich.suggested_designation as Designation,
                  }));
                }

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
    // Invalidate cached dashboard/inventory data so they reflect mutations
    queryClient.invalidateQueries({ queryKey: ["lots"] });
    queryClient.invalidateQueries({ queryKey: ["antibodies"] });
    queryClient.invalidateQueries({ queryKey: ["temp-storage"] });
  };

  // ── Scan: Receive More ──────────────────────────────────────────────
  const handleReceive = async (e: FormEvent) => {
    e.preventDefault();
    if (!result) return;
    setLoading(true);
    setError(null);
    try {
      const needsOverflow = receiveAvailableSlots !== null && !receiveIsTemp && receiveStorageId && receiveQty > receiveAvailableSlots;

      if (needsOverflow && overflowMode === "split" && overflowSecondUnitId) {
        const firstQty = receiveAvailableSlots;
        const secondQty = receiveQty - receiveAvailableSlots;
        await api.post("/vials/receive", {
          lot_id: result.lot!.id,
          quantity: firstQty,
          storage_unit_id: receiveStorageId,
        });
        await api.post("/vials/receive", {
          lot_id: result.lot!.id,
          quantity: secondQty,
          storage_unit_id: overflowSecondUnitId,
        });
        setMessage(`${receiveQty} vial(s) received: ${firstQty} + ${secondQty} split across containers.`);
        addToast(`${receiveQty} vial(s) received (split)`, "success");
      } else if (needsOverflow && overflowMode === "temp") {
        await api.post("/vials/receive", {
          lot_id: result.lot!.id,
          quantity: receiveQty,
          storage_unit_id: null,
        });
        setMessage(`${receiveQty} vial(s) received into temporary storage.`);
        addToast(`${receiveQty} vial(s) received into temp storage`, "info");
      } else {
        await api.post("/vials/receive", {
          lot_id: result.lot!.id,
          quantity: receiveQty,
          storage_unit_id: receiveStorageId || null,
        });
        setMessage(`${receiveQty} vial(s) received for lot ${result.lot!.lot_number}.`);
        addToast(`${receiveQty} vial(s) received`, "success");
      }

      setReceiveQty(1);
      setReceiveStorageId("");
      resetScanState();
      await refreshScan();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to receive vials");
      addToast("Failed to receive vials", "danger");
    } finally {
      setLoading(false);
    }
  };

  // ── Scan: Deplete ───────────────────────────────────────────────────
  const confirmDepleteAll = async () => {
    if (!result) return;
    setLoading(true);
    setShowDepleteAllConfirm(false);
    try {
      const res = await api.post(`/lots/${result.lot!.id}/deplete-all`);
      setMessage(`${res.data.length} vial(s) depleted for lot ${result.lot!.lot_number}.`);
      addToast(`${res.data.length} vial(s) depleted`, "success");
      resetScanState();
      await refreshScan();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to deplete all vials");
      addToast("Failed to deplete vials", "danger");
    } finally {
      setLoading(false);
    }
  };

  const confirmDepleteLot = async () => {
    if (!result) return;
    setLoading(true);
    setShowDepleteLotConfirm(false);
    try {
      const res = await api.post(`/lots/${result.lot!.id}/deplete-all-lot`);
      setMessage(`${res.data.length} vial(s) depleted (entire lot) for lot ${result.lot!.lot_number}.`);
      resetScanState();
      await refreshScan();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to deplete lot");
    } finally {
      setLoading(false);
    }
  };

  const confirmBulkDeplete = async () => {
    if (depleteSelectedVialIds.size === 0) return;
    setLoading(true);
    setShowBulkDepleteConfirm(false);
    try {
      await api.post("/vials/bulk-deplete", {
        vial_ids: Array.from(depleteSelectedVialIds),
      });
      setMessage(`${depleteSelectedVialIds.size} vial(s) depleted.`);
      addToast(`${depleteSelectedVialIds.size} vial(s) depleted`, "success");
      setDepleteSelectedVialIds(new Set());
      resetScanState();
      await refreshScan();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to deplete vials");
      addToast("Failed to deplete vials", "danger");
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

      // Tech requesting a new antibody — submit to request queue instead of creating directly
      if (antibodyId === NEW_ANTIBODY_VALUE && !canEdit) {
        const isIVD = newAbForm.designation === "ivd";
        if (!isIVD) {
          const target = newAbForm.target.trim();
          let fluoroName = newAbForm.fluorochrome_choice;
          if (fluoroName === NEW_FLUORO_VALUE) fluoroName = newAbForm.new_fluorochrome.trim();
          if (!target || !fluoroName) {
            setError("Please enter antibody target and select a fluorochrome.");
            setLoading(false);
            return;
          }
        } else {
          if (!newAbForm.name.trim() || !newAbForm.short_code.trim()) {
            setError("Product name and short code are required for IVD.");
            setLoading(false);
            return;
          }
        }

        const fluoroValue = isIVD
          ? null
          : newAbForm.fluorochrome_choice === NEW_FLUORO_VALUE
            ? newAbForm.new_fluorochrome.trim()
            : newAbForm.fluorochrome_choice;

        await api.post("/lot-requests/", {
          barcode: scannedBarcode,
          lot_number: regForm.lot_number || null,
          expiration_date: regForm.expiration_date || null,
          quantity,
          storage_unit_id: regForm.storage_unit_id || null,
          gs1_ai: enrichResult?.all_ais || null,
          enrichment_data: enrichResult
            ? { gtin: enrichResult.gtin, vendor: enrichResult.vendor, catalog_number: enrichResult.catalog_number }
            : null,
          proposed_antibody: {
            designation: newAbForm.designation,
            target: isIVD ? null : newAbForm.target.trim(),
            fluorochrome: fluoroValue,
            clone: isIVD ? null : (newAbForm.clone.trim() || null),
            vendor: newAbForm.vendor.trim() || null,
            catalog_number: newAbForm.catalog_number.trim() || null,
            name: newAbForm.name.trim() || null,
            short_code: isIVD ? (newAbForm.short_code.trim() || null) : null,
            color: newAbForm.color || null,
            stability_days: newAbForm.stability_days.trim()
              ? parseInt(newAbForm.stability_days, 10)
              : null,
            low_stock_threshold: newAbForm.low_stock_threshold.trim()
              ? parseInt(newAbForm.low_stock_threshold, 10)
              : null,
            approved_low_threshold: newAbForm.approved_low_threshold.trim()
              ? parseInt(newAbForm.approved_low_threshold, 10)
              : null,
          },
          notes: null,
        });

        addToast("Lot request submitted for review", "success");
        setMessage("Your lot request has been submitted for supervisor review.");
        queryClient.invalidateQueries({ queryKey: ["lot-requests"] });
        setMode("idle");
        setInput("");
        inputRef.current?.focus();
        setLoading(false);
        return;
      }

      if (antibodyId === NEW_ANTIBODY_VALUE) {
        const isIVD = newAbForm.designation === "ivd";
        const target = newAbForm.target.trim();
        let fluoroName: string | null = null;
        if (!isIVD) {
          fluoroName = newAbForm.fluorochrome_choice;
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
            setError("Please enter antibody target and select a fluorochrome.");
            setLoading(false);
            return;
          }
        } else {
          if (!newAbForm.name.trim() || !newAbForm.short_code.trim()) {
            setError("Product name and short code are required for IVD.");
            setLoading(false);
            return;
          }
        }
        const abRes = await api.post("/antibodies/", {
          target: isIVD ? null : target,
          fluorochrome: isIVD ? null : fluoroName,
          clone: isIVD ? null : (newAbForm.clone.trim() || null),
          vendor: newAbForm.vendor.trim() || null,
          catalog_number: newAbForm.catalog_number.trim() || null,
          designation: newAbForm.designation,
          name: newAbForm.name.trim() || null,
          short_code: isIVD ? (newAbForm.short_code.trim() || null) : null,
          color: newAbForm.color || null,
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
      refreshFluorochromes();
      queryClient.invalidateQueries({ queryKey: ["lots"] });
      queryClient.invalidateQueries({ queryKey: ["antibodies"] });
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
    setSelectedLotId(null);
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


  const handleCellClick = (cell: StorageCell) => {
    setSelectedCell(cell);
    setMessage(null);
    setError(null);
  };

  // ── Computed values (scan) ──────────────────────────────────────────
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
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); inputRef.current?.blur(); handleLookup(); } }}
          enterKeyHint="go"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <BarcodeScannerButton
          onDetected={(value) => {
            setInput(value);
            handleLookup(value);
          }}
          disabled={loading}
        />
        <button onClick={() => { inputRef.current?.blur(); handleLookup(); }} disabled={loading}>
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
      {mode === "register" && canReceive && (
        <div className="register-panel">
          <h2>New Lot — Barcode "{scannedBarcode}"</h2>
          <p className="page-desc">
            This barcode isn't registered and no antibodies match. Fill in the details below to register a new lot.
          </p>

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
                <option value={NEW_ANTIBODY_VALUE}>{canEdit ? "+ New Antibody" : "+ Request New Antibody"}</option>
                {antibodies.map((ab) => (
                  <option key={ab.id} value={ab.id}>{ab.name || [ab.target, ab.fluorochrome].filter(Boolean).join(" - ") || "Unnamed"}{ab.vendor ? ` — ${ab.vendor}` : ""}{ab.clone ? ` (${ab.clone})` : ""}</option>
                ))}
              </select>
            </div>
            {/* ── New antibody sub-form (shared AntibodyForm component) ── */}
            {regForm.antibody_id === NEW_ANTIBODY_VALUE && (
              <AntibodyForm
                values={newAbForm}
                onChange={setNewAbForm}
                fluorochromes={fluorochromes}
                layout="stacked"
              />
            )}
            {/* ── Lot fields (shared LotRegistrationForm component) ── */}
            <LotRegistrationForm
              values={{
                lot_number: regForm.lot_number,
                vendor_barcode: regForm.vendor_barcode,
                expiration_date: regForm.expiration_date,
                quantity: regForm.quantity,
                storage_unit_id: regForm.storage_unit_id,
              }}
              onChange={(lotValues) => setRegForm({ ...regForm, ...lotValues })}
              storageUnits={storageUnits}
              storageEnabled={storageEnabled}
              layout="stacked"
            />
            <div className="register-actions">
              <button type="submit" disabled={loading}>
                {loading
                  ? "Submitting..."
                  : regForm.antibody_id === NEW_ANTIBODY_VALUE && !canEdit
                    ? "Submit Request for Review"
                    : "Register Lot & Receive Vials"}
              </button>
              <button type="button" className="btn-secondary" onClick={() => { setMode("idle"); setInput(""); inputRef.current?.focus(); }}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {mode === "register" && !canReceive && (
        <div className="register-panel">
          <p className="error">Barcode "{scannedBarcode}" is not registered. Contact your supervisor to register this lot.</p>
        </div>
      )}

      {/* ── Cocktail Recipe Only (no active lot) ───────────────── */}
      {mode === "scan" && result?.is_cocktail && !result.cocktail_lot && result.cocktail_recipe && (
        <div className="scan-result-wrapper">
          <CocktailRecipeCard
            recipe={result.cocktail_recipe}
            counts={{ active: 0, pendingQC: 0, expired: 0, total: 0 }}
            expanded={true}
          >
            {/* Components table */}
            {result.cocktail_recipe.components.length > 0 && (
              <div style={{ marginBottom: "0.75rem" }}>
                <strong style={{ fontSize: "0.9rem" }}>Components</strong>
                <div className="table-scroll" style={{ marginTop: "0.5rem" }}>
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: "2rem" }}>#</th>
                        <th>Antibody</th>
                        <th style={{ textAlign: "right" }}>Volume (uL)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.cocktail_recipe.components
                        .sort((a, b) => a.ordinal - b.ordinal)
                        .map((comp) => (
                          <tr key={comp.id}>
                            <td>{comp.ordinal}</td>
                            <td>
                              {comp.antibody_target || comp.antibody_fluorochrome
                                ? [comp.antibody_target, comp.antibody_fluorochrome].filter(Boolean).join(" - ")
                                : comp.free_text_name
                                  ? <em>{comp.free_text_name}</em>
                                  : "\u2014"}
                            </td>
                            <td style={{ textAlign: "right" }}>
                              {comp.volume_ul != null ? comp.volume_ul : "\u2014"}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <p className="info">
              No active lots for this recipe. Prepare a new lot from the Cocktails page.
            </p>
          </CocktailRecipeCard>
        </div>
      )}

      {/* ── Cocktail Scan Result ──────────────────────────────────── */}
      {mode === "scan" && result?.is_cocktail && result.cocktail_lot && (() => {
        const cl = result.cocktail_lot;
        const clExpired = cl.status !== "depleted" && !cl.is_archived &&
          new Date(cl.expiration_date + "T00:00:00") < new Date(new Date().toDateString());
        return (
        <div className="scan-result-wrapper">
          <CocktailLotCard
            lot={cl}
            recipe={result.cocktail_recipe}
            isExpired={clExpired}
          >
            {/* Storage location */}
            {cl.storage_unit_name && (
              <p style={{ fontSize: "0.85rem", marginBottom: "0.5rem" }}>
                Stored: <strong>{cl.storage_unit_name}</strong>
                {cl.storage_cell_label && <> / <strong>{cl.storage_cell_label}</strong></>}
              </p>
            )}

            {/* Prepared by */}
            {cl.created_by_name && (
              <p style={{ color: "var(--text-muted)", fontSize: "0.85em", marginBottom: "0.5rem" }}>
                Prepared by: {cl.created_by_name}
              </p>
            )}

            {/* Recipe details (collapsible) */}
            {result.cocktail_recipe && result.cocktail_recipe.components.length > 0 && (
              <details style={{ marginBottom: "0.75rem" }}>
                <summary style={{ cursor: "pointer", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                  Recipe Details ({result.cocktail_recipe.components.length} components)
                </summary>
                <div className="table-scroll" style={{ marginTop: "0.5rem" }}>
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: "2rem" }}>#</th>
                        <th>Component</th>
                        <th style={{ textAlign: "right" }}>Volume (uL)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.cocktail_recipe.components
                        .sort((a, b) => a.ordinal - b.ordinal)
                        .map((comp) => (
                          <tr key={comp.id}>
                            <td>{comp.ordinal}</td>
                            <td>
                              {comp.antibody_target || comp.antibody_fluorochrome
                                ? [comp.antibody_target, comp.antibody_fluorochrome].filter(Boolean).join(" - ")
                                : comp.free_text_name
                                  ? <em>{comp.free_text_name}</em>
                                  : "\u2014"}
                            </td>
                            <td style={{ textAlign: "right" }}>
                              {comp.volume_ul != null ? comp.volume_ul : "\u2014"}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}

            {/* Source traceability (collapsible) */}
            {cl.sources && cl.sources.length > 0 && (
              <details style={{ marginBottom: "0.75rem" }}>
                <summary style={{ cursor: "pointer", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                  Source Lots ({cl.sources.length})
                </summary>
                <div className="table-scroll" style={{ marginTop: "0.5rem" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Antibody</th>
                        <th>Source Lot</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cl.sources.map((s) => (
                        <tr key={s.id || s.component_id}>
                          <td>{[s.antibody_target, s.antibody_fluorochrome].filter(Boolean).join(" - ") || "Unknown"}</td>
                          <td>
                            {s.source_lot_number ? (
                              <button
                                className="btn-link"
                                style={{ fontSize: "inherit", padding: 0 }}
                                onClick={() => { setInput(s.source_lot_number!); handleLookup(s.source_lot_number!); }}
                              >
                                {s.source_lot_number}
                              </button>
                            ) : "\u2014"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}

            {/* FEFO warning: older cocktail lots */}
            {result.older_cocktail_lots && result.older_cocktail_lots.length > 0 && (
              <div style={{ marginBottom: "0.75rem", padding: "0.5rem 0.75rem", border: "1px solid var(--warning-border, #f0c040)", borderRadius: "var(--radius-sm)", background: "var(--warning-bg, #fffde7)" }}>
                <strong style={{ fontSize: "0.85rem" }}>Use First (FEFO)</strong>
                <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "0.25rem" }}>
                  Other active lots expire later than this one.
                </p>
                <div className="table-scroll" style={{ marginTop: "0.5rem" }}>
                  <table style={{ fontSize: "0.8rem" }}>
                    <thead>
                      <tr>
                        <th>Lot #</th>
                        <th>Expires</th>
                        <th>QC</th>
                        <th>Renewals</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.older_cocktail_lots.map((ol) => (
                        <tr
                          key={ol.id}
                          style={{ cursor: "pointer" }}
                          onClick={() => { setInput(ol.lot_number); handleLookup(ol.lot_number); }}
                        >
                          <td><button className="btn-link" style={{ fontSize: "inherit", padding: 0 }}>{ol.lot_number}</button></td>
                          <td>{new Date(ol.expiration_date + "T00:00:00").toLocaleDateString()}</td>
                          <td>
                            <span className={`badge ${ol.qc_status === "approved" ? "badge-green" : ol.qc_status === "failed" ? "badge-red" : "badge-yellow"}`}>
                              {ol.qc_status}
                            </span>
                          </td>
                          <td>{ol.renewal_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Deplete button for active cocktail lots */}
            {canReceive && cl.status === "active" && (
              <div className="action-btns">
                <button
                  className="btn-red"
                  onClick={async () => {
                    try {
                      await api.post(`/cocktails/lots/${cl.id}/deplete`);
                      addToast("Cocktail lot depleted", "success");
                      handleLookup(input);
                    } catch (err: any) {
                      setError(err.response?.data?.detail || "Failed to deplete cocktail lot");
                    }
                  }}
                  disabled={loading}
                >
                  Mark as Depleted
                </button>
              </div>
            )}
          </CocktailLotCard>
        </div>
        );
      })()}

      {/* ── Scan Result ────────────────────────────────────────────── */}
      {mode === "scan" && result && !result.is_cocktail && result.antibody && result.lot && (
        <div className={`scan-result-wrapper${scanMoveMode ? " move-active" : ""}`}>
          <div className="scan-info">
            <h2>
              {(() => {
                const scanColor = result.antibody.fluorochrome
                  ? fluoroMap.get(result.antibody.fluorochrome.toLowerCase())
                  : result.antibody.color;
                return scanColor ? <div className="color-dot" style={{ backgroundColor: scanColor }} /> : null;
              })()}
              {result.antibody.name || [result.antibody.target, result.antibody.fluorochrome].filter(Boolean).join(" - ") || "Unnamed"}
              <span className={`badge badge-designation-${result.antibody.designation}`} style={{ fontSize: "0.5em", marginLeft: 8, verticalAlign: "middle" }}>
                {result.antibody.designation.toUpperCase()}
              </span>
            </h2>
            {result.antibody.name && result.antibody.target && result.antibody.fluorochrome && (
              <p style={{ margin: "0 0 0.25rem", color: "var(--text-muted)", fontSize: "0.85em" }}>
                {result.antibody.target} - {result.antibody.fluorochrome}
              </p>
            )}
            <p>Lot: <strong>{result.lot.lot_number}</strong>{result.is_current_lot && <span className="badge badge-green" style={{ marginLeft: 6, fontSize: "0.7em" }}>Current</span>}{(result.older_lots?.length ?? 0) > 0 && <span className="badge" style={{ marginLeft: 6, fontSize: "0.7em", background: "#6b7280", color: "#fff" }}>New</span>} | QC: <span className={`badge ${result.lot.qc_status === "approved" ? "badge-green" : result.lot.qc_status === "failed" ? "badge-red" : "badge-yellow"}`}>{result.lot.qc_status}</span></p>
            <p>
              Sealed: <strong>{result.vials.length}</strong>
              {!sealedOnly && (
                <>
                  {" "}| Opened: <strong>{result.opened_vials?.length ?? 0}</strong>
                </>
              )}
            </p>
            {result.qc_warning && (
              <div className="qc-warning">
                {result.qc_warning}
                {canEdit && (
                  <button
                    className="approve-chip"
                    style={{ marginLeft: 8 }}
                    onClick={async () => {
                      try {
                        await api.patch(`/lots/${result.lot!.id}/qc`, { qc_status: "approved" });
                        handleLookup(input);
                        addToast("QC approved", "success");
                      } catch (err: any) {
                        setError(err.response?.data?.detail || "Failed to approve QC");
                      }
                    }}
                  >
                    Approve
                  </button>
                )}
              </div>
            )}
            {result.qc_warning && !canEdit && <p className="qc-info-note">You can still open vials — you'll be asked to confirm the QC override.</p>}
          </div>

          {/* Intent Menu */}
          <div className="intent-menu">
            <button className={`intent-btn ${intent === "receive" ? "active" : ""}`} onClick={() => { resetScanState(); setIntent("receive"); setReceiveQty(1); const defaultUnit = result.storage_grids?.[0]?.unit.id ?? ""; setReceiveStorageId(defaultUnit); setStorageUnits(sharedStorageUnits); if (defaultUnit) checkAvailableSlots(defaultUnit); }}>Receive More</button>
            {!sealedOnly && storageEnabled && <button className={`intent-btn ${intent === "store_open" ? "active" : ""}`} onClick={() => { resetScanState(); setIntent("store_open"); setStoreOpenUnitId(""); setStoreOpenGrid(null); setStorageUnits(sharedStorageUnits); }} disabled={!canStoreOpen} title={!canStoreOpen ? "No unstored opened vials" : ""}>Store Open Vial</button>}
            {!sealedOnly && <button className={`intent-btn ${intent === "deplete" ? "active" : ""}`} onClick={() => { resetScanState(); setIntent("deplete"); }} disabled={!canDeplete} title={!canDeplete ? "No opened vials" : ""}>Deplete</button>}
          </div>

          {/* Intent: Receive More */}
          {intent === "receive" && (() => {
            const needsOverflow = storageEnabled && receiveAvailableSlots !== null && !receiveIsTemp && receiveStorageId && receiveQty > receiveAvailableSlots;
            return (
            <div className="intent-panel">
              <form className="receive-form" onSubmit={handleReceive}>
                <p className="page-desc">Receive additional vials for lot <strong>{result.lot.lot_number}</strong>.</p>
                <div className="form-row">
                  <div className="form-group">
                    <label>Quantity</label>
                    <input type="number" min={1} max={100} value={receiveQty} onChange={(e) => setReceiveQty(parseInt(e.target.value) || 1)} required />
                  </div>
                  {storageEnabled && (
                    <div className="form-group">
                      <label>Store in</label>
                      <select value={receiveStorageId} onChange={(e) => { setReceiveStorageId(e.target.value); setOverflowMode(null); setOverflowSecondUnitId(""); checkAvailableSlots(e.target.value); }}>
                        <option value="">No storage assignment</option>
                        {storageUnits.map((u) => (
                          <option key={u.id} value={u.id}>{u.name} ({u.rows}x{u.cols}) {u.temperature || ""}</option>
                        ))}
                      </select>
                      {receiveAvailableSlots !== null && !receiveIsTemp && receiveStorageId && (
                        <span style={{ fontSize: "0.8em", color: "var(--text-muted)", marginTop: 2 }}>{receiveAvailableSlots} slot{receiveAvailableSlots !== 1 ? "s" : ""} available</span>
                      )}
                    </div>
                  )}
                </div>

                {needsOverflow && (
                  <div className="overflow-warning">
                    <p className="overflow-message">
                      <strong>Not enough space:</strong> {receiveAvailableSlots} slot{receiveAvailableSlots !== 1 ? "s" : ""} available, but receiving {receiveQty} vial{receiveQty !== 1 ? "s" : ""}.
                    </p>
                    <div className="overflow-options">
                      <button type="button" className={`overflow-option${overflowMode === "split" ? " active" : ""}`} onClick={() => setOverflowMode("split")}>
                        Split: {receiveAvailableSlots} here, {receiveQty - receiveAvailableSlots} elsewhere
                      </button>
                      <button type="button" className={`overflow-option${overflowMode === "temp" ? " active" : ""}`} onClick={() => setOverflowMode("temp")}>
                        Receive all to Temp Storage
                      </button>
                    </div>

                    {overflowMode === "split" && (
                      <div className="overflow-split-config">
                        <p>{receiveAvailableSlots} vial{receiveAvailableSlots !== 1 ? "s" : ""} go to the selected container. Remaining {receiveQty - receiveAvailableSlots} go to:</p>
                        <select value={overflowSecondUnitId} onChange={(e) => setOverflowSecondUnitId(e.target.value)}>
                          <option value="">Select second container</option>
                          {storageUnits.filter((u) => u.id !== receiveStorageId).map((u) => (
                            <option key={u.id} value={u.id}>{u.name} ({u.rows}x{u.cols}) {u.temperature || ""}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}

                <button type="submit" disabled={loading || (needsOverflow && !overflowMode) || (!!needsOverflow && overflowMode === "split" && !overflowSecondUnitId)}>
                  {loading ? "Receiving..." : "Receive Vials"}
                </button>
              </form>
            </div>
            );
          })()}

          {/* Intent: Deplete */}
          {intent === "deplete" && (
            <div className="intent-panel">
              <p className="page-desc">Select opened vial(s) to mark as depleted.</p>
              <div className="action-btns" style={{ marginBottom: "0.75rem", flexWrap: "wrap" }}>
                {depleteSelectedVialIds.size > 0 && !showBulkDepleteConfirm && (
                  <button className="btn-red" onClick={() => setShowBulkDepleteConfirm(true)} disabled={loading}>
                    Deplete Selected ({depleteSelectedVialIds.size})
                  </button>
                )}
                {result.opened_vials.length > 1 && !showDepleteAllConfirm && (
                  <button className="btn-red" onClick={() => setShowDepleteAllConfirm(true)} disabled={loading}>
                    Deplete All ({result.opened_vials.length})
                  </button>
                )}
                {canEdit && !showDepleteLotConfirm && (
                  <button className="btn-red" onClick={() => setShowDepleteLotConfirm(true)} disabled={loading}>
                    Deplete Entire Lot ({result.vials.length + result.opened_vials.length})
                  </button>
                )}
              </div>
              {showBulkDepleteConfirm && (
                <div className="confirm-action">
                  <p>Deplete <strong>{depleteSelectedVialIds.size}</strong> selected vial{depleteSelectedVialIds.size !== 1 ? "s" : ""} for lot <strong>{result.lot.lot_number}</strong>?</p>
                  <div className="action-btns">
                    <button className="btn-red" onClick={confirmBulkDeplete} disabled={loading}>{loading ? "Depleting..." : "Yes, Deplete Selected"}</button>
                    <button className="btn-secondary" onClick={() => setShowBulkDepleteConfirm(false)}>Cancel</button>
                  </div>
                </div>
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
                  const isChecked = depleteSelectedVialIds.has(v.id);
                  return (
                    <div key={v.id} className={`vial-select-item ${isChecked ? "selected" : ""}`} onClick={() => {
                      setDepleteSelectedVialIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(v.id)) next.delete(v.id);
                        else next.add(v.id);
                        return next;
                      });
                    }}>
                      <input type="checkbox" checked={isChecked} readOnly style={{ marginRight: 8 }} />
                      <span className="vial-id">{v.id.slice(0, 8)}</span>
                      <span className="vial-detail">Opened {v.opened_at ? new Date(v.opened_at).toLocaleDateString() : "—"}</span>
                      {v.open_expiration && <span className={`vial-expiration ${isExpired ? "expired" : ""}`}>{isExpired ? "Expired" : `Exp: ${v.open_expiration}`}</span>}
                    </div>
                  );
                })}
              </div>
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
                    <StorageView
                      grids={[storeOpenGrid]}
                      fluorochromes={fluorochromes}
                      onCellSelect={handleCellClick}
                      selectedCellId={selectedCell?.id}
                    />
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

          {/* Always-visible storage grid(s) with move support */}
          {storageEnabled && result.storage_grids && result.storage_grids.length > 0 && (
            <div className="scan-storage-section">
              <StorageView
                grids={result.storage_grids}
                fluorochromes={fluorochromes}
                lotFilter={{ lotId: result.lot.id, lotNumber: result.lot.lot_number }}
                onRefresh={refreshScan}
                onMoveChange={(moving) => setScanMoveMode(moving)}
              />
            </div>
          )}
        </div>
      )}

      {/* ── Search Results ─────────────────────────────────────────── */}
      {mode === "search" && (
        <>
          {searchResults.length > 0 && (() => {
            const filteredResults = designationFilter
              ? searchResults.filter((r) => r.antibody.designation === designationFilter)
              : searchResults;

            /** Compute counts respecting showInactive toggle. */
            const getResultCounts = (r: AntibodySearchResult) => {
              const isInactive = (l: typeof r.lots[0]) => l.is_archived || (l.vial_counts.sealed + l.vial_counts.opened === 0);
              const activeLots = showInactive ? r.lots : r.lots.filter((l) => !isInactive(l));
              const counts = showInactive
                ? r.total_vial_counts
                : {
                    sealed: activeLots.reduce((s, l) => s + l.vial_counts.sealed, 0),
                    opened: activeLots.reduce((s, l) => s + l.vial_counts.opened, 0),
                    depleted: activeLots.reduce((s, l) => s + l.vial_counts.depleted, 0),
                    total: activeLots.reduce((s, l) => s + l.vial_counts.total, 0),
                  };
              return { ...counts, lots: activeLots.length };
            };

            /** Resolve fluorochrome/IVD color for card display. */
            const getColor = (r: AntibodySearchResult) => {
              if (r.antibody.fluorochrome) return fluoroMap.get(r.antibody.fluorochrome.toLowerCase());
              return r.antibody.color || undefined;
            };

            return (
            <>
              {/* Filter bar: designation dropdown + inactive toggle + view toggle */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <select
                  value={designationFilter}
                  onChange={(e) => setDesignationFilter(e.target.value)}
                >
                  <option value="">All Designations</option>
                  <option value="ruo">RUO</option>
                  <option value="asr">ASR</option>
                  <option value="ivd">IVD</option>
                </select>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.85em", color: "#78716c", cursor: "pointer" }}>
                  <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
                  Show inactive
                </label>
                <ViewToggle view={searchView} onChange={setSearchView} />
              </div>

              {/* Card view */}
              {searchView === "card" && (
                <div className="inventory-grid stagger-reveal">
                  {filteredResults.map((r) => (
                    <AntibodyCard
                      key={r.antibody.id}
                      antibody={r.antibody}
                      counts={getResultCounts(r)}
                      fluoroColor={getColor(r)}
                      sealedOnly={sealedOnly}
                      selected={selectedSearchResult?.antibody.id === r.antibody.id}
                      onClick={() => handleSearchSelect(r)}
                    />
                  ))}
                </div>
              )}

              {/* List/table view */}
              {searchView === "list" && (
                <table className="search-results-table">
                  <thead>
                    <tr>
                      <th>Target</th>
                      <th>Fluorochrome</th>
                      <th>Designation</th>
                      <th>Clone</th>
                      <th>Vendor</th>
                      <th>Catalog #</th>
                      <th>Sealed</th>
                      <th>Opened</th>
                      {showInactive && <th>Depleted</th>}
                      <th>Lots</th>
                      {storageEnabled && <th>Locations</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredResults.map((r) => {
                      const counts = getResultCounts(r);
                      return (
                        <tr key={r.antibody.id} className={`clickable-row ${selectedSearchResult?.antibody.id === r.antibody.id ? "active" : ""}`} onClick={() => handleSearchSelect(r)}>
                          <td>{r.antibody.name || r.antibody.target || "\u2014"}</td>
                          <td>{r.antibody.fluorochrome || "\u2014"}</td>
                          <td><span className={`badge badge-designation-${r.antibody.designation}`}>{r.antibody.designation.toUpperCase()}</span></td>
                          <td>{r.antibody.clone || "\u2014"}</td>
                          <td>{r.antibody.vendor || "\u2014"}</td>
                          <td>{r.antibody.catalog_number ? <>{r.antibody.catalog_number} <CopyButton value={r.antibody.catalog_number} /></> : "\u2014"}</td>
                          <td>{counts.sealed}</td>
                          <td>{counts.opened}</td>
                          {showInactive && <td>{counts.depleted}</td>}
                          <td>{counts.lots}</td>
                          {storageEnabled && <td>{r.storage_locations.length > 0 ? r.storage_locations.map((l) => l.unit_name).join(", ") : "\u2014"}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </>
            );
          })()}

          {selectedSearchResult && (() => {
            const allLots = selectedSearchResult.lots;
            const isLotInactiveDetail = (l: typeof allLots[0]) => l.is_archived || (l.vial_counts.sealed + l.vial_counts.opened === 0);
            const visibleLots = showInactive ? allLots : allLots.filter((l) => !isLotInactiveDetail(l));
            // Age badges: oldest non-archived lot with sealed vials = "current", others = "new"
            const eligible = visibleLots
              .filter((l) => !l.is_archived && l.vial_counts.sealed > 0)
              .sort((a, b) => {
                if (!a.expiration_date && !b.expiration_date) return 0;
                if (!a.expiration_date) return 1;
                if (!b.expiration_date) return -1;
                return new Date(a.expiration_date).getTime() - new Date(b.expiration_date).getTime();
              });
            const ageBadgeMap = new Map<string, "current" | "new">();
            if (eligible.length >= 2) {
              for (const lot of eligible) {
                ageBadgeMap.set(lot.id, lot === eligible[0] ? "current" : "new");
              }
            }

            // Compute highlighted vial IDs for grids
            const searchHighlightIds = new Set<string>();
            if (selectedLotId) {
              // Highlight only the selected lot's vials
              for (const [, grid] of searchGrids) {
                for (const cell of grid.cells) {
                  if (cell.vial_id && cell.vial?.lot_id === selectedLotId) {
                    searchHighlightIds.add(cell.vial_id);
                  }
                }
              }
            } else {
              // Highlight all vials for this antibody (default)
              for (const loc of selectedSearchResult.storage_locations) {
                for (const vid of loc.vial_ids) searchHighlightIds.add(vid);
              }
            }

            return (
              <div className="locator-panel">
                <h2>
                  {selectedSearchResult.antibody.name || [selectedSearchResult.antibody.target, selectedSearchResult.antibody.fluorochrome].filter(Boolean).join(" - ") || "Unnamed"}
                  <span className={`badge badge-designation-${selectedSearchResult.antibody.designation}`} style={{ fontSize: "0.5em", marginLeft: 8, verticalAlign: "middle" }}>
                    {selectedSearchResult.antibody.designation.toUpperCase()}
                  </span>
                </h2>
                {selectedSearchResult.antibody.name && selectedSearchResult.antibody.target && selectedSearchResult.antibody.fluorochrome && (
                  <p style={{ margin: "0 0 0.5rem", color: "var(--text-muted)", fontSize: "0.85em" }}>
                    {selectedSearchResult.antibody.target} - {selectedSearchResult.antibody.fluorochrome}
                  </p>
                )}
                {visibleLots.length > 0 && (() => {
                  const convertedLots = visibleLots.map((l) => lotSummaryToLot(l, selectedSearchResult.antibody.id));
                  const ListComp = isMobile ? LotCardList : LotTable;
                  return (
                    <ListComp
                      lots={convertedLots}
                      sealedOnly={sealedOnly}
                      canQC={false}
                      lotAgeBadgeMap={ageBadgeMap}
                      storageEnabled={storageEnabled}
                      onLotClick={(lot) => setSelectedLotId(selectedLotId === lot.id ? null : lot.id)}
                      selectedLotId={selectedLotId}
                      extraActions={(lot) =>
                        lot.vendor_barcode ? (
                          <button
                            className="btn-sm btn-secondary"
                            onClick={(e) => { e.stopPropagation(); setInput(lot.vendor_barcode!); handleLookup(lot.vendor_barcode!); }}
                          >
                            Search Lot
                          </button>
                        ) : null
                      }
                    />
                  );
                })()}
                {/* Lot drilldown: per-lot storage grids (shown when a lot is clicked) */}
                {storageEnabled && selectedLotId && (() => {
                  const ddLot = visibleLots.find((l) => l.id === selectedLotId);
                  if (!ddLot) return null;
                  return (
                    <StorageView
                      grids={Array.from(searchGrids.values())}
                      fluorochromes={fluorochromes}
                      lotFilter={{ lotId: ddLot.id, lotNumber: ddLot.lot_number }}
                      onRefresh={() => {
                        const sr = selectedSearchResultRef.current;
                        if (sr) return handleSearchSelect(sr);
                      }}
                      className="lot-drilldown-panel"
                    />
                  );
                })()}

                {/* Antibody-level storage grids (shown when no lot is drilled down) */}
                {storageEnabled && !selectedLotId && (
                  selectedSearchResult.storage_locations.length === 0 ? (
                    <p className="empty">No vials currently in storage for this antibody.</p>
                  ) : (() => {
                    const gridsArray = selectedSearchResult.storage_locations
                      .map((loc) => searchGrids.get(loc.unit_id))
                      .filter((g): g is StorageGridType => !!g);
                    return gridsArray.length > 0 ? (
                      <StorageView
                        grids={gridsArray}
                        fluorochromes={fluorochromes}
                        highlightVialIds={searchHighlightIds}
                        onRefresh={() => {
                          const sr = selectedSearchResultRef.current;
                          if (sr) return handleSearchSelect(sr);
                        }}
                        legendExtra={
                          <span className="legend-item"><span className="legend-box highlighted-legend" /> Current antibody</span>
                        }
                      />
                    ) : null;
                  })()
                )}
              </div>
            );
          })()}
        </>
      )}

    </div>
  );
}
