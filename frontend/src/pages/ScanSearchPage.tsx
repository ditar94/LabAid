import { useState, useRef, useEffect, useMemo, useCallback, type FormEvent } from "react";
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
  VialMoveResult,
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
  const [olderLotDismissed, setOlderLotDismissed] = useState(false);
  const [olderLotSkipNote, setOlderLotSkipNote] = useState("");
  const [receiveQty, setReceiveQty] = useState(1);
  const [receiveStorageId, setReceiveStorageId] = useState("");
  const [receiveAvailableSlots, setReceiveAvailableSlots] = useState<number | null>(null);
  const [receiveIsTemp, setReceiveIsTemp] = useState(false);
  const [overflowMode, setOverflowMode] = useState<"split" | "switch" | "temp" | null>(null);
  const [overflowSecondUnitId, setOverflowSecondUnitId] = useState("");
  const [storeOpenUnitId, setStoreOpenUnitId] = useState("");
  const [storeOpenGrid, setStoreOpenGrid] = useState<StorageGridType | null>(null);
  const [viewStorageGrid, setViewStorageGrid] = useState<StorageGridType | null>(null);
  const [viewStorageTarget, setViewStorageTarget] = useState<StorageCell | null>(null);
  const [viewStorageLoading, setViewStorageLoading] = useState(false);

  // ── Move vials state ────────────────────────────────────────────────
  const [moveSelectedVialIds, setMoveSelectedVialIds] = useState<Set<string>>(new Set());
  const [moveTargetUnitId, setMoveTargetUnitId] = useState<string>("");
  const [moveGrids, setMoveGrids] = useState<Map<string, StorageGridType>>(new Map());
  const [moveTargetGrid, setMoveTargetGrid] = useState<StorageGridType | null>(null);
  const [moveDestMode, setMoveDestMode] = useState<"auto" | "start" | "pick">("auto");
  const [moveDestStartCellId, setMoveDestStartCellId] = useState<string | null>(null);
  const [moveDestPickedCellIds, setMoveDestPickedCellIds] = useState<Set<string>>(new Set());

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
  const [showInactive, setShowInactive] = useState(false);
  const [selectedLotId, setSelectedLotId] = useState<string | null>(null);

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
    setViewStorageGrid(null);
    setViewStorageTarget(null);
    setMoveSelectedVialIds(new Set());
    setMoveTargetUnitId("");
    setMoveGrids(new Map());
    setMoveTargetGrid(null);
    setMoveDestMode("auto");
    setMoveDestStartCellId(null);
    setMoveDestPickedCellIds(new Set());
    setOlderLotDismissed(false);
    setOlderLotSkipNote("");
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
    setOpenTarget(null);
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
      const params = new URLSearchParams({ force: String(!!result.qc_warning) });
      if (olderLotDismissed && olderLotSkipNote) params.set("skip_older_lot_note", olderLotSkipNote);
      await api.post(`/vials/${vial.id}/open?${params}`, { cell_id: selectedCell.id });
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
      const needsOverflow = receiveAvailableSlots !== null && !receiveIsTemp && receiveStorageId && receiveQty > receiveAvailableSlots;

      if (needsOverflow && overflowMode === "split" && overflowSecondUnitId) {
        const firstQty = receiveAvailableSlots;
        const secondQty = receiveQty - receiveAvailableSlots;
        await api.post("/vials/receive", {
          lot_id: result.lot.id,
          quantity: firstQty,
          storage_unit_id: receiveStorageId,
        });
        await api.post("/vials/receive", {
          lot_id: result.lot.id,
          quantity: secondQty,
          storage_unit_id: overflowSecondUnitId,
        });
        setMessage(`${receiveQty} vial(s) received: ${firstQty} + ${secondQty} split across containers.`);
      } else if (needsOverflow && overflowMode === "temp") {
        await api.post("/vials/receive", {
          lot_id: result.lot.id,
          quantity: receiveQty,
          storage_unit_id: null,
        });
        setMessage(`${receiveQty} vial(s) received into temporary storage.`);
      } else {
        await api.post("/vials/receive", {
          lot_id: result.lot.id,
          quantity: receiveQty,
          storage_unit_id: receiveStorageId || null,
        });
        setMessage(`${receiveQty} vial(s) received for lot ${result.lot.lot_number}.`);
      }

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

  // ── Scan: View Storage ─────────────────────────────────────────────
  const loadViewStorageGrid = async () => {
    if (!result?.storage_grids?.length) return;
    try {
      const res = await api.get(`/storage/units/${result.storage_grids[0].unit.id}/grid`);
      setViewStorageGrid(res.data);
    } catch {
      setViewStorageGrid(null);
    }
  };

  const handleViewStorageCellClick = (cell: StorageCell) => {
    if (!cell.vial || (cell.vial.status !== "sealed" && cell.vial.status !== "opened")) return;
    setViewStorageTarget(cell);
  };

  const handleViewStorageOpen = async (force: boolean) => {
    if (!viewStorageTarget?.vial) return;
    setViewStorageLoading(true);
    try {
      await api.post(`/vials/${viewStorageTarget.vial.id}/open?force=${force}`, { cell_id: viewStorageTarget.id });
      setMessage(`Vial opened from cell ${viewStorageTarget.label}. Status updated.`);
      setViewStorageTarget(null);
      await refreshScan();
      await loadViewStorageGrid();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to open vial");
      setViewStorageTarget(null);
    } finally {
      setViewStorageLoading(false);
    }
  };

  const handleViewStorageDeplete = async () => {
    if (!viewStorageTarget?.vial) return;
    setViewStorageLoading(true);
    try {
      await api.post(`/vials/${viewStorageTarget.vial.id}/deplete`);
      setMessage(`Vial depleted from cell ${viewStorageTarget.label}. Status updated.`);
      setViewStorageTarget(null);
      await refreshScan();
      await loadViewStorageGrid();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to deplete vial");
      setViewStorageTarget(null);
    } finally {
      setViewStorageLoading(false);
    }
  };

  // ── Scan: Move Vials ──────────────────────────────────────────────
  const loadMoveGrids = async () => {
    if (!result?.storage_grids?.length) return;
    const grids = new Map<string, StorageGridType>();
    await Promise.all(
      result.storage_grids.map(async (sg) => {
        try {
          const res = await api.get(`/storage/units/${sg.unit.id}/grid`);
          grids.set(sg.unit.id, res.data);
        } catch { /* skip */ }
      })
    );
    setMoveGrids(grids);
  };

  const handleMoveCellClick = (cell: StorageCell) => {
    if (!cell.vial || (cell.vial.status !== "sealed" && cell.vial.status !== "opened")) return;
    const vialId = cell.vial.id;
    setMoveSelectedVialIds((prev) => {
      const next = new Set(prev);
      if (next.has(vialId)) next.delete(vialId);
      else next.add(vialId);
      return next;
    });
  };

  const handleSelectAllLotVials = () => {
    if (!result) return;
    const allVialIds = new Set<string>();
    const lotVialIds = new Set([
      ...result.vials.map((v) => v.id),
      ...(result.opened_vials?.map((v) => v.id) ?? []),
    ]);
    for (const [, grid] of moveGrids) {
      for (const cell of grid.cells) {
        if (cell.vial_id && lotVialIds.has(cell.vial_id)) {
          allVialIds.add(cell.vial_id);
        }
      }
    }
    setMoveSelectedVialIds(allVialIds);
  };

  const handleMoveTargetChange = async (unitId: string) => {
    setMoveTargetUnitId(unitId);
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
    if (moveDestMode !== "start" || !moveTargetGrid || !moveDestStartCellId || moveSelectedVialIds.size === 0) return new Set<string>();
    const emptyCells = moveTargetGrid.cells
      .filter((c) => !c.vial_id)
      .sort((a, b) => a.row - b.row || a.col - b.col);
    const startIdx = emptyCells.findIndex((c) => c.id === moveDestStartCellId);
    if (startIdx < 0) return new Set<string>();
    const preview = emptyCells.slice(startIdx, startIdx + moveSelectedVialIds.size);
    return new Set(preview.map((c) => c.id));
  }, [moveTargetGrid, moveDestStartCellId, moveSelectedVialIds, moveDestMode]);

  const moveInsufficientCells = useMemo(() => {
    if (moveDestMode === "start") {
      if (!moveDestStartCellId || !moveTargetGrid) return false;
      return movePreviewCellIds.size < moveSelectedVialIds.size;
    }
    if (moveDestMode === "pick") {
      return moveDestPickedCellIds.size !== moveSelectedVialIds.size;
    }
    return false;
  }, [movePreviewCellIds, moveSelectedVialIds, moveDestStartCellId, moveTargetGrid, moveDestMode, moveDestPickedCellIds]);

  const handleMoveVials = async () => {
    if (moveSelectedVialIds.size === 0 || !moveTargetUnitId) return;
    setLoading(true);
    setError(null);
    try {
      const movePayload: Record<string, unknown> = {
        vial_ids: Array.from(moveSelectedVialIds),
        target_unit_id: moveTargetUnitId,
      };
      if (moveDestMode === "start" && moveDestStartCellId) {
        movePayload.start_cell_id = moveDestStartCellId;
      } else if (moveDestMode === "pick" && moveDestPickedCellIds.size > 0) {
        movePayload.target_cell_ids = Array.from(moveDestPickedCellIds);
      }
      const res = await api.post<VialMoveResult>("/vials/move", movePayload);
      setMessage(`Moved ${res.data.moved_count} vial(s) successfully.`);
      setMoveSelectedVialIds(new Set());
      setMoveTargetUnitId("");
      setMoveTargetGrid(null);
      setMoveDestMode("auto");
      setMoveDestStartCellId(null);
      setMoveDestPickedCellIds(new Set());
      await refreshScan();
      await loadMoveGrids();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to move vials");
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

  const handleSearchGridCellClick = (cell: StorageCell) => {
    if (!cell.vial || (cell.vial.status !== "sealed" && cell.vial.status !== "opened")) return;
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

  const handleDepleteVialFromSearch = async () => {
    if (!openTarget?.vial) return;
    setOpenLoading(true);
    try {
      await api.post(`/vials/${openTarget.vial.id}/deplete`);
      setMessage(`Vial depleted from cell ${openTarget.label}. Status updated.`);
      setOpenTarget(null);
      if (selectedSearchResult) await handleSearchSelect(selectedSearchResult);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to deplete vial");
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

  // ── Popout action callbacks ─────────────────────────────────────────

  const getOpenIntentPopoutActions = useCallback(
    (cell: StorageCell) => {
      if (!cell.vial) return [];
      return [
        { label: "Select", variant: "primary" as const, onClick: () => handleCellClick(cell) },
      ];
    },
    []
  );

  const getViewStoragePopoutActions = useCallback(
    (cell: StorageCell) => {
      if (!cell.vial) return [];
      const vial = cell.vial;
      const actions: Array<{ label: string; onClick: () => void; variant?: "primary" | "danger" | "default" }> = [];
      if (vial.status === "sealed") {
        actions.push({ label: "Open", variant: "primary", onClick: () => handleViewStorageCellClick(cell) });
      } else if (vial.status === "opened") {
        actions.push({ label: "Deplete", variant: "danger", onClick: () => handleViewStorageCellClick(cell) });
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

  const getSearchGridPopoutActions = useCallback(
    (cell: StorageCell) => {
      if (!cell.vial) return [];
      const vial = cell.vial;
      const actions: Array<{ label: string; onClick: () => void; variant?: "primary" | "danger" | "default" }> = [];
      if (vial.status === "sealed") {
        actions.push({ label: "Open", variant: "primary", onClick: () => handleSearchGridCellClick(cell) });
      } else if (vial.status === "opened") {
        actions.push({ label: "Deplete", variant: "danger", onClick: () => handleSearchGridCellClick(cell) });
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

  // ── Computed values (scan) ──────────────────────────────────────────
  const highlightCellVialIds = new Set<string>();
  if (result?.storage_grids?.length && (intent === "open" || intent === "view_storage")) {
    const gridCells = intent === "view_storage" && viewStorageGrid ? viewStorageGrid.cells : result.storage_grids[0].cells;
    for (const cell of gridCells) {
      if (cell.vial_id && result.vials.some((v) => v.id === cell.vial_id)) {
        highlightCellVialIds.add(cell.vial_id);
      }
    }
  }

  const recommendation = result?.vials
    .filter((v) => v.location_cell_id)
    .sort((a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime())[0];

  const recommendedCell = recommendation
    ? result?.storage_grids?.[0]?.cells.find((c) => c.id === recommendation.location_cell_id)
    : null;

  const canOpenScan = (result?.vials.length ?? 0) > 0;
  const canDeplete = (result?.opened_vials?.length ?? 0) > 0;
  const unstored_opened = result?.opened_vials?.filter((v) => !v.location_cell_id) ?? [];
  const canStoreOpen = unstored_opened.length > 0;
  const canMove = (result?.storage_grids?.length ?? 0) > 0;
  const hasOlderLots = (result?.older_lots?.length ?? 0) > 0;

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
            <button className={`intent-btn ${intent === "receive" ? "active" : ""}`} onClick={() => { resetScanState(); setIntent("receive"); setReceiveQty(1); const defaultUnit = result.storage_grids?.[0]?.unit.id ?? ""; setReceiveStorageId(defaultUnit); api.get("/storage/units").then((r) => setStorageUnits(r.data)); if (defaultUnit) checkAvailableSlots(defaultUnit); }}>Receive More</button>
            {!sealedOnly && <button className={`intent-btn ${intent === "store_open" ? "active" : ""}`} onClick={() => { resetScanState(); setIntent("store_open"); setStoreOpenUnitId(""); setStoreOpenGrid(null); api.get("/storage/units").then((r) => setStorageUnits(r.data)); }} disabled={!canStoreOpen} title={!canStoreOpen ? "No unstored opened vials" : ""}>Store Open Vial</button>}
            {!sealedOnly && <button className={`intent-btn ${intent === "deplete" ? "active" : ""}`} onClick={() => { resetScanState(); setIntent("deplete"); }} disabled={!canDeplete} title={!canDeplete ? "No opened vials" : ""}>Deplete</button>}
            {result.storage_grids?.length > 0 && <button className={`intent-btn ${intent === "view_storage" ? "active" : ""}`} onClick={() => { resetScanState(); setIntent("view_storage"); loadViewStorageGrid(); }}>View Storage</button>}
            {canMove && <button className={`intent-btn ${intent === "move" ? "active" : ""}`} onClick={() => { resetScanState(); setIntent("move"); loadMoveGrids(); api.get("/storage/units").then((r) => setStorageUnits(r.data)); }} disabled={!canMove} title={!canMove ? "No stored vials" : ""}>Move Vials</button>}
            <button className="intent-btn" onClick={() => navigate(`/inventory?antibodyId=${result.antibody.id}`)}>View Lot</button>
          </div>

          {/* Intent: Open New */}
          {intent === "open" && (
            <div className="intent-panel">
              {hasOlderLots && !olderLotDismissed && (() => {
                const oldest = result.older_lots![0];
                const others = result.older_lots!.length - 1;
                return (
                  <div className="older-lot-warning">
                    <p>
                      <strong>Older lot available:</strong> Lot <strong>{oldest.lot_number}</strong> has{" "}
                      {oldest.sealed_count} sealed vial{oldest.sealed_count !== 1 ? "s" : ""}{" "}
                      ({oldest.storage_summary}). Use the older lot first?
                    </p>
                    {others > 0 && (
                      <p style={{ fontSize: "0.85em", opacity: 0.8, marginTop: 4 }}>
                        +{others} more older lot{others !== 1 ? "s" : ""} with sealed vials
                      </p>
                    )}
                    <div className="older-lot-actions">
                      {oldest.vendor_barcode ? (
                        <button className="btn-green" onClick={() => handleLookup(oldest.vendor_barcode!)}>
                          Switch to Lot {oldest.lot_number}
                        </button>
                      ) : (
                        <span className="info" style={{ fontSize: "0.85em" }}>
                          Older lot has no barcode — look it up manually
                        </span>
                      )}
                      <button className="btn-secondary" onClick={() => setOlderLotDismissed(true)}>
                        Use This Lot Anyway
                      </button>
                    </div>
                  </div>
                );
              })()}
              {hasOlderLots && olderLotDismissed && !selectedCell && (
                <div className="older-lot-note">
                  <label style={{ fontSize: "0.85em" }}>
                    Reason for skipping older lot (optional):
                    <input
                      type="text"
                      value={olderLotSkipNote}
                      onChange={(e) => setOlderLotSkipNote(e.target.value)}
                      placeholder="e.g. Lot verification in progress"
                      style={{ marginLeft: 8, width: 260 }}
                    />
                  </label>
                </div>
              )}
              {(!hasOlderLots || olderLotDismissed) && (
                <>
                  {recommendedCell && (
                    <p className="recommendation">
                      Suggestion: oldest vial is at cell <strong>{recommendedCell.label}</strong> (received {new Date(recommendation!.received_at).toLocaleDateString()}). Click the cell you are actually pulling from.
                    </p>
                  )}
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
                  {result.storage_grids?.length > 0 && (
                    <div className="grid-container">
                      <h3>{result.storage_grids[0].unit.name}</h3>
                      <StorageGrid rows={result.storage_grids[0].unit.rows} cols={result.storage_grids[0].unit.cols} cells={result.storage_grids[0].cells} highlightVialIds={highlightCellVialIds} recommendedCellId={recommendedCell?.id} onCellClick={handleCellClick} selectedCellId={selectedCell?.id} clickMode="highlighted" fluorochromes={fluorochromes} popoutActions={getOpenIntentPopoutActions} />
                    </div>
                  )}
                  {(!result.storage_grids || result.storage_grids.length === 0) && result.vials.length > 0 && (
                    <p className="info">Vials found but not assigned to storage. Assign vials to a storage unit to use the grid selection.</p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Intent: Receive More */}
          {intent === "receive" && (() => {
            const needsOverflow = receiveAvailableSlots !== null && !receiveIsTemp && receiveStorageId && receiveQty > receiveAvailableSlots;
            return (
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

                <button type="submit" disabled={loading || (needsOverflow && !overflowMode) || (needsOverflow && overflowMode === "split" && !overflowSecondUnitId)}>
                  {loading ? "Receiving..." : "Receive Vials"}
                </button>
              </form>
            </div>
            );
          })()}

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
                      <StorageGrid rows={storeOpenGrid.unit.rows} cols={storeOpenGrid.unit.cols} cells={storeOpenGrid.cells} highlightVialIds={new Set()} onCellClick={handleCellClick} selectedCellId={selectedCell?.id} clickMode="empty" fluorochromes={fluorochromes} />
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
          {/* Intent: View Storage */}
          {intent === "view_storage" && viewStorageGrid && (
            <div className="intent-panel">
              <div className="grid-container">
                <h3>{viewStorageGrid.unit.name}{viewStorageGrid.unit.temperature ? ` (${viewStorageGrid.unit.temperature})` : ""}</h3>
                <StorageGrid rows={viewStorageGrid.unit.rows} cols={viewStorageGrid.unit.cols} cells={viewStorageGrid.cells} highlightVialIds={highlightCellVialIds} onCellClick={canOpen ? handleViewStorageCellClick : undefined} clickMode={canOpen ? "occupied" : "highlighted"} fluorochromes={fluorochromes} popoutActions={canOpen ? getViewStoragePopoutActions : undefined} />
                <div className="grid-legend">
                  <span className="legend-item"><span className="legend-box sealed" /> Sealed</span>
                  <span className="legend-item"><span className="legend-box opened" /> Opened</span>
                  <span className="legend-item"><span className="legend-box" /> Empty</span>
                  <span className="legend-item"><span className="legend-box highlighted-legend" /> Current lot</span>
                  {canOpen && <span className="legend-item">Tap a vial to see actions</span>}
                </div>
              </div>
              {viewStorageTarget && (
                <OpenVialDialog
                  cell={viewStorageTarget}
                  loading={viewStorageLoading}
                  onConfirm={handleViewStorageOpen}
                  onDeplete={handleViewStorageDeplete}
                  onViewLot={() => {
                    const abId = viewStorageTarget.vial?.antibody_id;
                    setViewStorageTarget(null);
                    if (abId) navigate(`/inventory?antibodyId=${abId}`);
                  }}
                  onCancel={() => setViewStorageTarget(null)}
                />
              )}
            </div>
          )}
          {/* Intent: Move Vials */}
          {intent === "move" && (
            <div className="intent-panel">
              <p className="page-desc">
                Click vials to select/deselect them for moving. Selected: <strong>{moveSelectedVialIds.size}</strong>
              </p>
              <div className="move-controls">
                <button onClick={handleSelectAllLotVials} disabled={moveGrids.size === 0}>Select All</button>
                <button onClick={() => setMoveSelectedVialIds(new Set())} disabled={moveSelectedVialIds.size === 0}>Clear</button>
                <select value={moveTargetUnitId} onChange={(e) => handleMoveTargetChange(e.target.value)}>
                  <option value="">Move to...</option>
                  {storageUnits.map((u) => (
                    <option key={u.id} value={u.id}>{u.name} {u.is_temporary ? "(Temp)" : ""}</option>
                  ))}
                </select>
                <button onClick={handleMoveVials} disabled={moveSelectedVialIds.size === 0 || !moveTargetUnitId || loading || moveInsufficientCells}>
                  {loading ? "Moving..." : `Move ${moveSelectedVialIds.size} Vial(s)`}
                </button>
              </div>
              {result?.storage_grids?.map((sg) => {
                const grid = moveGrids.get(sg.unit.id);
                if (!grid) return null;
                return (
                  <div key={sg.unit.id} className="grid-container">
                    <h3>{grid.unit.name}{grid.unit.temperature ? ` (${grid.unit.temperature})` : ""}</h3>
                    <StorageGrid
                      rows={grid.unit.rows}
                      cols={grid.unit.cols}
                      cells={grid.cells}
                      highlightVialIds={moveSelectedVialIds}
                      onCellClick={handleMoveCellClick}
                      clickMode="occupied"
                      fluorochromes={fluorochromes}
                      singleClickSelect={true}
                    />
                  </div>
                );
              })}
              {moveTargetGrid && (
                <div className="grid-container" style={{ marginTop: "1rem" }}>
                  <h4 style={{ margin: "0 0 0.25rem" }}>Destination: {moveTargetGrid.unit.name}</h4>
                  <p className="page-desc" style={{ margin: "0 0 0.5rem", fontSize: "0.85em" }}>
                    {moveDestMode === "auto" && "Click an empty cell to set a starting position, or leave for auto-placement."}
                    {moveDestMode === "start" && "Vials will fill from the selected cell. Click another cell to pick individual positions."}
                    {moveDestMode === "pick" && `Pick mode: ${moveDestPickedCellIds.size}/${moveSelectedVialIds.size} cells selected.`}
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
                        ? `Select exactly ${moveSelectedVialIds.size} cell(s) to match the number of vials.`
                        : "Not enough empty cells from the selected position."}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Search Results ─────────────────────────────────────────── */}
      {mode === "search" && (
        <>
          {searchResults.length > 0 && (
            <>
              <table className="search-results-table">
                <thead>
                  <tr>
                    <th>Target</th>
                    <th>Fluorochrome</th>
                    <th>Clone</th>
                    <th>Vendor</th>
                    <th>Catalog #</th>
                    <th>Sealed</th>
                    <th>Opened</th>
                    {showInactive && <th>Depleted</th>}
                    <th>Lots</th>
                    <th>Locations</th>
                  </tr>
                </thead>
                <tbody>
                  {searchResults.map((r) => {
                    const isLotInactive = (l: typeof r.lots[0]) => l.is_archived || (l.vial_counts.sealed + l.vial_counts.opened === 0);
                    const activeLots = showInactive ? r.lots : r.lots.filter((l) => !isLotInactive(l));
                    const counts = showInactive
                      ? r.total_vial_counts
                      : {
                          sealed: activeLots.reduce((s, l) => s + l.vial_counts.sealed, 0),
                          opened: activeLots.reduce((s, l) => s + l.vial_counts.opened, 0),
                          depleted: activeLots.reduce((s, l) => s + l.vial_counts.depleted, 0),
                          total: activeLots.reduce((s, l) => s + l.vial_counts.total, 0),
                        };
                    return (
                      <tr key={r.antibody.id} className={`clickable-row ${selectedSearchResult?.antibody.id === r.antibody.id ? "active" : ""}`} onClick={() => handleSearchSelect(r)}>
                        <td>{r.antibody.target}</td>
                        <td>{r.antibody.fluorochrome}</td>
                        <td>{r.antibody.clone || "—"}</td>
                        <td>{r.antibody.vendor || "—"}</td>
                        <td>{r.antibody.catalog_number || "—"}</td>
                        <td>{counts.sealed}</td>
                        <td>{counts.opened}</td>
                        {showInactive && <td>{counts.depleted}</td>}
                        <td>{activeLots.length}</td>
                        <td>{r.storage_locations.length > 0 ? r.storage_locations.map((l) => l.unit_name).join(", ") : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: "0.85em", color: "#78716c", cursor: "pointer" }}>
                <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
                Show inactive (archived &amp; depleted)
              </label>
            </>
          )}

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
                <h2>{selectedSearchResult.antibody.target} - {selectedSearchResult.antibody.fluorochrome}</h2>
                {visibleLots.length > 0 && (
                  <div className="lot-summaries">
                    {visibleLots.map((lot) => (
                      <div
                        key={lot.id}
                        className={`lot-summary-item clickable-row${selectedLotId === lot.id ? " active" : ""}`}
                        style={lot.is_archived ? { opacity: 0.5 } : undefined}
                        onClick={() => setSelectedLotId(selectedLotId === lot.id ? null : lot.id)}
                      >
                        <span className="lot-summary-number">Lot {lot.lot_number}</span>
                        {ageBadgeMap.get(lot.id) === "current" && (
                          <span className="badge badge-green" style={{ fontSize: "0.7em" }}>Current</span>
                        )}
                        {ageBadgeMap.get(lot.id) === "new" && (
                          <span className="badge" style={{ fontSize: "0.7em", background: "#6b7280", color: "#fff" }}>New</span>
                        )}
                        {lot.is_archived && (
                          <span className="badge" style={{ fontSize: "0.7em", background: "#9ca3af", color: "#fff" }}>Archived</span>
                        )}
                        {!lot.is_archived && lot.vial_counts.sealed + lot.vial_counts.opened === 0 && lot.vial_counts.depleted > 0 && (
                          <span className="badge" style={{ fontSize: "0.7em", background: "#9ca3af", color: "#fff" }}>Depleted</span>
                        )}
                        <span className={`badge ${lot.qc_status === "approved" ? "badge-green" : lot.qc_status === "failed" ? "badge-red" : "badge-yellow"}`}>{lot.qc_status}</span>
                        {lot.is_archived ? (
                          <span className="lot-summary-counts" style={{ fontStyle: "italic", color: "#9ca3af" }}>Archived</span>
                        ) : lot.vial_counts.sealed + lot.vial_counts.opened === 0 && lot.vial_counts.depleted > 0 ? (
                          <span className="lot-summary-counts" style={{ fontStyle: "italic", color: "#9ca3af" }}>All vials depleted</span>
                        ) : (
                          <>
                            <span className="lot-summary-counts">{lot.vial_counts.sealed} sealed, {lot.vial_counts.opened} opened</span>
                            {lot.expiration_date && <span className="lot-summary-exp">Exp: {lot.expiration_date}</span>}
                          </>
                        )}
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
                        <StorageGrid rows={grid.unit.rows} cols={grid.unit.cols} cells={grid.cells} highlightVialIds={searchHighlightIds} onCellClick={canOpen ? handleSearchGridCellClick : undefined} clickMode={canOpen ? "occupied" : "highlighted"} fluorochromes={fluorochromes} popoutActions={canOpen ? getSearchGridPopoutActions : undefined} />
                      </div>
                    );
                  })
                )}
              </div>
            );
          })()}
        </>
      )}

      {openTarget && (
        <OpenVialDialog
          cell={openTarget}
          loading={openLoading}
          onConfirm={handleOpenVialFromSearch}
          onDeplete={handleDepleteVialFromSearch}
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
