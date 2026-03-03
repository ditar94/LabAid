import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { Antibody, Fluorochrome, Lot, StorageGrid as StorageGridData, VialCounts } from "../api/types";
import { useAuth } from "../context/AuthContext";
import { useSharedData } from "../context/SharedDataContext";
import { useMediaQuery } from "../hooks/useMediaQuery";
import AntibodyCard from "../components/AntibodyCard";
import CopyButton from "../components/CopyButton";
import AntibodyForm, { NEW_FLUORO_VALUE, DEFAULT_FLUORO_COLOR, EMPTY_AB_FORM } from "../components/AntibodyForm";
import ViewToggle from "../components/ViewToggle";
import LotTable from "../components/LotTable";
import LotCardList from "../components/LotCardList";
import LotRegistrationForm, { EMPTY_LOT_FORM } from "../components/LotRegistrationForm";
import { StorageView } from "../components/storage";
import { useViewPreference } from "../hooks/useViewPreference";
import { Modal } from "../components/Modal";
import DocumentModal from "../components/DocumentModal";

// NEW_FLUORO_VALUE, DEFAULT_FLUORO_COLOR imported from AntibodyForm

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

const CARD_COLLAPSE_MS = 0;

export default function InventoryPage() {
  const { user, labSettings } = useAuth();
  const { labs, fluorochromes, storageUnits, selectedLab, setSelectedLab, refreshFluorochromes } = useSharedData();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const requestedAntibodyId = searchParams.get("antibodyId");
  const requestedLabId = searchParams.get("labId");
  const sealedOnly = labSettings.sealed_counts_only ?? false;
  const storageEnabled = labSettings.storage_enabled !== false;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [showAbForm, setShowAbForm] = useState(false);
  const [showLotForm, setShowLotForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  const { data: antibodies = [] } = useQuery({
    queryKey: ["antibodies", selectedLab, showInactive],
    queryFn: () => {
      const params: Record<string, string> = { lab_id: selectedLab };
      if (showInactive) params.include_inactive = "true";
      return api.get<Antibody[]>("/antibodies/", { params }).then(r => r.data);
    },
    enabled: !!selectedLab,
  });

  const { data: lots = [] } = useQuery({
    queryKey: ["lots", selectedLab, { includeArchived: true }],
    queryFn: () =>
      api.get<Lot[]>("/lots/", { params: { lab_id: selectedLab, include_archived: "true" } }).then(r => r.data),
    enabled: !!selectedLab,
  });

  const [designationFilter, setDesignationFilter] = useState<string>("");
  const [editAbId, setEditAbId] = useState<string | null>(null);
  const [editAbForm, setEditAbForm] = useState(EMPTY_AB_FORM);
  const [editAbLoading, setEditAbLoading] = useState(false);
  const [modalLot, setModalLot] = useState<Lot | null>(null);
  const [qcBlockedLot, setQcBlockedLot] = useState<Lot | null>(null);
  const [qcConfirmLot, setQcConfirmLot] = useState<Lot | null>(null);
  const [docModalApproveAfter, setDocModalApproveAfter] = useState(false);

  // Lot drill-down
  const [drilldownLotId, setDrilldownLotId] = useState<string | null>(null);
  const [drilldownGrids, setDrilldownGrids] = useState<Map<string, StorageGridData>>(new Map());
  const [drilldownLoading, setDrilldownLoading] = useState(false);
  const [drilldownStockUnitId, setDrilldownStockUnitId] = useState("");
  const [drilldownStockLoading, setDrilldownStockLoading] = useState(false);
  const [lotFormAvailableSlots, setLotFormAvailableSlots] = useState<number | null>(null);
  const [editLot, setEditLot] = useState<Lot | null>(null);
  const [editLotForm, setEditLotForm] = useState({ lot_number: "", vendor_barcode: "", expiration_date: "" });
  const [editLotLoading, setEditLotLoading] = useState(false);

  const [abForm, setAbForm] = useState(EMPTY_AB_FORM);

  // Lot creation form — uses shared LotFormValues type
  const [lotForm, setLotForm] = useState(EMPTY_LOT_FORM);

  const canEdit =
    user?.role === "super_admin" ||
    user?.role === "lab_admin" ||
    user?.role === "supervisor";
  const canReceive = canEdit || user?.role === "tech";
  const canQC = canEdit;
  const isMobile = useMediaQuery("(max-width: 768px)");
  // Card / list view preference (synced with SearchPage via shared key)
  const [view, setView] = useViewPreference();
  const collapseTimerRef = useRef<number | null>(null);

  const clearCollapseTimer = useCallback(() => {
    if (collapseTimerRef.current !== null) {
      window.clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearCollapseTimer(), [clearCollapseTimer]);

  const handleCardToggle = useCallback((antibodyId: string) => {
    if (expandedId === antibodyId) {
      if (closingId === antibodyId) {
        clearCollapseTimer();
        setClosingId(null);
        return;
      }
      clearCollapseTimer();
      setClosingId(antibodyId);
      collapseTimerRef.current = window.setTimeout(() => {
        setExpandedId((current) => (current === antibodyId ? null : current));
        setClosingId((current) => (current === antibodyId ? null : current));
        collapseTimerRef.current = null;
      }, CARD_COLLAPSE_MS);
      return;
    }

    clearCollapseTimer();
    setClosingId(null);
    setExpandedId(antibodyId);
  }, [expandedId, closingId, clearCollapseTimer]);

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
  }, [requestedLabId, labs, setSelectedLab]);

  const invalidateInventory = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["antibodies"] });
    queryClient.invalidateQueries({ queryKey: ["lots"] });
    queryClient.invalidateQueries({ queryKey: ["temp-storage"] });
  }, [queryClient]);

  useEffect(() => {
    if (!requestedAntibodyId) return;
    if (autoExpandedId === requestedAntibodyId) return;
    const exists = antibodies.some((ab) => ab.id === requestedAntibodyId);
    if (!exists) return;
    clearCollapseTimer();
    setClosingId(null);
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
  }, [requestedAntibodyId, autoExpandedId, antibodies, clearCollapseTimer]);

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

      // Expiring badge: has lots expiring within 30 days (only if lot still has usable vials)
      const now = new Date();
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + expiryWarnDays);
      const lotsWithVials = activAbLots.filter(
        (l) => (l.vial_counts?.sealed ?? 0) + (l.vial_counts?.opened ?? 0) > 0
      );
      const hasExpiring = lotsWithVials.some((l) => {
        if (!l.expiration_date) return false;
        const exp = new Date(l.expiration_date);
        return exp <= cutoff && exp >= now;
      });
      const hasExpired = lotsWithVials.some((l) => {
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
      return;
    }
    setDrilldownLotId(lot.id);
    setDrilldownGrids(new Map());
    setDrilldownStockUnitId("");
    if (!storageEnabled) return;
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

  // Refresh handler for lot drilldown — reloads data and re-opens drilldown
  const drilldownLotIdRef = useRef(drilldownLotId);
  drilldownLotIdRef.current = drilldownLotId;
  const lotsRef = useRef(lots);
  lotsRef.current = lots;

  const handleDrilldownRefresh = async () => {
    invalidateInventory();
    const lotId = drilldownLotIdRef.current;
    const lot = lotsRef.current.find((l) => l.id === lotId);
    if (lot) {
      setDrilldownLotId(null);
      setTimeout(() => handleLotClick(lot), 50);
    }
  };

  // ── Drilldown stock handler ──────────────────────────────────────────
  const handleDrilldownStock = async () => {
    const lot = lots.find((l) => l.id === drilldownLotId);
    if (!lot?.vendor_barcode || !drilldownStockUnitId) return;
    setDrilldownStockLoading(true);
    try {
      await api.post(`/storage/units/${drilldownStockUnitId}/stock`, { barcode: lot.vendor_barcode });
      setMessage("Vial stocked successfully.");
      invalidateInventory();
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

      setAbForm(EMPTY_AB_FORM);
      setShowAbForm(false);
      setMessage("Antibody created.");
      invalidateInventory();
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
      invalidateInventory();
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
      invalidateInventory();
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
      setLotForm(EMPTY_LOT_FORM);
      setShowLotForm(false);
      setMessage("Lot created.");
      invalidateInventory();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to create lot");
    } finally {
      setLoading(false);
    }
  };

  const requestQCApprove = (lotId: string) => {
    const lot = lots.find((l) => l.id === lotId) || null;
    setQcConfirmLot(lot);
  };

  const updateQC = async (lotId: string, status: "approved") => {
    try {
      const { data: updatedLot } = await api.patch<Lot>(`/lots/${lotId}/qc`, { qc_status: status });
      queryClient.setQueryData<Lot[]>(
        ["lots", selectedLab, { includeArchived: true }],
        (old) => old?.map((l) => (l.id === lotId ? updatedLot : l)),
      );
      invalidateInventory();
      setQcConfirmLot(null);
    } catch (err: any) {
      if (err.response?.status === 409) {
        setQcConfirmLot(null);
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
      invalidateInventory();
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
      invalidateInventory();
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
      invalidateInventory();
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
      invalidateInventory();
    } catch {
      // keep UI stable on failure
    } finally {
      setConfirmLoading(false);
    }
  };

  // Shared expanded content for both card and list views
  const renderExpandedContent = (row: InventoryRow) => {
    const allAbLots = lotsByAntibody.get(row.antibody.id) || [];
    const abLots = showInactiveLots ? allAbLots : allAbLots.filter((l) => !isLotInactive(l));
    return (
      <>
        <div className="detail-header" style={{ justifyContent: "space-between" }}>
          {canEdit ? (
            <button className="btn-chip btn-chip-secondary" onClick={() => openEditForm(row.antibody)}>
              Edit Antibody
            </button>
          ) : <span />}
          {canReceive && (
            <button className="btn-chip btn-chip-primary" onClick={() => setShowLotForm(true)}>
              + New Lot
            </button>
          )}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: "var(--space-sm)" }}>
          <input
            type="checkbox"
            checked={showInactiveLots}
            onChange={() => setShowInactiveLots(!showInactiveLots)}
          />
          <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>Show inactive</span>
        </label>

        {abLots.length > 0 ? (
          isMobile ? (
            <LotCardList
              lots={abLots}
              sealedOnly={sealedOnly}
              canQC={canQC}
              qcDocRequired={labSettings.qc_doc_required ?? false}
              storageEnabled={storageEnabled}
              lotAgeBadgeMap={lotAgeBadgeMap}
              onApproveQC={(id) => requestQCApprove(id)}
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
              onConsolidate={storageEnabled ? (lot) => {
                const unitId = lot.storage_locations?.[0]?.unit_id;
                if (unitId) navigate(`/storage?lotId=${lot.id}&unitId=${unitId}`);
              } : undefined}
              onLotClick={handleLotClick}
              selectedLotId={drilldownLotId}
            />
          ) : (
            <LotTable
              lots={abLots}
              sealedOnly={sealedOnly}
              canQC={canQC}
              qcDocRequired={labSettings.qc_doc_required ?? false}
              storageEnabled={storageEnabled}
              lotAgeBadgeMap={lotAgeBadgeMap}
              onApproveQC={(id) => requestQCApprove(id)}
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
              onConsolidate={storageEnabled ? (lot) => {
                const unitId = lot.storage_locations?.[0]?.unit_id;
                if (unitId) navigate(`/storage?lotId=${lot.id}&unitId=${unitId}`);
              } : undefined}
              onLotClick={handleLotClick}
              selectedLotId={drilldownLotId}
            />
          )
        ) : (
          <p className="empty">No lots for this antibody yet.</p>
        )}

        {storageEnabled && drilldownLotId && (() => {
          const ddLot = abLots.find((l) => l.id === drilldownLotId);
          if (!ddLot) return null;
          const locations = ddLot.storage_locations ?? [];
          const storedCount = locations.length > 0
            ? locations.reduce((s, l) => s + l.vial_count, 0)
            : undefined;
          const closeDrilldown = () => { setDrilldownLotId(null); setDrilldownGrids(new Map()); };
          return (
            <StorageView
              grids={Array.from(drilldownGrids.values())}
              fluorochromes={fluorochromes}
              loading={drilldownLoading}
              lotFilter={{ lotId: ddLot.id, lotNumber: ddLot.lot_number }}
              stockControl={{
                activeVialCount: (ddLot.vial_counts?.sealed ?? 0) + (ddLot.vial_counts?.opened ?? 0),
                storedVialCount: storedCount,
                hasVendorBarcode: !!ddLot.vendor_barcode,
                storageUnits,
                stockUnitId: drilldownStockUnitId,
                onStockUnitChange: setDrilldownStockUnitId,
                onStock: handleDrilldownStock,
                stockLoading: drilldownStockLoading,
              }}
              onRefresh={handleDrilldownRefresh}
              onClose={closeDrilldown}
            />
          );
        })()}
      </>
    );
  };

  const cardRows = inventoryRows;

  // Helper to render a single antibody card with dynamic grid positioning
  const renderCard = (row: typeof inventoryRows[0]) => {
    const isExpanded = expandedId === row.antibody.id;
    const isCollapsing = closingId === row.antibody.id;
    const fluoro = row.antibody.fluorochrome ? fluorochromeByName.get(
      row.antibody.fluorochrome.toLowerCase()
    ) : undefined;
    const abColor = fluoro?.color || row.antibody.color || undefined;

    return (
      <div
        key={row.antibody.id}
        className="inventory-card-motion"
      >
        <AntibodyCard
          antibody={row.antibody}
          counts={row}
          badges={antibodyBadges.get(row.antibody.id)}
          fluoroColor={abColor}
          sealedOnly={sealedOnly}
          expanded={isExpanded}
          collapsing={isCollapsing}
          onClick={() => handleCardToggle(row.antibody.id)}
          dataAntibodyId={row.antibody.id}
          showActiveToggle={canEdit}
          onToggleActive={() => {
            setArchiveAbNote("");
            setArchiveAbPrompt({
              id: row.antibody.id,
              label: row.antibody.name || [row.antibody.target, row.antibody.fluorochrome].filter(Boolean).join("-") || "Unnamed",
            });
          }}
          canEditColor={canEdit && !!row.antibody.fluorochrome}
          onColorChange={(color) => handleUpdateFluoroColor(row.antibody.fluorochrome!, color)}
        >
          {isExpanded && renderExpandedContent(row)}
        </AntibodyCard>
      </div>
    );
  };

  return (
    <div>
      <div className="page-header">
        <h1>Inventory</h1>
        <div className="filters">
          <ViewToggle view={view} onChange={setView} />
          {user?.role === "super_admin" && labs.length > 0 && (
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
            <button className="btn-chip btn-chip-primary" onClick={() => setShowAbForm(!showAbForm)}>
              {showAbForm ? "Cancel" : "+ New Antibody"}
            </button>
          )}
        </div>
      </div>

      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}

      {showAbForm && (
        <Modal onClose={() => setShowAbForm(false)} ariaLabel="New antibody">
          <div className="modal-content">
            <h2>New Antibody</h2>
            <form onSubmit={handleCreateAntibody} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <AntibodyForm
                values={abForm}
                onChange={setAbForm}
                fluorochromes={fluorochromes}
                layout="stacked"
              />
              <div className="action-btns" style={{ marginTop: "0.5rem" }}>
                <button type="submit" disabled={loading}>
                  {loading ? "Creating..." : "Create Antibody"}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowAbForm(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}

      {/* ── Card view ── */}
      {view === "card" && (
        <div className="inventory-grid stagger-reveal">
          {cardRows.map((row) => renderCard(row))}
          {inventoryRows.length === 0 && (
            <p className="empty">No antibodies yet.</p>
          )}
        </div>
      )}

      {/* ── List/table view ── */}
      {view === "list" && (
        inventoryRows.length === 0 ? (
          <p className="empty">No antibodies yet.</p>
        ) : (
          <table className="search-results-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Fluorochrome</th>
                <th>Clone</th>
                <th>Vendor</th>
                <th>Catalog #</th>
                <th>Sealed</th>
                {!sealedOnly && <th>Opened</th>}
                {!sealedOnly && <th>Depleted</th>}
                <th>Lots</th>
              </tr>
            </thead>
            <tbody>
              {inventoryRows.map((row) => {
                const ab = row.antibody;
                const fluoro = ab.fluorochrome ? fluorochromeByName.get(ab.fluorochrome.toLowerCase()) : undefined;
                const abColor = fluoro?.color || ab.color || undefined;
                const badges = antibodyBadges.get(ab.id);
                const expanded = expandedId === ab.id;
                const colCount = 6 + (sealedOnly ? 0 : 2) + 1;
                return (
                  <Fragment key={ab.id}>
                    <tr
                      className={`clickable-row${expanded ? " active" : ""}${row.lowStock ? " low-stock" : ""}`}
                      onClick={() => {
                        clearCollapseTimer();
                        setClosingId(null);
                        setExpandedId(expanded ? null : ab.id);
                      }}
                      data-antibody-id={ab.id}
                    >
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {abColor && <span className="color-dot" style={{ backgroundColor: abColor }} />}
                          <span>
                            {ab.name || ab.target || "\u2014"}
                            {ab.name && ab.target && <span className="inventory-subtitle">{ab.target}</span>}
                          </span>
                          <span className={`badge badge-designation-${ab.designation}`} style={{ fontSize: "0.7em" }}>{ab.designation.toUpperCase()}</span>
                          {badges?.map((b, i) => (
                            <span key={i} className={`badge badge-${b.color}`} style={{ fontSize: "0.7em" }}>{b.label}</span>
                          ))}
                        </div>
                      </td>
                      <td>{ab.fluorochrome || "\u2014"}</td>
                      <td>{ab.clone || "\u2014"}</td>
                      <td>{ab.vendor || "\u2014"}</td>
                      <td>{ab.catalog_number ? <>{ab.catalog_number} <CopyButton value={ab.catalog_number} /></> : "\u2014"}</td>
                      <td>{row.sealed}</td>
                      {!sealedOnly && <td>{row.opened}</td>}
                      {!sealedOnly && <td>{row.depleted}</td>}
                      <td>{row.lots}</td>
                    </tr>
                    {expanded && (
                      <tr className="expanded-detail-row">
                        <td colSpan={colCount} style={{ padding: 0 }}>
                          <div className="locator-panel" data-antibody-id={ab.id}>
                            {renderExpandedContent(row)}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )
      )}

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
                    <td>{row.antibody.catalog_number ? <>{row.antibody.catalog_number} <CopyButton value={row.antibody.catalog_number} /></> : "—"}</td>
                    {canEdit && (
                      <td>
                        <button
                          className="btn-chip btn-chip-primary"
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
        <Modal onClose={() => setArchiveAbPrompt(null)} ariaLabel="Set antibody inactive">
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
                className="btn-danger"
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
        </Modal>
      )}
      {confirmAction && (
        <Modal onClose={() => setConfirmAction(null)} ariaLabel="Confirm deplete">
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
                  className="btn-danger"
                  onClick={() => handleConfirmDeplete("opened")}
                  disabled={confirmLoading}
                >
                  {confirmLoading ? "Depleting..." : `Deplete Opened (${confirmAction.openedCount})`}
                </button>
              )}
              <button
                className="btn-danger"
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
        </Modal>
      )}
      {editAbId && (
        <Modal onClose={() => setEditAbId(null)} ariaLabel="Edit antibody">
          <div className="modal-content">
            <h2>Edit Antibody</h2>
            <form onSubmit={handleEditAntibody} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <AntibodyForm
                values={editAbForm}
                onChange={setEditAbForm}
                fluorochromes={fluorochromes}
                layout="stacked"
              />
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
        </Modal>
      )}
      {showLotForm && (
        <Modal onClose={() => setShowLotForm(false)} ariaLabel="New lot">
          <div className="modal-content">
            <h2>New Lot</h2>
            <form onSubmit={handleCreateLot} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <LotRegistrationForm
                values={lotForm}
                onChange={setLotForm}
                storageUnits={storageUnits}
                storageEnabled={storageEnabled}
                layout="stacked"
                availableSlots={lotFormAvailableSlots}
                onStorageChange={(unitId) => {
                  if (unitId) {
                    api.get(`/storage/units/${unitId}/available-slots`)
                      .then((r) => setLotFormAvailableSlots(r.data.available_cells))
                      .catch(() => setLotFormAvailableSlots(null));
                  } else {
                    setLotFormAvailableSlots(null);
                  }
                }}
              />
              <div className="action-btns" style={{ marginTop: "0.5rem" }}>
                <button type="submit" disabled={loading}>
                  {loading ? "Saving..." : "Create Lot"}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowLotForm(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}
      {editLot && (
        <Modal onClose={() => setEditLot(null)} ariaLabel="Edit lot">
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
        </Modal>
      )}
      {modalLot && (
        <DocumentModal
          lot={modalLot}
          qcDocRequired={labSettings.qc_doc_required ?? false}
          onClose={() => { setModalLot(null); setDocModalApproveAfter(false); }}
          onDocumentsChange={() => { invalidateInventory(); }}
          onUpload={() => {
            setDocModalApproveAfter(false);
            invalidateInventory();
            setModalLot(null);
          }}
          onUploadAndApprove={docModalApproveAfter ? async () => {
            const lotId = modalLot.id;
            let updatedLot: Lot;
            try {
              const { data } = await api.patch<Lot>(`/lots/${lotId}/qc`, { qc_status: "approved" });
              updatedLot = data;
            } catch (err: any) {
              throw new Error(
                err?.response?.data?.detail ||
                "Upload succeeded, but lot approval failed.",
              );
            }
            queryClient.setQueryData<Lot[]>(
              ["lots", selectedLab, { includeArchived: true }],
              (old) => old?.map((l) => (l.id === lotId ? updatedLot : l)),
            );
            invalidateInventory();
            setModalLot(null);
            setDocModalApproveAfter(false);
          } : undefined}
        />
      )}
      {qcBlockedLot && (
        <Modal onClose={() => setQcBlockedLot(null)} ariaLabel="QC document required">
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
        </Modal>
      )}
      {qcConfirmLot && (
        <Modal onClose={() => setQcConfirmLot(null)} ariaLabel="Confirm QC approval">
          <div className="modal-content">
            <h2>Approve QC for Lot {qcConfirmLot.lot_number}?</h2>
            <p className="page-desc">
              This will mark the lot as QC approved. This action is recorded in the audit log.
            </p>
            <div className="action-btns" style={{ marginTop: "var(--space-lg)" }}>
              <button className="btn-chip btn-chip-success" onClick={() => updateQC(qcConfirmLot.id, "approved")}>
                Approve
              </button>
              <button className="btn-secondary" onClick={() => setQcConfirmLot(null)}>Cancel</button>
            </div>
          </div>
        </Modal>
      )}
      {archiveWarning && (
        <Modal onClose={() => setArchiveWarning(null)} ariaLabel="Archive lot warning">
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
                className="btn-danger"
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
        </Modal>
      )}
      {archivePrompt && (
        <Modal onClose={() => setArchivePrompt(null)} ariaLabel="Archive lot">
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
                className="btn-danger"
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
        </Modal>
      )}
    </div>
  );
}
