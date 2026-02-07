import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/client";
import type { Antibody, Designation, Fluorochrome, Lab, Lot, StorageUnit, StorageGrid as StorageGridData, StorageCell, VialCounts } from "../api/types";
import { useAuth } from "../context/AuthContext";
import { useSharedData } from "../context/SharedDataContext";
import BarcodeScannerButton from "../components/BarcodeScannerButton";
import DatePicker from "../components/DatePicker";
import { useMediaQuery } from "../hooks/useMediaQuery";
import LotTable from "../components/LotTable";
import LotCardList from "../components/LotCardList";
import StorageGrid from "../components/StorageGrid";
import OpenVialDialog from "../components/OpenVialDialog";

function DocumentModal({ lot, onClose, onUpload, onUploadAndApprove }: {
  lot: Lot;
  onClose: () => void;
  onUpload: () => void;
  onUploadAndApprove?: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState("");
  const [isQcDocument, setIsQcDocument] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async (docId: string, fileName: string) => {
    const res = await api.get(`/documents/${docId}`, { responseType: "blob" });
    const url = URL.createObjectURL(res.data);
    const newTab = window.open(url, "_blank", "noopener,noreferrer");
    if (!newTab) {
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.click();
    }
    // Delay revoke so the new tab has time to read the blob URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFile(e.target.files[0]);
    }
  };

  const doUpload = async () => {
    if (!file) return false;
    setError(null);
    const formData = new FormData();
    formData.append("file", file);
    if (description.trim()) formData.append("description", description.trim());
    if (isQcDocument) formData.append("is_qc_document", "true");
    try {
      await api.post(`/documents/lots/${lot.id}`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setFile(null);
      setDescription("");
      setIsQcDocument(false);
      return true;
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to upload file");
      return false;
    }
  };

  const handleUpload = async () => {
    if (await doUpload()) onUpload();
  };

  const handleUploadAndApprove = async () => {
    if (await doUpload()) onUploadAndApprove?.();
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={`Documents for Lot ${lot.lot_number}`}>
      <div className="modal-content">
        <h2>Documents for Lot {lot.lot_number}</h2>
        <div className="document-list">
          {lot.documents?.map((doc) => (
            <div key={doc.id} className="document-item">
              <a href="#" onClick={(e) => { e.preventDefault(); handleDownload(doc.id, doc.file_name); }}>
                {doc.file_name}
              </a>
              {doc.is_qc_document && <span className="badge badge-green qc-doc-badge">QC</span>}
              {doc.description && <span className="document-desc">{doc.description}</span>}
            </div>
          ))}
          {lot.documents?.length === 0 && <p>No documents uploaded.</p>}
        </div>
        <div className="upload-form">
          <h3>Upload New Document</h3>
          <input type="file" onChange={handleFileChange} />
          <input
            type="text"
            placeholder="What is this document? (e.g. QC report, CoA)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={{ width: "100%", marginTop: "0.5rem" }}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: "0.5rem" }}>
            <input type="checkbox" checked={isQcDocument} onChange={(e) => setIsQcDocument(e.target.checked)} />
            This is a lot verification/QC document
          </label>
          <div className="action-btns" style={{ marginTop: "0.5rem" }}>
            <button onClick={handleUpload} disabled={!file}>
              Upload
            </button>
            {onUploadAndApprove && (
              <button className="btn-green" onClick={handleUploadAndApprove} disabled={!file}>
                Upload &amp; Approve
              </button>
            )}
          </div>
          {error && <p className="error">{error}</p>}
        </div>
        <button onClick={onClose} className="modal-close-btn">
          {onUploadAndApprove ? "Cancel" : "Close"}
        </button>
      </div>
    </div>
  );
}

const NEW_FLUORO_VALUE = "__new__";
const DEFAULT_FLUORO_COLOR = "#9ca3af";

type InventoryBadge = {
  label: string;
  color: "red" | "yellow";
};

type InventoryRow = {
  antibody: Antibody;
  lots: number;
  sealed: number;
  opened: number;
  depleted: number;
  total: number;
  lowStock: boolean;
};

export default function InventoryPage() {
  const { user, labSettings } = useAuth();
  const { labs, fluorochromes, storageUnits, selectedLab, setSelectedLab, refreshFluorochromes, refreshStorageUnits } = useSharedData();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedAntibodyId = searchParams.get("antibodyId");
  const requestedLabId = searchParams.get("labId");
  const sealedOnly = labSettings.sealed_counts_only ?? false;
  const [antibodies, setAntibodies] = useState<Antibody[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAbForm, setShowAbForm] = useState(false);
  const [showLotForm, setShowLotForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gridColumns, setGridColumns] = useState(1);
  const gridRef = useRef<HTMLDivElement>(null);
  const [showInactiveLots, setShowInactiveLots] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    lotId: string;
    lotNumber: string;
    openedCount: number;
    sealedCount: number;
    totalCount: number;
  } | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [archivePrompt, setArchivePrompt] = useState<{ lotId: string; lotNumber: string } | null>(null);
  const [archiveWarning, setArchiveWarning] = useState<{
    lotId: string;
    lotNumber: string;
    sealedCount: number;
  } | null>(null);
  const [archiveNote, setArchiveNote] = useState("");
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [autoExpandedId, setAutoExpandedId] = useState<string | null>(null);
  const [archiveAbPrompt, setArchiveAbPrompt] = useState<{ id: string; label: string } | null>(null);
  const [archiveAbNote, setArchiveAbNote] = useState("");
  const [archiveAbLoading, setArchiveAbLoading] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [designationFilter, setDesignationFilter] = useState<string>("");
  const [editAbId, setEditAbId] = useState<string | null>(null);
  const [editAbForm, setEditAbForm] = useState({
    target: "",
    fluorochrome_choice: "",
    new_fluorochrome: "",
    new_fluoro_color: DEFAULT_FLUORO_COLOR,
    clone: "",
    vendor: "",
    catalog_number: "",
    designation: "ruo" as Designation,
    name: "",
    short_code: "",
    color: "#6366f1",
    stability_days: "",
    low_stock_threshold: "",
    approved_low_threshold: "",
  });
  const [editAbLoading, setEditAbLoading] = useState(false);
  const [modalLot, setModalLot] = useState<Lot | null>(null);
  const [qcBlockedLot, setQcBlockedLot] = useState<Lot | null>(null);
  const [docModalApproveAfter, setDocModalApproveAfter] = useState(false);

  // Lot drill-down
  const [drilldownLotId, setDrilldownLotId] = useState<string | null>(null);
  const [drilldownGrids, setDrilldownGrids] = useState<Map<string, StorageGridData>>(new Map());
  const [drilldownLoading, setDrilldownLoading] = useState(false);
  const [drilldownOpenTarget, setDrilldownOpenTarget] = useState<StorageCell | null>(null);
  const [drilldownOpenLoading, setDrilldownOpenLoading] = useState(false);
  const [drilldownStockUnitId, setDrilldownStockUnitId] = useState("");
  const [drilldownStockLoading, setDrilldownStockLoading] = useState(false);
  const [lotFormAvailableSlots, setLotFormAvailableSlots] = useState<number | null>(null);
  const [editLot, setEditLot] = useState<Lot | null>(null);
  const [editLotForm, setEditLotForm] = useState({ lot_number: "", vendor_barcode: "", expiration_date: "" });
  const [editLotLoading, setEditLotLoading] = useState(false);

  const [abForm, setAbForm] = useState({
    target: "",
    fluorochrome_choice: "",
    new_fluorochrome: "",
    new_fluoro_color: DEFAULT_FLUORO_COLOR,
    clone: "",
    vendor: "",
    catalog_number: "",
    designation: "ruo" as Designation,
    name: "",
    short_code: "",
    color: "#6366f1",
    stability_days: "",
    low_stock_threshold: "",
    approved_low_threshold: "",
  });

  const [lotForm, setLotForm] = useState({
    lot_number: "",
    vendor_barcode: "",
    expiration_date: "",
    quantity: "1",
    storage_unit_id: "",
  });

  const canEdit =
    user?.role === "super_admin" ||
    user?.role === "lab_admin" ||
    user?.role === "supervisor";
  const canReceive = canEdit || user?.role === "tech";
  const canQC = canEdit;
  const isMobile = useMediaQuery("(max-width: 768px)");

  // ESC closes topmost modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (archivePrompt) { setArchivePrompt(null); return; }
      if (archiveWarning) { setArchiveWarning(null); return; }
      if (qcBlockedLot) { setQcBlockedLot(null); return; }
      if (editLot) { setEditLot(null); return; }
      if (editAbId) { setEditAbId(null); return; }
      if (confirmAction) { setConfirmAction(null); return; }
      if (archiveAbPrompt) { setArchiveAbPrompt(null); return; }
      if (modalLot) { setModalLot(null); return; }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [archivePrompt, archiveWarning, qcBlockedLot, editLot, editAbId, confirmAction, archiveAbPrompt, modalLot]);

  // If deep-linked with a labId, switch to that lab
  useEffect(() => {
    if (requestedLabId && labs.some((lab) => lab.id === requestedLabId)) {
      setSelectedLab(requestedLabId);
    }
  }, [requestedLabId, labs]);

  const loadData = async () => {
    if (!selectedLab) return;
    const params: Record<string, string> = { lab_id: selectedLab };
    const abParams: Record<string, string> = { ...params };
    if (showInactive) abParams.include_inactive = "true";
    const lotParams: Record<string, string> = { ...params, include_archived: "true" };
    const [abRes, lotRes] = await Promise.all([
      api.get<Antibody[]>("/antibodies/", { params: abParams }),
      api.get<Lot[]>("/lots/", { params: lotParams }),
    ]);
    setAntibodies(abRes.data);
    setLots(lotRes.data);
  };

  useEffect(() => {
    if (selectedLab) {
      loadData();
    }
  }, [selectedLab, showInactive]);

  useEffect(() => {
    if (!requestedAntibodyId) return;
    if (autoExpandedId === requestedAntibodyId) return;
    const exists = antibodies.some((ab) => ab.id === requestedAntibodyId);
    if (!exists) return;
    setExpandedId(requestedAntibodyId);
    setAutoExpandedId(requestedAntibodyId);
    requestAnimationFrame(() => {
      const el = document.querySelector(
        `[data-antibody-id="${requestedAntibodyId}"]`
      );
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }, [requestedAntibodyId, autoExpandedId, antibodies]);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const minCardWidth = 240;
    const updateColumns = () => {
      const styles = window.getComputedStyle(grid);
      const gap = parseFloat(styles.columnGap || styles.gap || "0") || 0;
      const width = grid.clientWidth || 1;
      const cols = Math.max(1, Math.floor((width + gap) / (minCardWidth + gap)));
      setGridColumns(cols);
    };
    updateColumns();
    const observer = new ResizeObserver(updateColumns);
    observer.observe(grid);
    window.addEventListener("resize", updateColumns);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateColumns);
    };
  }, []);

  const fluorochromeByName = useMemo(() => {
    const map = new Map<string, Fluorochrome>();
    for (const f of fluorochromes) {
      map.set(f.name.toLowerCase(), f);
    }
    return map;
  }, [fluorochromes]);

  const isLotInactive = (l: Lot) =>
    l.is_archived || ((l.vial_counts?.sealed ?? 0) + (l.vial_counts?.opened ?? 0) === 0);

  const activeLots = useMemo(() => lots.filter((l) => !isLotInactive(l)), [lots]);

  const allInventoryRows: InventoryRow[] = useMemo(() => {
    const counts = new Map<
      string,
      { lots: number; sealed: number; opened: number; depleted: number; total: number }
    >();
    for (const lot of activeLots) {
      const c: VialCounts = lot.vial_counts || {
        sealed: 0,
        opened: 0,
        depleted: 0,
        total: 0,
      };
      const entry = counts.get(lot.antibody_id) || {
        lots: 0,
        sealed: 0,
        opened: 0,
        depleted: 0,
        total: 0,
      };
      entry.lots += 1;
      entry.sealed += c.sealed;
      entry.opened += c.opened;
      entry.depleted += c.depleted;
      entry.total += c.total;
      counts.set(lot.antibody_id, entry);
    }
    return antibodies
      .map((ab) => {
        const c = counts.get(ab.id) || {
          lots: 0,
          sealed: 0,
          opened: 0,
          depleted: 0,
          total: 0,
        };
        return {
          antibody: ab,
          ...c,
          lowStock:
            ab.low_stock_threshold !== null &&
            c.sealed < ab.low_stock_threshold,
        };
      })
      .sort((a, b) => {
        const labelA = a.antibody.name || [a.antibody.target, a.antibody.fluorochrome].filter(Boolean).join("-") || "";
        const labelB = b.antibody.name || [b.antibody.target, b.antibody.fluorochrome].filter(Boolean).join("-") || "";
        return labelA.localeCompare(labelB);
      });
  }, [antibodies, activeLots]);

  const inventoryRows = useMemo(
    () => allInventoryRows.filter((r) =>
      r.antibody.is_active &&
      (!designationFilter || r.antibody.designation === designationFilter)
    ),
    [allInventoryRows, designationFilter]
  );
  const inactiveRows = useMemo(
    () => allInventoryRows.filter((r) => !r.antibody.is_active),
    [allInventoryRows]
  );

  const lotsByAntibody = useMemo(() => {
    const map = new Map<string, Lot[]>();
    for (const lot of lots) {
      const list = map.get(lot.antibody_id) || [];
      list.push(lot);
      map.set(lot.antibody_id, list);
    }
    return map;
  }, [lots]);

  const lotAgeBadgeMap = useMemo(() => {
    const map = new Map<string, "current" | "new">();
    for (const [, abLots] of lotsByAntibody) {
      const nonArchived = abLots.filter((l) => !l.is_archived);
      if (nonArchived.length < 2) continue;
      // Eligible lots: not archived, has sealed vials (not fully depleted)
      const eligible = nonArchived
        .filter((l) => (l.vial_counts?.sealed ?? 0) > 0)
        // Sort by expiration date ascending (soonest first); lots without expiration go last
        .sort((a, b) => {
          if (!a.expiration_date && !b.expiration_date) return 0;
          if (!a.expiration_date) return 1;
          if (!b.expiration_date) return -1;
          return new Date(a.expiration_date).getTime() - new Date(b.expiration_date).getTime();
        });
      if (eligible.length < 2) continue;
      const currentLot = eligible[0];
      for (const lot of eligible) {
        map.set(lot.id, lot === currentLot ? "current" : "new");
      }
    }
    return map;
  }, [lotsByAntibody]);

  const expiryWarnDays = labSettings.expiry_warn_days ?? 30;

  const antibodyBadges = useMemo(() => {
    const map = new Map<string, InventoryBadge[]>();
    for (const row of allInventoryRows) {
      const ab = row.antibody;
      if (!ab.is_active) continue;
      const badges: InventoryBadge[] = [];
      const abLots = lotsByAntibody.get(ab.id) || [];
      const activAbLots = abLots.filter((l) => !l.is_archived);

      // Total sealed vials from non-archived, non-failed lots (approved + pending QC)
      const totalSealed = activAbLots
        .filter((l) => l.qc_status !== "failed")
        .reduce((s, l) => s + (l.vial_counts?.sealed ?? 0), 0);

      // Approved sealed vials only
      const approvedSealed = activAbLots
        .filter((l) => l.qc_status === "approved")
        .reduce((s, l) => s + (l.vial_counts?.sealed ?? 0), 0);

      // Reorder badge: total sealed (including pending QC) below reorder point
      if (ab.low_stock_threshold != null && totalSealed < ab.low_stock_threshold) {
        const reorderLabel = totalSealed === 0
          ? "No Stock \u2014 Reorder"
          : `Low Stock (${totalSealed} vial${totalSealed === 1 ? "" : "s"}) \u2014 Reorder`;
        badges.push({ label: reorderLabel, color: "red" });
      }

      // Needs QC badge: approved sealed below min ready stock, but total is fine
      if (
        ab.approved_low_threshold != null &&
        approvedSealed < ab.approved_low_threshold &&
        !(ab.low_stock_threshold != null && totalSealed < ab.low_stock_threshold)
      ) {
        badges.push({ label: "Needs QC", color: "yellow" });
      }

      // Needs QC badge (doc required): lab requires QC doc and at least one pending lot is missing one
      const needsQcDoc = (labSettings.qc_doc_required ?? false) &&
        activAbLots.some((l) => l.qc_status === "pending" && !l.has_qc_document);
      if (needsQcDoc && !badges.some((b) => b.label === "Needs QC")) {
        badges.push({ label: "Needs QC", color: "yellow" });
      }

      // Expiring badge: has lots expiring within 30 days
      const now = new Date();
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + expiryWarnDays);
      const hasExpiring = activAbLots.some((l) => {
        if (!l.expiration_date) return false;
        const exp = new Date(l.expiration_date);
        return exp <= cutoff && exp >= now;
      });
      const hasExpired = activAbLots.some((l) => {
        if (!l.expiration_date) return false;
        return new Date(l.expiration_date) < now;
      });
      if (hasExpired) {
        badges.push({ label: "Expired Lot", color: "red" });
      } else if (hasExpiring) {
        badges.push({ label: "Expiring", color: "yellow" });
      }

      if (badges.length) {
        map.set(ab.id, badges);
      }
    }
    return map;
  }, [allInventoryRows, lotsByAntibody, expiryWarnDays]);

  useEffect(() => {
    setShowLotForm(false);
    setLotForm({
      lot_number: "",
      vendor_barcode: "",
      expiration_date: "",
      quantity: "1",
      storage_unit_id: "",
    });
    setDrilldownLotId(null);
    setDrilldownGrids(new Map());
    setDrilldownOpenTarget(null);
  }, [expandedId]);

  const resetMessages = () => {
    setMessage(null);
    setError(null);
  };

  // ── Lot drill-down handlers ────────────────────────────────────────
  const handleLotClick = async (lot: Lot) => {
    if (drilldownLotId === lot.id) {
      setDrilldownLotId(null);
      setDrilldownGrids(new Map());
      setDrilldownOpenTarget(null);
      return;
    }
    setDrilldownLotId(lot.id);
    setDrilldownOpenTarget(null);
    setDrilldownGrids(new Map());
    setDrilldownStockUnitId("");
    const locations = lot.storage_locations ?? [];
    if (locations.length === 0) return;
    setDrilldownLoading(true);
    try {
      const grids = new Map<string, StorageGridData>();
      await Promise.all(
        locations.map(async (loc) => {
          try {
            const res = await api.get<StorageGridData>(`/storage/units/${loc.unit_id}/grid`);
            grids.set(loc.unit_id, res.data);
          } catch { /* skip failed grids */ }
        })
      );
      setDrilldownGrids(grids);
    } finally {
      setDrilldownLoading(false);
    }
  };

  const handleDrilldownCellClick = (cell: StorageCell) => {
    if (!cell.vial || cell.vial.lot_id !== drilldownLotId) return;
    if (cell.vial.status !== "sealed" && cell.vial.status !== "opened") return;
    setDrilldownOpenTarget(cell);
  };

  const getDrilldownPopoutActions = useCallback(
    (cell: StorageCell) => {
      if (!cell.vial) return [];
      const vial = cell.vial;
      const actions: Array<{ label: string; onClick: () => void; variant?: "primary" | "danger" | "default" }> = [];
      if (vial.status === "sealed") {
        actions.push({ label: "Open", variant: "primary", onClick: () => handleDrilldownCellClick(cell) });
      } else if (vial.status === "opened") {
        actions.push({ label: "Deplete", variant: "danger", onClick: () => handleDrilldownCellClick(cell) });
      }
      return actions;
    },
    [drilldownLotId]
  );

  const handleDrilldownOpen = async (force: boolean) => {
    if (!drilldownOpenTarget?.vial) return;
    setDrilldownOpenLoading(true);
    try {
      await api.post(`/vials/${drilldownOpenTarget.vial.id}/open?force=${force}`, { cell_id: drilldownOpenTarget.id });
      setMessage(`Vial opened from cell ${drilldownOpenTarget.label}.`);
      setDrilldownOpenTarget(null);
      await loadData();
      // Re-fetch grids
      const lot = lots.find((l) => l.id === drilldownLotId);
      if (lot) {
        setDrilldownLotId(null);
        setTimeout(() => handleLotClick(lot), 50);
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to open vial");
      setDrilldownOpenTarget(null);
    } finally {
      setDrilldownOpenLoading(false);
    }
  };

  const handleDrilldownDeplete = async () => {
    if (!drilldownOpenTarget?.vial) return;
    setDrilldownOpenLoading(true);
    try {
      await api.post(`/vials/${drilldownOpenTarget.vial.id}/deplete`);
      setMessage(`Vial depleted from cell ${drilldownOpenTarget.label}.`);
      setDrilldownOpenTarget(null);
      await loadData();
      const lot = lots.find((l) => l.id === drilldownLotId);
      if (lot) {
        setDrilldownLotId(null);
        setTimeout(() => handleLotClick(lot), 50);
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to deplete vial");
      setDrilldownOpenTarget(null);
    } finally {
      setDrilldownOpenLoading(false);
    }
  };

  const handleDrilldownStock = async () => {
    const lot = lots.find((l) => l.id === drilldownLotId);
    if (!lot?.vendor_barcode || !drilldownStockUnitId) return;
    setDrilldownStockLoading(true);
    try {
      await api.post(`/storage/units/${drilldownStockUnitId}/stock`, { barcode: lot.vendor_barcode });
      setMessage("Vial stocked successfully.");
      await loadData();
      setDrilldownLotId(null);
      setTimeout(() => handleLotClick(lot), 50);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to stock vial");
    } finally {
      setDrilldownStockLoading(false);
    }
  };

  const handleCreateAntibody = async (e: FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    resetMessages();
    setLoading(true);
    try {
      const isIVD = abForm.designation === "ivd";
      let fluoroName: string | null = null;
      const params: Record<string, string> = {};
      if (user?.role === "super_admin" && selectedLab) {
        params.lab_id = selectedLab;
      }

      if (!isIVD) {
        fluoroName = abForm.fluorochrome_choice;
        if (fluoroName === NEW_FLUORO_VALUE) {
          const name = abForm.new_fluorochrome.trim();
          if (!name) {
            setError("Please enter a fluorochrome name.");
            setLoading(false);
            return;
          }
          const existing = fluorochromeByName.get(name.toLowerCase());
          if (!existing) {
            await api.post(
              "/fluorochromes/",
              { name, color: abForm.new_fluoro_color },
              { params }
            );
          } else if (existing.color !== abForm.new_fluoro_color) {
            await api.patch(`/fluorochromes/${existing.id}`, {
              color: abForm.new_fluoro_color,
            });
          }
          fluoroName = name;
        }

        if (!fluoroName) {
          setError("Please select a fluorochrome.");
          setLoading(false);
          return;
        }
      }

      await api.post(
        "/antibodies/",
        {
          target: isIVD ? null : abForm.target,
          fluorochrome: isIVD ? null : fluoroName,
          clone: isIVD ? null : (abForm.clone || null),
          vendor: abForm.vendor || null,
          catalog_number: abForm.catalog_number || null,
          designation: abForm.designation,
          name: abForm.name.trim() || null,
          short_code: isIVD ? (abForm.short_code.trim() || null) : null,
          color: isIVD ? (abForm.color || null) : null,
          stability_days: abForm.stability_days
            ? parseInt(abForm.stability_days, 10)
            : null,
          low_stock_threshold: abForm.low_stock_threshold
            ? parseInt(abForm.low_stock_threshold, 10)
            : null,
          approved_low_threshold: abForm.approved_low_threshold
            ? parseInt(abForm.approved_low_threshold, 10)
            : null,
        },
        { params }
      );

      setAbForm({
        target: "",
        fluorochrome_choice: "",
        new_fluorochrome: "",
        new_fluoro_color: DEFAULT_FLUORO_COLOR,
        clone: "",
        vendor: "",
        catalog_number: "",
        designation: "ruo",
        name: "",
        short_code: "",
        color: "#6366f1",
        stability_days: "",
        low_stock_threshold: "",
        approved_low_threshold: "",
      });
      setShowAbForm(false);
      setMessage("Antibody created.");
      await loadData();
      refreshFluorochromes();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to create antibody");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateFluoroColor = async (fluoroName: string, color: string) => {
    if (!canEdit) return;
    resetMessages();
    const existing = fluorochromeByName.get(fluoroName.toLowerCase());
    try {
      if (existing) {
        await api.patch(`/fluorochromes/${existing.id}`, { color });
      } else {
        const params: Record<string, string> = {};
        if (user?.role === "super_admin" && selectedLab) {
          params.lab_id = selectedLab;
        }
        await api.post("/fluorochromes/", { name: fluoroName, color }, { params });
      }
      await loadData();
      refreshFluorochromes();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to update color");
    }
  };

  const openEditLot = (lot: Lot) => {
    setEditLotForm({
      lot_number: lot.lot_number,
      vendor_barcode: lot.vendor_barcode || "",
      expiration_date: lot.expiration_date || "",
    });
    setEditLot(lot);
  };

  const handleEditLot = async (e: FormEvent) => {
    e.preventDefault();
    if (!editLot) return;
    resetMessages();
    setEditLotLoading(true);
    try {
      await api.patch(`/lots/${editLot.id}`, {
        lot_number: editLotForm.lot_number,
        vendor_barcode: editLotForm.vendor_barcode || null,
        expiration_date: editLotForm.expiration_date || null,
      });
      setMessage("Lot updated.");
      setEditLot(null);
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to update lot");
    } finally {
      setEditLotLoading(false);
    }
  };

  const handleCreateLot = async (e: FormEvent) => {
    e.preventDefault();
    const targetAntibody = antibodies.find((a) => a.id === expandedId) || null;
    if (!canReceive || !targetAntibody) return;
    resetMessages();
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (user?.role === "super_admin" && selectedLab) {
        params.lab_id = selectedLab;
      }
      const lotRes = await api.post(
        "/lots/",
        {
          antibody_id: targetAntibody.id,
          lot_number: lotForm.lot_number,
          vendor_barcode: lotForm.vendor_barcode || null,
          expiration_date: lotForm.expiration_date || null,
        },
        { params }
      );
      const qtyRaw = lotForm.quantity.trim();
      let qty = 0;
      if (qtyRaw) {
        qty = parseInt(qtyRaw, 10);
        if (!Number.isFinite(qty) || qty < 1) {
          setError("Please enter a valid vial quantity.");
          setLoading(false);
          return;
        }
      }
      if (qty > 0) {
        await api.post("/vials/receive", {
          lot_id: lotRes.data.id,
          quantity: qty,
          storage_unit_id: lotForm.storage_unit_id || null,
        });
      }
      setLotForm({
        lot_number: "",
        vendor_barcode: "",
        expiration_date: "",
        quantity: "1",
        storage_unit_id: "",
      });
      setShowLotForm(false);
      setMessage("Lot created.");
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to create lot");
    } finally {
      setLoading(false);
    }
  };

  const updateQC = async (lotId: string, status: "approved") => {
    try {
      await api.patch(`/lots/${lotId}/qc`, { qc_status: status });
      await loadData();
    } catch (err: any) {
      if (err.response?.status === 409) {
        const lot = lots.find((l) => l.id === lotId) || null;
        setQcBlockedLot(lot);
      }
    }
  };

  const handleArchive = async (lotId: string, note?: string) => {
    setArchiveLoading(true);
    try {
      const body = note ? { note } : undefined;
      await api.patch(`/lots/${lotId}/archive`, body);
      await loadData();
      setArchivePrompt(null);
      setArchiveWarning(null);
      setArchiveNote("");
    } catch {
      // keep UI stable on failure
    } finally {
      setArchiveLoading(false);
    }
  };

  const initiateArchive = (lot: Lot) => {
    // If unarchiving, just do it directly
    if (lot.is_archived) {
      handleArchive(lot.id);
      return;
    }

    const sealedCount = lot.vial_counts?.sealed ?? 0;
    const isExpired = lot.expiration_date
      ? new Date(lot.expiration_date) < new Date()
      : false;

    // Show warning if there are sealed vials and lot isn't expired
    if (sealedCount > 0 && !isExpired) {
      setArchiveWarning({
        lotId: lot.id,
        lotNumber: lot.lot_number,
        sealedCount,
      });
    } else {
      // Go directly to archive note prompt
      setArchiveNote("");
      setArchivePrompt({ lotId: lot.id, lotNumber: lot.lot_number });
    }
  };

  const handleArchiveAntibody = async (antibodyId: string, note?: string) => {
    setArchiveAbLoading(true);
    try {
      const body = note ? { note } : undefined;
      await api.patch(`/antibodies/${antibodyId}/archive`, body);
      await loadData();
      setArchiveAbPrompt(null);
      setArchiveAbNote("");
    } catch {
      // keep UI stable on failure
    } finally {
      setArchiveAbLoading(false);
    }
  };

  const openEditForm = (ab: Antibody) => {
    const fluoro = ab.fluorochrome ? fluorochromeByName.get(ab.fluorochrome.toLowerCase()) : undefined;
    setEditAbForm({
      target: ab.target || "",
      fluorochrome_choice: ab.fluorochrome || "",
      new_fluorochrome: "",
      new_fluoro_color: fluoro?.color || DEFAULT_FLUORO_COLOR,
      clone: ab.clone || "",
      vendor: ab.vendor || "",
      catalog_number: ab.catalog_number || "",
      designation: ab.designation,
      name: ab.name || "",
      short_code: ab.short_code || "",
      color: ab.color || "#6366f1",
      stability_days: ab.stability_days != null ? String(ab.stability_days) : "",
      low_stock_threshold: ab.low_stock_threshold != null ? String(ab.low_stock_threshold) : "",
      approved_low_threshold: ab.approved_low_threshold != null ? String(ab.approved_low_threshold) : "",
    });
    setEditAbId(ab.id);
  };

  const handleEditAntibody = async (e: FormEvent) => {
    e.preventDefault();
    if (!editAbId || !canEdit) return;
    resetMessages();
    setEditAbLoading(true);
    try {
      const isIVD = editAbForm.designation === "ivd";
      let fluoroName: string | null = isIVD ? null : editAbForm.fluorochrome_choice;
      const params: Record<string, string> = {};
      if (user?.role === "super_admin" && selectedLab) {
        params.lab_id = selectedLab;
      }
      if (!isIVD && fluoroName === NEW_FLUORO_VALUE) {
        const name = editAbForm.new_fluorochrome.trim();
        if (!name) {
          setError("Please enter a fluorochrome name.");
          setEditAbLoading(false);
          return;
        }
        const existing = fluorochromeByName.get(name.toLowerCase());
        if (!existing) {
          await api.post(
            "/fluorochromes/",
            { name, color: editAbForm.new_fluoro_color },
            { params }
          );
        } else if (existing.color !== editAbForm.new_fluoro_color) {
          await api.patch(`/fluorochromes/${existing.id}`, {
            color: editAbForm.new_fluoro_color,
          });
        }
        fluoroName = name;
      }
      await api.patch(`/antibodies/${editAbId}`, {
        target: isIVD ? null : editAbForm.target,
        fluorochrome: isIVD ? null : fluoroName,
        clone: isIVD ? null : (editAbForm.clone || null),
        vendor: editAbForm.vendor || null,
        catalog_number: editAbForm.catalog_number || null,
        designation: editAbForm.designation,
        name: editAbForm.name.trim() || null,
        short_code: isIVD ? (editAbForm.short_code.trim() || null) : null,
        color: isIVD ? (editAbForm.color || null) : null,
        stability_days: editAbForm.stability_days
          ? parseInt(editAbForm.stability_days, 10)
          : null,
        low_stock_threshold: editAbForm.low_stock_threshold
          ? parseInt(editAbForm.low_stock_threshold, 10)
          : null,
        approved_low_threshold: editAbForm.approved_low_threshold
          ? parseInt(editAbForm.approved_low_threshold, 10)
          : null,
      });
      setEditAbId(null);
      setMessage("Antibody updated.");
      await loadData();
      refreshFluorochromes();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to update antibody");
    } finally {
      setEditAbLoading(false);
    }
  };

  const handleConfirmDeplete = async (type: "opened" | "lot") => {
    if (!confirmAction) return;
    setConfirmLoading(true);
    try {
      if (type === "opened") {
        await api.post(`/lots/${confirmAction.lotId}/deplete-all`);
      } else {
        await api.post(`/lots/${confirmAction.lotId}/deplete-all-lot`);
      }
      setConfirmAction(null);
      await loadData();
    } catch {
      // keep UI stable on failure
    } finally {
      setConfirmLoading(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Inventory</h1>
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
          <select
            value={designationFilter}
            onChange={(e) => setDesignationFilter(e.target.value)}
          >
            <option value="">All Designations</option>
            <option value="ruo">RUO</option>
            <option value="asr">ASR</option>
            <option value="ivd">IVD</option>
          </select>
          {canEdit && (
            <button onClick={() => setShowAbForm(!showAbForm)}>
              {showAbForm ? "Cancel" : "+ New Antibody"}
            </button>
          )}
        </div>
      </div>

      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}

      {showAbForm && (
        <form className="inline-form" onSubmit={handleCreateAntibody}>
          <select
            value={abForm.designation}
            onChange={(e) =>
              setAbForm({ ...abForm, designation: e.target.value as Designation })
            }
          >
            <option value="ruo">RUO</option>
            <option value="asr">ASR</option>
            <option value="ivd">IVD</option>
          </select>
          {abForm.designation === "ivd" && (
            <>
              <input
                placeholder="Product Name (required for IVD)"
                value={abForm.name}
                onChange={(e) => setAbForm({ ...abForm, name: e.target.value })}
                required
              />
              <input
                placeholder="Short Code (e.g., MT34)"
                value={abForm.short_code}
                onChange={(e) => setAbForm({ ...abForm, short_code: e.target.value.slice(0, 5) })}
                maxLength={5}
                required
              />
              <input
                type="color"
                value={abForm.color}
                onChange={(e) => setAbForm({ ...abForm, color: e.target.value })}
                title="Grid cell color"
              />
            </>
          )}
          {abForm.designation !== "ivd" && (
            <>
              <input
                placeholder="Target (e.g., CD3)"
                value={abForm.target}
                onChange={(e) => setAbForm({ ...abForm, target: e.target.value })}
                required
              />
              <select
                value={abForm.fluorochrome_choice}
                onChange={(e) =>
                  setAbForm({ ...abForm, fluorochrome_choice: e.target.value })
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
              {abForm.fluorochrome_choice === NEW_FLUORO_VALUE && (
                <>
                  <input
                    placeholder="New Fluorochrome"
                    value={abForm.new_fluorochrome}
                    onChange={(e) =>
                      setAbForm({ ...abForm, new_fluorochrome: e.target.value })
                    }
                    required
                  />
                  <input
                    type="color"
                    value={abForm.new_fluoro_color}
                    onChange={(e) =>
                      setAbForm({ ...abForm, new_fluoro_color: e.target.value })
                    }
                    required
                  />
                </>
              )}
              <input
                placeholder="Clone"
                value={abForm.clone}
                onChange={(e) => setAbForm({ ...abForm, clone: e.target.value })}
              />
            </>
          )}
          <input
            placeholder="Vendor"
            value={abForm.vendor}
            onChange={(e) => setAbForm({ ...abForm, vendor: e.target.value })}
          />
          <input
            placeholder="Catalog #"
            value={abForm.catalog_number}
            onChange={(e) =>
              setAbForm({ ...abForm, catalog_number: e.target.value })
            }
          />
          <input
            type="number"
            placeholder="Stability (days)"
            min={1}
            value={abForm.stability_days}
            onChange={(e) =>
              setAbForm({ ...abForm, stability_days: e.target.value })
            }
          />
          <input
            type="number"
            placeholder="Reorder Point (total sealed vials)"
            min={1}
            value={abForm.low_stock_threshold}
            onChange={(e) =>
              setAbForm({ ...abForm, low_stock_threshold: e.target.value })
            }
            title="Alert when total vials on hand drops below this level"
          />
          <input
            type="number"
            placeholder="Min Ready Stock (approved vials)"
            min={1}
            value={abForm.approved_low_threshold}
            onChange={(e) =>
              setAbForm({ ...abForm, approved_low_threshold: e.target.value })
            }
            title="Alert when QC-approved vials drops below this level"
          />
          <button type="submit" disabled={loading}>
            {loading ? "Creating..." : "Create Antibody"}
          </button>
        </form>
      )}

      <div className="inventory-grid stagger-reveal" ref={gridRef}>
        {inventoryRows.map((row, index) => {
          const fluoro = row.antibody.fluorochrome ? fluorochromeByName.get(
            row.antibody.fluorochrome.toLowerCase()
          ) : undefined;
          const abColor = fluoro?.color || row.antibody.color || undefined;
          const expanded = expandedId === row.antibody.id;
          const allCardLots = lotsByAntibody.get(row.antibody.id) || [];
          const cardLots = showInactiveLots ? allCardLots : allCardLots.filter((l) => !isLotInactive(l));
          const rowIndex = Math.floor(index / gridColumns) + 1;
          return (
            <div
              key={row.antibody.id}
              className={`inventory-card ${
                expanded ? "expanded" : ""
              }`}
              data-antibody-id={row.antibody.id}
              style={
                expanded
                  ? {
                      gridColumn: "1 / -1",
                      gridRow: `${rowIndex}`,
                    }
                  : undefined
              }
              onClick={() => {
                setExpandedId(expanded ? null : row.antibody.id);
              }}
            >
              <span className="corner-arrow corner-tl" />
              <span className="corner-arrow corner-tr" />
              <span className="corner-arrow corner-bl" />
              <span className="corner-arrow corner-br" />
              <div className="inventory-card-header">
                <div className="inventory-title">
                  <div
                    className={`fluoro-circle${canEdit && row.antibody.fluorochrome ? " editable" : ""}`}
                    style={{ backgroundColor: abColor || DEFAULT_FLUORO_COLOR }}
                    title={canEdit && row.antibody.fluorochrome ? "Click to change color" : undefined}
                  >
                    {canEdit && row.antibody.fluorochrome && (
                      <>
                        <span className="fluoro-circle-icon">✎</span>
                        <input
                          type="color"
                          className="fluoro-circle-input"
                          value={fluoro?.color || DEFAULT_FLUORO_COLOR}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            e.stopPropagation();
                            handleUpdateFluoroColor(
                              row.antibody.fluorochrome!,
                              e.target.value
                            );
                          }}
                        />
                      </>
                    )}
                  </div>
                  <span>
                    {row.antibody.name || [row.antibody.target, row.antibody.fluorochrome].filter(Boolean).join("-") || "Unnamed"}
                    {row.antibody.name && row.antibody.target && row.antibody.fluorochrome && (
                      <span className="inventory-subtitle">{row.antibody.target}-{row.antibody.fluorochrome}</span>
                    )}
                  </span>
                  <span className={`badge badge-designation-${row.antibody.designation}`} style={{ fontSize: "0.7em", marginLeft: 6 }}>
                    {row.antibody.designation.toUpperCase()}
                  </span>
                </div>
                {canEdit && (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <div
                      className="active-switch"
                      onClick={(e) => {
                        e.stopPropagation();
                        setArchiveAbNote("");
                        setArchiveAbPrompt({
                          id: row.antibody.id,
                          label: row.antibody.name || [row.antibody.target, row.antibody.fluorochrome].filter(Boolean).join("-") || "Unnamed",
                        });
                      }}
                      title="Set this antibody as inactive"
                    >
                      <span className="active-switch-label on">Active</span>
                      <div className="active-switch-track on">
                        <div className="active-switch-thumb" />
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="inventory-meta">
                <span>{row.lots} lot{row.lots === 1 ? "" : "s"}</span>
                {antibodyBadges.get(row.antibody.id)?.map((b, i) => (
                  <span
                    key={i}
                    className={`badge badge-${b.color}`}
                    style={{ fontSize: "0.75em" }}
                  >
                    {b.label}
                  </span>
                ))}
              </div>
              <div className="inventory-submeta">
                <span>Vendor: {row.antibody.vendor || "—"}</span>
                <span>Catalog #: {row.antibody.catalog_number || "—"}</span>
              </div>
              <div className="inventory-counts">
                <div>
                  <div className="count-label">Sealed</div>
                  <div className="count-value">{row.sealed}</div>
                </div>
                {!sealedOnly && (
                  <div>
                    <div className="count-label">Opened</div>
                    <div className="count-value">{row.opened}</div>
                  </div>
                )}
                {!sealedOnly && (
                  <div>
                    <div className="count-label">Depleted</div>
                    <div className="count-value">{row.depleted}</div>
                  </div>
                )}
                <div>
                  <div className="count-label">Total</div>
                  <div className="count-value">{row.total}</div>
                </div>
              </div>
              <div className="expand-label">Expand</div>
              <div className="collapse-label">Collapse</div>
              {expanded && (
                <div className="inventory-expanded" onClick={(e) => e.stopPropagation()}>
                  <div className="detail-header">
                    <div>
                      <h3>Lots</h3>
                      <p className="page-desc">Manage lots for this antibody.</p>
                    </div>
                    <div className="filters">
                      <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <input
                          type="checkbox"
                          checked={showInactiveLots}
                          onChange={() => setShowInactiveLots(!showInactiveLots)}
                        />
                        Show inactive
                      </label>
                      {canEdit && (
                        <button onClick={() => openEditForm(row.antibody)}>
                          Edit Antibody
                        </button>
                      )}
                      {canReceive && (
                        <button onClick={() => setShowLotForm(!showLotForm)}>
                          {showLotForm ? "Cancel" : "+ New Lot"}
                        </button>
                      )}
                    </div>
                  </div>

                  {showLotForm && (
                    <form className="inline-form" onSubmit={handleCreateLot}>
                      <div className="inline-form-full barcode-row">
                        <div className="input-with-scan">
                          <input
                            placeholder="Vendor Barcode"
                            value={lotForm.vendor_barcode}
                            onChange={(e) =>
                              setLotForm({
                                ...lotForm,
                                vendor_barcode: e.target.value,
                              })
                            }
                          />
                          <BarcodeScannerButton
                            label="Scan"
                            onDetected={(value) =>
                              setLotForm({ ...lotForm, vendor_barcode: value })
                            }
                          />
                        </div>
                      </div>
                      <input
                        placeholder="Lot Number"
                        value={lotForm.lot_number}
                        onChange={(e) =>
                          setLotForm({ ...lotForm, lot_number: e.target.value })
                        }
                        required
                      />
                      <DatePicker
                        value={lotForm.expiration_date}
                        onChange={(v) =>
                          setLotForm({
                            ...lotForm,
                            expiration_date: v,
                          })
                        }
                        placeholderText="Expiration date"
                      />
                      <input
                        type="number"
                        min={1}
                        placeholder="Vials received"
                        value={lotForm.quantity}
                        onChange={(e) =>
                          setLotForm({ ...lotForm, quantity: e.target.value })
                        }
                      />
                      <select
                        value={lotForm.storage_unit_id}
                        onChange={(e) => {
                          setLotForm({ ...lotForm, storage_unit_id: e.target.value });
                          if (e.target.value) {
                            api.get(`/storage/units/${e.target.value}/available-slots`)
                              .then((r) => setLotFormAvailableSlots(r.data.available_cells))
                              .catch(() => setLotFormAvailableSlots(null));
                          } else {
                            setLotFormAvailableSlots(null);
                          }
                        }}
                      >
                        <option value="">No storage assignment</option>
                        {storageUnits.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name} ({u.rows}x{u.cols}) {u.temperature || ""}
                          </option>
                        ))}
                      </select>
                      {lotFormAvailableSlots !== null && lotForm.storage_unit_id && parseInt(lotForm.quantity) > lotFormAvailableSlots && (
                        <p className="overflow-hint">
                          Only {lotFormAvailableSlots} slot{lotFormAvailableSlots !== 1 ? "s" : ""} available.{" "}
                          <button type="button" className="btn-sm" onClick={() => { setLotForm({ ...lotForm, storage_unit_id: "" }); setLotFormAvailableSlots(null); }}>
                            Use Temp Storage
                          </button>
                        </p>
                      )}
                      <button type="submit" disabled={loading}>
                        {loading ? "Saving..." : "Create Lot"}
                      </button>
                    </form>
                  )}

                  {cardLots.length > 0 ? (
                    isMobile ? (
                      <LotCardList
                        lots={cardLots}
                        sealedOnly={sealedOnly}
                        canQC={canQC}
                        qcDocRequired={labSettings.qc_doc_required ?? false}
                        lotAgeBadgeMap={lotAgeBadgeMap}
                        onApproveQC={(id) => updateQC(id, "approved")}
                        onDeplete={(lot) =>
                          setConfirmAction({
                            lotId: lot.id,
                            lotNumber: lot.lot_number,
                            openedCount: lot.vial_counts?.opened ?? 0,
                            sealedCount: lot.vial_counts?.sealed ?? 0,
                            totalCount: lot.vial_counts?.total ?? 0,
                          })
                        }
                        onOpenDocs={(lot) => setModalLot(lot)}
                        onArchive={initiateArchive}
                        onEditLot={openEditLot}
                        onConsolidate={(lot) => {
                          const unitId = lot.storage_locations?.[0]?.unit_id;
                          if (unitId) navigate(`/storage?lotId=${lot.id}&unitId=${unitId}`);
                        }}
                        onLotClick={handleLotClick}
                        selectedLotId={drilldownLotId}
                      />
                    ) : (
                      <LotTable
                        lots={cardLots}
                        sealedOnly={sealedOnly}
                        canQC={canQC}
                        qcDocRequired={labSettings.qc_doc_required ?? false}
                        lotAgeBadgeMap={lotAgeBadgeMap}
                        onApproveQC={(id) => updateQC(id, "approved")}
                        onDeplete={(lot) =>
                          setConfirmAction({
                            lotId: lot.id,
                            lotNumber: lot.lot_number,
                            openedCount: lot.vial_counts?.opened ?? 0,
                            sealedCount: lot.vial_counts?.sealed ?? 0,
                            totalCount: lot.vial_counts?.total ?? 0,
                          })
                        }
                        onOpenDocs={(lot) => setModalLot(lot)}
                        onArchive={initiateArchive}
                        onEditLot={openEditLot}
                        onConsolidate={(lot) => {
                          const unitId = lot.storage_locations?.[0]?.unit_id;
                          if (unitId) navigate(`/storage?lotId=${lot.id}&unitId=${unitId}`);
                        }}
                        onLotClick={handleLotClick}
                        selectedLotId={drilldownLotId}
                      />
                    )
                  ) : (
                    <p className="empty">No lots for this antibody yet.</p>
                  )}

                  {/* Lot drill-down panel */}
                  {drilldownLotId && (() => {
                    const ddLot = cardLots.find((l) => l.id === drilldownLotId);
                    if (!ddLot) return null;
                    const locations = ddLot.storage_locations ?? [];

                    const highlightIds = new Set<string>();
                    for (const [, grid] of drilldownGrids) {
                      for (const cell of grid.cells) {
                        if (cell.vial_id && cell.vial?.lot_id === drilldownLotId) {
                          highlightIds.add(cell.vial_id);
                        }
                      }
                    }

                    const storedCount = locations.reduce((s, l) => s + l.vial_count, 0);
                    const activeCount = (ddLot.vial_counts?.sealed ?? 0) + (ddLot.vial_counts?.opened ?? 0);
                    const unstoredCount = Math.max(0, activeCount - storedCount);

                    return (
                      <div className="lot-drilldown-panel">
                        <h4>Storage for Lot {ddLot.lot_number}</h4>
                        {drilldownLoading && <p className="info">Loading grids...</p>}

                        {locations.length === 0 && !drilldownLoading && (
                          <p className="empty">No vials in storage for this lot.</p>
                        )}

                        {unstoredCount > 0 && !drilldownLoading && (
                          <div className="lot-drilldown-stock">
                            <span>{unstoredCount} unstored vial{unstoredCount !== 1 ? "s" : ""}.</span>
                            {ddLot.vendor_barcode ? (
                              <>
                                <select value={drilldownStockUnitId} onChange={(e) => setDrilldownStockUnitId(e.target.value)}>
                                  <option value="">Select storage unit</option>
                                  {storageUnits.filter((u) => !u.is_temporary).map((u) => (
                                    <option key={u.id} value={u.id}>{u.name} ({u.rows}x{u.cols})</option>
                                  ))}
                                </select>
                                <button disabled={!drilldownStockUnitId || drilldownStockLoading} onClick={handleDrilldownStock}>
                                  {drilldownStockLoading ? "Stocking..." : "Stock 1 Vial"}
                                </button>
                              </>
                            ) : (
                              <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>Set vendor barcode to enable stocking.</span>
                            )}
                          </div>
                        )}

                        {locations.map((loc) => {
                          const grid = drilldownGrids.get(loc.unit_id);
                          if (!grid) return null;
                          return (
                            <div key={loc.unit_id} className="grid-container">
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-sm)" }}>
                                <h4 style={{ margin: 0 }}>{loc.unit_name}{grid.unit.temperature ? ` (${grid.unit.temperature})` : ""}</h4>
                                <button className="link-btn" onClick={() => navigate(`/storage?unitId=${loc.unit_id}`)} title="Open in Storage page">Manage</button>
                              </div>
                              <StorageGrid
                                rows={grid.unit.rows}
                                cols={grid.unit.cols}
                                cells={grid.cells}
                                highlightVialIds={highlightIds}
                                onCellClick={handleDrilldownCellClick}
                                clickMode="highlighted"
                                fluorochromes={fluorochromes}
                                popoutActions={getDrilldownPopoutActions}
                              />
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}
        {inventoryRows.length === 0 && (
          <p className="empty">No antibodies yet.</p>
        )}
      </div>

      <div className="inactive-section">
        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={showInactive}
            onChange={() => setShowInactive(!showInactive)}
          />
          Show inactive antibodies{inactiveRows.length > 0 ? ` (${inactiveRows.length})` : ""}
        </label>
        {showInactive && inactiveRows.length > 0 && (
          <table style={{ marginTop: "0.75rem" }}>
            <thead>
              <tr>
                <th>Antibody</th>
                <th>Designation</th>
                <th>Vendor</th>
                <th>Catalog #</th>
                {canEdit && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {inactiveRows.map((row) => {
                const fluoro = row.antibody.fluorochrome ? fluorochromeByName.get(
                  row.antibody.fluorochrome.toLowerCase()
                ) : undefined;
                const inactiveColor = fluoro?.color || row.antibody.color;
                return (
                  <tr key={row.antibody.id}>
                    <td>
                      {inactiveColor && (
                        <span
                          className="color-dot"
                          style={{ backgroundColor: inactiveColor }}
                        />
                      )}
                      {row.antibody.name || [row.antibody.target, row.antibody.fluorochrome].filter(Boolean).join("-") || "Unnamed"}
                      {row.antibody.name && row.antibody.target && row.antibody.fluorochrome && <span className="inventory-subtitle">{row.antibody.target}-{row.antibody.fluorochrome}</span>}
                    </td>
                    <td><span className={`badge badge-designation-${row.antibody.designation}`}>{row.antibody.designation.toUpperCase()}</span></td>
                    <td>{row.antibody.vendor || "—"}</td>
                    <td>{row.antibody.catalog_number || "—"}</td>
                    {canEdit && (
                      <td>
                        <button
                          className="archive-toggle-btn reactivate"
                          onClick={() => handleArchiveAntibody(row.antibody.id)}
                        >
                          Reactivate
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {showInactive && inactiveRows.length === 0 && (
          <p className="empty" style={{ marginTop: "0.5rem" }}>No inactive antibodies.</p>
        )}
      </div>

      {archiveAbPrompt && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Set antibody inactive">
          <div className="modal-content">
            <h2>Set Inactive: {archiveAbPrompt.label}</h2>
            <p className="page-desc">
              This antibody will be moved to the inactive list. You can reactivate it later.
            </p>
            <div className="form-group">
              <label>Note (optional)</label>
              <textarea
                value={archiveAbNote}
                onChange={(e) => setArchiveAbNote(e.target.value)}
                rows={3}
                placeholder='e.g., "Discontinued by vendor"'
              />
            </div>
            <div className="action-btns" style={{ marginTop: "1rem" }}>
              <button
                className="btn-red"
                onClick={() =>
                  handleArchiveAntibody(archiveAbPrompt.id, archiveAbNote.trim() || undefined)
                }
                disabled={archiveAbLoading}
              >
                {archiveAbLoading ? "Saving..." : "Set Inactive"}
              </button>
              <button
                className="btn-secondary"
                onClick={() => setArchiveAbPrompt(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmAction && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Confirm deplete">
          <div className="modal-content">
            <h2>Confirm Deplete</h2>
            <p className="page-desc">
              Lot <strong>{confirmAction.lotNumber}</strong> has{" "}
              <strong>{confirmAction.openedCount}</strong> opened and{" "}
              <strong>{confirmAction.sealedCount}</strong> sealed vial(s).
            </p>
            <div className="action-btns" style={{ marginTop: "1rem" }}>
              {confirmAction.openedCount > 0 && (
                <button
                  className="btn-red"
                  onClick={() => handleConfirmDeplete("opened")}
                  disabled={confirmLoading}
                >
                  {confirmLoading ? "Depleting..." : `Deplete Opened (${confirmAction.openedCount})`}
                </button>
              )}
              <button
                className="btn-red"
                onClick={() => handleConfirmDeplete("lot")}
                disabled={confirmLoading}
              >
                {confirmLoading ? "Depleting..." : `Deplete All (${confirmAction.totalCount})`}
              </button>
              <button className="btn-secondary" onClick={() => setConfirmAction(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {editAbId && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Edit antibody">
          <div className="modal-content">
            <h2>Edit Antibody</h2>
            <form onSubmit={handleEditAntibody} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div className="form-group">
                <label>Designation</label>
                <select
                  value={editAbForm.designation}
                  onChange={(e) =>
                    setEditAbForm({ ...editAbForm, designation: e.target.value as Designation })
                  }
                >
                  <option value="ruo">RUO</option>
                  <option value="asr">ASR</option>
                  <option value="ivd">IVD</option>
                </select>
              </div>
              {editAbForm.designation === "ivd" ? (
                <>
                  <div className="form-group">
                    <label>Product Name</label>
                    <input
                      value={editAbForm.name}
                      onChange={(e) => setEditAbForm({ ...editAbForm, name: e.target.value })}
                      placeholder="IVD product name"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Short Code (for grid cells)</label>
                    <input
                      value={editAbForm.short_code}
                      onChange={(e) => setEditAbForm({ ...editAbForm, short_code: e.target.value.slice(0, 5) })}
                      placeholder="e.g., MT34"
                      maxLength={5}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Color</label>
                    <input
                      type="color"
                      value={editAbForm.color}
                      onChange={(e) => setEditAbForm({ ...editAbForm, color: e.target.value })}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="form-group">
                    <label>Target</label>
                    <input
                      value={editAbForm.target}
                      onChange={(e) => setEditAbForm({ ...editAbForm, target: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Fluorochrome</label>
                    <select
                      value={editAbForm.fluorochrome_choice}
                      onChange={(e) =>
                        setEditAbForm({ ...editAbForm, fluorochrome_choice: e.target.value })
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
                  {editAbForm.fluorochrome_choice === NEW_FLUORO_VALUE && (
                    <>
                      <div className="form-group">
                        <label>New Fluorochrome Name</label>
                        <input
                          value={editAbForm.new_fluorochrome}
                          onChange={(e) =>
                            setEditAbForm({ ...editAbForm, new_fluorochrome: e.target.value })
                          }
                          required
                        />
                      </div>
                      <div className="form-group">
                        <label>Color</label>
                        <input
                          type="color"
                          value={editAbForm.new_fluoro_color}
                          onChange={(e) =>
                            setEditAbForm({ ...editAbForm, new_fluoro_color: e.target.value })
                          }
                        />
                      </div>
                    </>
                  )}
                  <div className="form-group">
                    <label>Clone</label>
                    <input
                      value={editAbForm.clone}
                      onChange={(e) => setEditAbForm({ ...editAbForm, clone: e.target.value })}
                    />
                  </div>
                </>
              )}
              <div className="form-group">
                <label>Vendor</label>
                <input
                  value={editAbForm.vendor}
                  onChange={(e) => setEditAbForm({ ...editAbForm, vendor: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Catalog #</label>
                <input
                  value={editAbForm.catalog_number}
                  onChange={(e) =>
                    setEditAbForm({ ...editAbForm, catalog_number: e.target.value })
                  }
                />
              </div>
              <div className="form-group">
                <label>Stability (days after opening)</label>
                <input
                  type="number"
                  min={1}
                  value={editAbForm.stability_days}
                  onChange={(e) =>
                    setEditAbForm({ ...editAbForm, stability_days: e.target.value })
                  }
                />
              </div>
              <div className="form-group">
                <label>Reorder Point <small style={{ fontWeight: "normal", color: "#888" }}>(total sealed vials)</small></label>
                <input
                  type="number"
                  min={1}
                  value={editAbForm.low_stock_threshold}
                  onChange={(e) =>
                    setEditAbForm({ ...editAbForm, low_stock_threshold: e.target.value })
                  }
                  title="Alert when total vials on hand drops below this level"
                />
              </div>
              <div className="form-group">
                <label>Min Ready Stock <small style={{ fontWeight: "normal", color: "#888" }}>(approved vials)</small></label>
                <input
                  type="number"
                  min={1}
                  value={editAbForm.approved_low_threshold}
                  onChange={(e) =>
                    setEditAbForm({ ...editAbForm, approved_low_threshold: e.target.value })
                  }
                  title="Alert when QC-approved vials drops below this level"
                />
              </div>
              <div className="action-btns" style={{ marginTop: "0.5rem" }}>
                <button type="submit" disabled={editAbLoading}>
                  {editAbLoading ? "Saving..." : "Save Changes"}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setEditAbId(null)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {editLot && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Edit lot">
          <div className="modal-content">
            <h2>Edit Lot</h2>
            <form onSubmit={handleEditLot} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div className="form-group">
                <label>Lot Number</label>
                <input
                  value={editLotForm.lot_number}
                  onChange={(e) => setEditLotForm({ ...editLotForm, lot_number: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Vendor Barcode</label>
                <input
                  value={editLotForm.vendor_barcode}
                  onChange={(e) => setEditLotForm({ ...editLotForm, vendor_barcode: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Expiration Date</label>
                <input
                  type="date"
                  value={editLotForm.expiration_date}
                  onChange={(e) => setEditLotForm({ ...editLotForm, expiration_date: e.target.value })}
                />
              </div>
              <div className="action-btns" style={{ marginTop: "0.5rem" }}>
                <button type="submit" disabled={editLotLoading}>
                  {editLotLoading ? "Saving..." : "Save Changes"}
                </button>
                <button type="button" className="btn-secondary" onClick={() => setEditLot(null)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {drilldownOpenTarget && (
        <OpenVialDialog
          cell={drilldownOpenTarget}
          loading={drilldownOpenLoading}
          onConfirm={handleDrilldownOpen}
          onDeplete={handleDrilldownDeplete}
          onViewLot={() => setDrilldownOpenTarget(null)}
          onCancel={() => setDrilldownOpenTarget(null)}
        />
      )}
      {modalLot && (
        <DocumentModal
          lot={modalLot}
          onClose={() => { setModalLot(null); setDocModalApproveAfter(false); }}
          onUpload={() => {
            setDocModalApproveAfter(false);
            loadData();
            setModalLot(null);
          }}
          onUploadAndApprove={docModalApproveAfter ? async () => {
            const lotId = modalLot.id;
            setModalLot(null);
            setDocModalApproveAfter(false);
            try {
              await api.patch(`/lots/${lotId}/qc`, { qc_status: "approved" });
            } catch { /* approval may still fail for other reasons */ }
            await loadData();
          } : undefined}
        />
      )}
      {qcBlockedLot && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="QC document required">
          <div className="modal-content">
            <h2>QC Document Required</h2>
            <p>
              Your lab requires a QC verification document to be uploaded before a lot can be approved.
              Please upload a QC document for Lot <strong>{qcBlockedLot.lot_number}</strong>.
            </p>
            <div className="action-btns" style={{ marginTop: "1rem" }}>
              <button
                onClick={() => {
                  const lot = qcBlockedLot;
                  setQcBlockedLot(null);
                  setDocModalApproveAfter(true);
                  setModalLot(lot);
                }}
              >
                Continue
              </button>
              <button className="btn-secondary" onClick={() => setQcBlockedLot(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {archiveWarning && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Archive lot warning">
          <div className="modal-content">
            <h2>Archive Lot {archiveWarning.lotNumber}?</h2>
            <p className="page-desc" style={{ color: "var(--warning-500)" }}>
              This lot still has <strong>{archiveWarning.sealedCount}</strong> sealed vial{archiveWarning.sealedCount === 1 ? "" : "s"} available and is not expired.
            </p>
            <p className="page-desc">
              Are you sure you want to archive this lot? Archived lots will no longer appear in storage grids.
            </p>
            <div className="action-btns" style={{ marginTop: "1rem" }}>
              <button
                className="btn-red"
                onClick={() => {
                  const { lotId, lotNumber } = archiveWarning;
                  setArchiveWarning(null);
                  setArchiveNote("");
                  setArchivePrompt({ lotId, lotNumber });
                }}
              >
                Yes, Continue to Archive
              </button>
              <button
                className="btn-secondary"
                onClick={() => setArchiveWarning(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {archivePrompt && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Archive lot">
          <div className="modal-content">
            <h2>Archive Lot {archivePrompt.lotNumber}</h2>
            <p className="page-desc">
              Add an optional note about why this lot is being archived.
            </p>
            <div className="form-group">
              <label>Archive Note (optional)</label>
              <textarea
                value={archiveNote}
                onChange={(e) => setArchiveNote(e.target.value)}
                rows={3}
                placeholder='e.g., "QC Failed"'
              />
            </div>
            <div className="action-btns" style={{ marginTop: "1rem" }}>
              <button
                className="btn-red"
                onClick={() =>
                  handleArchive(archivePrompt.lotId, archiveNote.trim() || undefined)
                }
                disabled={archiveLoading}
              >
                {archiveLoading ? "Archiving..." : "Archive Lot"}
              </button>
              <button
                className="btn-secondary"
                onClick={() => setArchivePrompt(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
