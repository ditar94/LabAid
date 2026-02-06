import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client";
import type {
  Antibody, Lot, Lab, Fluorochrome, TempStorageSummary, TempStorageSummaryItem,
  StorageGrid as StorageGridData, StorageCell, StorageUnit, VialMoveResult,
} from "../api/types";
import StorageGrid from "../components/StorageGrid";
import { useAuth } from "../context/AuthContext";
import { useMediaQuery } from "../hooks/useMediaQuery";
import {
  Clock,
  Thermometer,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
} from "lucide-react";
import { useToast } from "../context/ToastContext";

const DEFAULT_EXPIRY_WARN_DAYS = 30;
const CURRENT_LOT_EXPIRY_WARN_DAYS = 7;

export default function DashboardPage() {
  const { user, labSettings, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [labs, setLabs] = useState<Lab[]>([]);
  const [selectedLab, setSelectedLab] = useState<string>("");
  const [antibodies, setAntibodies] = useState<Antibody[]>([]);
  const [selectedCard, setSelectedCard] = useState<"pending" | "low" | "expiring" | "temp" | null>(null);
  const [pendingLots, setPendingLots] = useState<Lot[]>([]);
  const [expiringLots, setExpiringLots] = useState<Lot[]>([]);
  const [lowStock, setLowStock] = useState<Antibody[]>([]);
  const [fluorochromes, setFluorochromes] = useState<Fluorochrome[]>([]);
  const [allLots, setAllLots] = useState<Lot[]>([]);
  const [tempSummary, setTempSummary] = useState<TempStorageSummary | null>(null);

  // Temp storage drill-down + move
  const [tempSelectedItem, setTempSelectedItem] = useState<TempStorageSummaryItem | null>(null);
  const [tempGrid, setTempGrid] = useState<StorageGridData | null>(null);
  const [tempGridLoading, setTempGridLoading] = useState(false);
  const [tempMoveSelectedIds, setTempMoveSelectedIds] = useState<Set<string>>(new Set());
  const [tempMoveTargetUnitId, setTempMoveTargetUnitId] = useState("");
  const [tempMoveTargetGrid, setTempMoveTargetGrid] = useState<StorageGridData | null>(null);
  const [tempDestMode, setTempDestMode] = useState<"auto" | "start" | "pick">("auto");
  const [tempDestStartCellId, setTempDestStartCellId] = useState<string | null>(null);
  const [tempDestPickedCellIds, setTempDestPickedCellIds] = useState<Set<string>>(new Set());
  const [tempMoveLoading, setTempMoveLoading] = useState(false);
  const [storageUnits, setStorageUnits] = useState<StorageUnit[]>([]);
  const [tempMessage, setTempMessage] = useState<string | null>(null);
  const [tempError, setTempError] = useState<string | null>(null);

  const isMobile = useMediaQuery("(max-width: 768px)");
  const { addToast } = useToast();

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
    if (!selectedLab) return;
    const params: Record<string, string> = { lab_id: selectedLab };
    Promise.all([
      api.get<Antibody[]>("/antibodies/", { params }),
      api.get<Lot[]>("/lots/", { params }),
      api.get<Antibody[]>("/antibodies/low-stock", { params }),
      api.get<Fluorochrome[]>("/fluorochromes/", { params }),
      api.get<TempStorageSummary>("/storage/temp-storage/summary", { params }),
    ]).then(([abRes, lotRes, lowStockRes, fluoroRes, tempRes]) => {
      const antibodies = abRes.data;
      const lots = lotRes.data;

      setAntibodies(antibodies);
      setAllLots(lots);
      setLowStock(lowStockRes.data);
      setFluorochromes(fluoroRes.data);
      setPendingLots(lots.filter((l) => l.qc_status === "pending"));
      setTempSummary(tempRes.data);

      // Expiring lots
      const expiryWarnDays = labSettings.expiry_warn_days ?? DEFAULT_EXPIRY_WARN_DAYS;
      const now = new Date();
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + expiryWarnDays);
      const expiring = lots
        .filter((l) => {
          if (!l.expiration_date) return false;
          const exp = new Date(l.expiration_date);
          return exp <= cutoff && exp >= now;
        })
        .sort(
          (a, b) =>
            new Date(a.expiration_date!).getTime() -
            new Date(b.expiration_date!).getTime()
        );
      const expired = lots
        .filter((l) => {
          if (!l.expiration_date) return false;
          return new Date(l.expiration_date) < now;
        })
        .sort(
          (a, b) =>
            new Date(a.expiration_date!).getTime() -
            new Date(b.expiration_date!).getTime()
        );
      setExpiringLots([...expired, ...expiring]);
    });
  }, [user, selectedLab, labSettings.expiry_warn_days]);

  const daysUntil = (dateStr: string) => {
    const diff = Math.ceil(
      (new Date(dateStr).getTime() - new Date().getTime()) /
        (1000 * 60 * 60 * 24)
    );
    if (diff < 0) return `${Math.abs(diff)}d overdue`;
    if (diff === 0) return "today";
    return `${diff}d`;
  };

  const fluoroMap = new Map<string, string>();
  for (const f of fluorochromes) {
    fluoroMap.set(f.name.toLowerCase(), f.color);
  }
  const antibodyMap = new Map(antibodies.map((ab) => [ab.id, ab]));
  const lotLabel = (lot: Lot) => {
    if (lot.antibody_target && lot.antibody_fluorochrome) {
      return `${lot.antibody_target}-${lot.antibody_fluorochrome}`;
    }
    const ab = antibodyMap.get(lot.antibody_id);
    return ab ? `${ab.target}-${ab.fluorochrome}` : "—";
  };
  const lotVendor = (lot: Lot) => antibodyMap.get(lot.antibody_id)?.vendor || "—";

  // ── Badge computations ──

  // Helper: compute sealed vial totals per antibody
  const abVialStats = useMemo(() => {
    const map = new Map<string, { total: number; approved: number; pending: number }>();
    for (const ab of antibodies) {
      const abLots = allLots.filter(
        (l) => l.antibody_id === ab.id && !l.is_archived && l.qc_status !== "failed"
      );
      const total = abLots.reduce(
        (s, l) => s + (l.vial_counts?.sealed ?? 0), 0
      );
      const approved = abLots
        .filter((l) => l.qc_status === "approved")
        .reduce((s, l) => s + (l.vial_counts?.sealed ?? 0), 0);
      const pending = abLots
        .filter((l) => l.qc_status === "pending")
        .reduce((s, l) => s + (l.vial_counts?.sealed ?? 0), 0);
      map.set(ab.id, { total, approved, pending });
    }
    return map;
  }, [antibodies, allLots]);

  // Pending QC badges: contextual — "Low Approved Stock" means approving THIS lot is urgent
  const pendingQCBadges = useMemo(() => {
    const badges = new Map<string, string[]>();
    const now = new Date();
    const warnCutoff = new Date();
    warnCutoff.setDate(warnCutoff.getDate() + CURRENT_LOT_EXPIRY_WARN_DAYS);

    for (const lot of pendingLots) {
      const ab = antibodyMap.get(lot.antibody_id);
      if (!ab) continue;
      const lotBadges: string[] = [];
      const stats = abVialStats.get(ab.id);

      // Approved sealed vials below min ready stock — approving this lot is urgent
      if (ab.approved_low_threshold != null && stats && stats.approved < ab.approved_low_threshold) {
        lotBadges.push("Low Approved Stock");
      }

      // Current approved lot expiring within 7 days — this pending lot may be needed soon
      if (!lotBadges.length) {
        const approvedLots = allLots
          .filter(
            (l) =>
              l.antibody_id === ab.id &&
              l.qc_status === "approved" &&
              !l.is_archived &&
              ((l.vial_counts?.sealed ?? 0) + (l.vial_counts?.opened ?? 0)) > 0
          )
          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

        const currentLot = approvedLots[0];
        if (currentLot?.expiration_date) {
          const exp = new Date(currentLot.expiration_date);
          if (exp <= warnCutoff && exp >= now) {
            lotBadges.push("Low Approved Stock");
          }
        }
      }

      if (lotBadges.length) {
        badges.set(lot.id, lotBadges);
      }
    }
    return badges;
  }, [pendingLots, allLots, antibodyMap, abVialStats]);

  // Expiring lots badges: contextual — what backup exists for this antibody?
  const expiringLotBadges = useMemo(() => {
    const badges = new Map<string, { label: string; color: string }[]>();
    for (const lot of expiringLots) {
      const lotBadges: { label: string; color: string }[] = [];
      const otherLots = allLots.filter(
        (l) =>
          l.antibody_id === lot.antibody_id &&
          l.id !== lot.id &&
          !l.is_archived &&
          (l.vial_counts?.sealed ?? 0) > 0
      );

      if (otherLots.length === 0) {
        lotBadges.push({ label: "No Other Lots", color: "badge-red" });
      } else {
        const hasApproved = otherLots.some((l) => l.qc_status === "approved");
        const hasPending = otherLots.some((l) => l.qc_status === "pending");
        if (hasApproved) {
          lotBadges.push({ label: "Backup Lot Available", color: "badge-green" });
        } else if (hasPending) {
          lotBadges.push({ label: "QC New Lot(s) to Replace", color: "badge-yellow" });
        }
      }

      if (lotBadges.length) {
        badges.set(lot.id, lotBadges);
      }
    }
    return badges;
  }, [expiringLots, allLots]);

  // Low stock badges: contextual — reorder from vendor, or just approve pending lots?
  const lowStockBadges = useMemo(() => {
    const badges = new Map<string, { label: string; color: string }>();
    for (const ab of lowStock) {
      const stats = abVialStats.get(ab.id);
      if (!stats) continue;

      // If total sealed (including pending QC) below reorder point → must reorder
      if (ab.low_stock_threshold != null && stats.total < ab.low_stock_threshold) {
        const reorderLabel = stats.total === 0
          ? "No Stock \u2014 Reorder"
          : `Low Stock (${stats.total} vial${stats.total === 1 ? "" : "s"}) \u2014 Reorder`;
        badges.set(ab.id, { label: reorderLabel, color: "badge-red" });
      }
      // If approved sealed are low but total is above reorder point → QC will fix it
      else if (ab.approved_low_threshold != null && stats.approved < ab.approved_low_threshold) {
        badges.set(ab.id, { label: "QC New Lot(s) to Resolve", color: "badge-yellow" });
      }
    }
    return badges;
  }, [lowStock, abVialStats]);

  const cards = [
    { key: "pending", label: "Pending QC", count: pendingLots.length, className: "warn", icon: Clock },
    { key: "temp", label: "Temp Storage", count: tempSummary?.total_vials ?? 0, className: "warn", icon: Thermometer },
    { key: "low", label: "Low Stock", count: lowStock.length, className: "danger", icon: AlertTriangle },
    { key: "expiring", label: "Expiring Lots", count: expiringLots.length, className: "warn", icon: CalendarClock },
  ] as const;

  const navigateToInventory = (antibodyId: string) => {
    const params = new URLSearchParams();
    params.set("antibodyId", antibodyId);
    if (user?.role === "super_admin" && selectedLab) {
      params.set("labId", selectedLab);
    }
    navigate(`/inventory?${params.toString()}`);
  };

  const handleRowKey = (e: React.KeyboardEvent, antibodyId: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      navigateToInventory(antibodyId);
    }
  };

  // ── Temp storage drill-down handlers ──

  const handleTempLotClick = useCallback(async (item: TempStorageSummaryItem) => {
    if (tempSelectedItem?.lot_id === item.lot_id) {
      setTempSelectedItem(null);
      setTempGrid(null);
      setTempMoveSelectedIds(new Set());
      setTempMoveTargetUnitId("");
      setTempMoveTargetGrid(null);
      setTempDestMode("auto");
      setTempDestStartCellId(null);
      setTempDestPickedCellIds(new Set());
      setTempMessage(null);
      setTempError(null);
      return;
    }

    setTempSelectedItem(item);
    setTempMoveSelectedIds(new Set(item.vial_ids));
    setTempMoveTargetUnitId("");
    setTempMoveTargetGrid(null);
    setTempDestStartCellId(null);
    setTempMessage(null);
    setTempError(null);

    if (!tempSummary?.unit_id) return;

    setTempGridLoading(true);
    try {
      const params: Record<string, string> = {};
      if (selectedLab) params.lab_id = selectedLab;
      const [gridRes, unitsRes] = await Promise.all([
        api.get<StorageGridData>(`/storage/units/${tempSummary.unit_id}/grid`),
        api.get<StorageUnit[]>("/storage/units", { params }),
      ]);
      setTempGrid(gridRes.data);
      setStorageUnits(unitsRes.data.filter((u) => !u.is_temporary));
    } catch (err: any) {
      setTempError(err.response?.data?.detail || "Failed to load temp storage grid");
    } finally {
      setTempGridLoading(false);
    }
  }, [tempSelectedItem, tempSummary, selectedLab]);

  const handleTempMoveCellClick = useCallback((cell: StorageCell) => {
    if (!cell.vial_id) return;
    setTempMoveSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(cell.vial_id!)) next.delete(cell.vial_id!);
      else next.add(cell.vial_id!);
      return next;
    });
  }, []);

  const handleTempTargetUnitChange = useCallback(async (unitId: string) => {
    setTempMoveTargetUnitId(unitId);
    setTempDestMode("auto");
    setTempDestStartCellId(null);
    setTempDestPickedCellIds(new Set());
    setTempMoveTargetGrid(null);
    if (!unitId) return;
    try {
      const res = await api.get<StorageGridData>(`/storage/units/${unitId}/grid`);
      setTempMoveTargetGrid(res.data);
    } catch {
      setTempError("Failed to load target grid");
    }
  }, []);

  const handleTempTargetCellClick = (cell: StorageCell) => {
    if (cell.vial_id) return;
    if (tempDestMode === "auto") {
      setTempDestMode("start");
      setTempDestStartCellId(cell.id);
    } else if (tempDestMode === "start") {
      if (tempDestStartCellId === cell.id) {
        // Toggle off — back to auto
        setTempDestMode("auto");
        setTempDestStartCellId(null);
      } else {
        // Different cell — switch to pick mode with both
        setTempDestMode("pick");
        setTempDestPickedCellIds(new Set([tempDestStartCellId!, cell.id]));
        setTempDestStartCellId(null);
      }
    } else {
      // pick mode — toggle cell
      setTempDestPickedCellIds((prev) => {
        const next = new Set(prev);
        if (next.has(cell.id)) next.delete(cell.id);
        else next.add(cell.id);
        return next;
      });
    }
  };

  // Compute preview cells for target grid (start mode only)
  const tempPreviewCellIds = useMemo(() => {
    if (tempDestMode !== "start" || !tempMoveTargetGrid || !tempDestStartCellId || tempMoveSelectedIds.size === 0) return new Set<string>();
    const emptyCells = tempMoveTargetGrid.cells
      .filter((c) => !c.vial_id)
      .sort((a, b) => a.row - b.row || a.col - b.col);
    const startIdx = emptyCells.findIndex((c) => c.id === tempDestStartCellId);
    if (startIdx < 0) return new Set<string>();
    const preview = emptyCells.slice(startIdx, startIdx + tempMoveSelectedIds.size);
    return new Set(preview.map((c) => c.id));
  }, [tempMoveTargetGrid, tempDestStartCellId, tempMoveSelectedIds, tempDestMode]);

  const tempInsufficientCells = useMemo(() => {
    if (tempDestMode === "start") {
      if (!tempDestStartCellId || !tempMoveTargetGrid) return false;
      return tempPreviewCellIds.size < tempMoveSelectedIds.size;
    }
    if (tempDestMode === "pick") {
      return tempDestPickedCellIds.size !== tempMoveSelectedIds.size;
    }
    return false;
  }, [tempPreviewCellIds, tempMoveSelectedIds, tempDestStartCellId, tempMoveTargetGrid, tempDestMode, tempDestPickedCellIds]);

  const handleTempMove = useCallback(async () => {
    if (!tempMoveTargetUnitId || tempMoveSelectedIds.size === 0) return;
    setTempMoveLoading(true);
    setTempMessage(null);
    setTempError(null);
    try {
      const movePayload: Record<string, unknown> = {
        vial_ids: Array.from(tempMoveSelectedIds),
        target_unit_id: tempMoveTargetUnitId,
      };
      if (tempDestMode === "start" && tempDestStartCellId) {
        movePayload.start_cell_id = tempDestStartCellId;
      } else if (tempDestMode === "pick" && tempDestPickedCellIds.size > 0) {
        movePayload.target_cell_ids = Array.from(tempDestPickedCellIds);
      }
      const res = await api.post<VialMoveResult>("/vials/move", movePayload);
      setTempMessage(`Moved ${res.data.moved_count} vial(s) successfully.`);
      addToast(`Moved ${res.data.moved_count} vial(s) successfully`, "success");
      // Refresh temp summary
      const tempRes = await api.get<TempStorageSummary>("/storage/temp-storage/summary", {
        params: { lab_id: selectedLab },
      });
      setTempSummary(tempRes.data);
      // Reset drill-down
      setTempSelectedItem(null);
      setTempGrid(null);
      setTempMoveSelectedIds(new Set());
      setTempMoveTargetUnitId("");
      setTempMoveTargetGrid(null);
      setTempDestMode("auto");
      setTempDestStartCellId(null);
      setTempDestPickedCellIds(new Set());
    } catch {
      setTempError("Failed to move vials.");
      addToast("Failed to move vials", "danger");
    } finally {
      setTempMoveLoading(false);
    }
  }, [tempMoveTargetUnitId, tempMoveSelectedIds, tempDestMode, tempDestStartCellId, tempDestPickedCellIds, selectedLab]);

  const allClear = cards.every((c) => c.count === 0);

  return (
    <div>
      <div className="page-header">
        <h1>Dashboard</h1>
        {user?.role === "super_admin" && (
          <div className="lab-selector">
            <ChevronDown size={14} className="lab-selector-icon" />
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
          </div>
        )}
      </div>

      {allClear && (
        <div className="dashboard-all-clear">
          <CheckCircle2 size={32} />
          <div>
            <div className="all-clear-title">All clear</div>
            <div className="all-clear-desc">No pending actions or alerts right now.</div>
          </div>
        </div>
      )}

      <div className="stats-grid">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.key}
              type="button"
              className={`stat-card priority-card ${card.className} ${
                selectedCard === card.key ? "selected" : ""
              }${card.count === 0 ? " clear" : ""}`}
              onClick={() =>
                setSelectedCard(selectedCard === card.key ? null : card.key)
              }
            >
              <div className={`stat-icon-wrap`}>
                {card.count === 0 ? <CheckCircle2 size={20} /> : <Icon size={20} />}
              </div>
              <div className="stat-value">{card.count}</div>
              <div className="stat-label">{card.label}</div>
            </button>
          );
        })}
      </div>

      {selectedCard === "pending" && (
        <div className="dashboard-section">
          <h2>Pending QC Lots</h2>
          {pendingLots.length === 0 ? (
            <p className="page-desc">No pending QC lots.</p>
          ) : isMobile ? (
            <div className="dash-card-list">
              {pendingLots.map((lot) => {
                const counts = lot.vial_counts || { sealed: 0, opened: 0, depleted: 0, total: 0 };
                const label = lotLabel(lot);
                const color = lot.antibody_fluorochrome
                  ? fluoroMap.get(lot.antibody_fluorochrome.toLowerCase())
                  : undefined;
                return (
                  <div key={lot.id} className="dash-card" onClick={() => navigateToInventory(lot.antibody_id)} role="button" tabIndex={0} onKeyDown={(e) => handleRowKey(e, lot.antibody_id)}>
                    <div className="dash-card-title">
                      {color && <div className="color-dot" style={{ backgroundColor: color }} />}
                      {label}
                      {pendingQCBadges.get(lot.id)?.map((badge, i) => (
                        <span key={i} className="badge badge-red" style={{ marginLeft: 6, fontSize: "0.7em" }}>{badge}</span>
                      ))}
                      {(labSettings.qc_doc_required ?? false) && !lot.has_qc_document && (
                        <span className="badge badge-orange needs-doc-badge" style={{ marginLeft: 6, fontSize: "0.7em" }}>Needs QC</span>
                      )}
                    </div>
                    <div className="dash-card-row"><span>Vendor</span><span>{lotVendor(lot)}</span></div>
                    <div className="dash-card-row"><span>Lot #</span><span>{lot.lot_number}</span></div>
                    <div className="dash-card-row"><span>Expiration</span><span>{lot.expiration_date ? new Date(lot.expiration_date).toLocaleDateString() : "—"}</span></div>
                    <div className="dash-card-row"><span>Sealed</span><span>{counts.sealed}</span></div>
                    <div className="dash-card-row"><span>Opened</span><span>{counts.opened}</span></div>
                    <div className="dash-card-row"><span>Total</span><span>{counts.total}</span></div>
                  </div>
                );
              })}
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Antibody</th>
                  <th>Vendor</th>
                  <th>Lot #</th>
                  <th>Expiration</th>
                  <th>Sealed</th>
                  <th>Opened</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {pendingLots.map((lot) => {
                  const counts = lot.vial_counts || { sealed: 0, opened: 0, depleted: 0, total: 0 };
                  const label = lotLabel(lot);
                  const color = lot.antibody_fluorochrome
                    ? fluoroMap.get(lot.antibody_fluorochrome.toLowerCase())
                    : undefined;
                  return (
                    <tr key={lot.id} className="clickable-row" onClick={() => navigateToInventory(lot.antibody_id)} onKeyDown={(e) => handleRowKey(e, lot.antibody_id)} role="button" tabIndex={0}>
                      <td>
                        {color && <div className="color-dot" style={{ backgroundColor: color }} />}
                        {label}
                        {pendingQCBadges.get(lot.id)?.map((badge, i) => (
                          <span key={i} className="badge badge-red" style={{ marginLeft: 6, fontSize: "0.7em" }}>{badge}</span>
                        ))}
                        {(labSettings.qc_doc_required ?? false) && !lot.has_qc_document && (
                          <span className="badge badge-orange needs-doc-badge" style={{ marginLeft: 6, fontSize: "0.7em" }}>Needs QC</span>
                        )}
                      </td>
                      <td>{lotVendor(lot)}</td>
                      <td>{lot.lot_number}</td>
                      <td>{lot.expiration_date ? new Date(lot.expiration_date).toLocaleDateString() : "—"}</td>
                      <td>{counts.sealed}</td>
                      <td>{counts.opened}</td>
                      <td>{counts.total}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {selectedCard === "temp" && (
        <div className="dashboard-section">
          <h2>Vials in Temporary Storage</h2>
          {!tempSummary || tempSummary.total_vials === 0 ? (
            <p className="page-desc">No vials in temporary storage.</p>
          ) : isMobile ? (
            <div className="dash-card-list">
              {tempSummary.lots.map((item) => (
                <div
                  key={item.lot_id}
                  className={`dash-card clickable${tempSelectedItem?.lot_id === item.lot_id ? " active" : ""}`}
                  onClick={() => handleTempLotClick(item)}
                  role="button"
                  tabIndex={0}
                >
                  <div className="dash-card-title">
                    {item.antibody_target}-{item.antibody_fluorochrome}
                  </div>
                  <div className="dash-card-row"><span>Lot #</span><span>{item.lot_number}</span></div>
                  <div className="dash-card-row"><span>Vials</span><span>{item.vial_count}</span></div>
                </div>
              ))}
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Antibody</th>
                  <th>Lot #</th>
                  <th>Vials</th>
                </tr>
              </thead>
              <tbody>
                {tempSummary.lots.map((item) => (
                  <tr
                    key={item.lot_id}
                    className={`clickable-row${tempSelectedItem?.lot_id === item.lot_id ? " active" : ""}`}
                    onClick={() => handleTempLotClick(item)}
                    role="button"
                    tabIndex={0}
                  >
                    <td>{item.antibody_target}-{item.antibody_fluorochrome}</td>
                    <td>{item.lot_number}</td>
                    <td>{item.vial_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Drill-down: temp grid + move controls */}
          {tempSelectedItem && (
            <div className="lot-drilldown-panel" style={{ marginTop: "1rem" }}>
              {tempMessage && <p className="success">{tempMessage}</p>}
              {tempError && <p className="error">{tempError}</p>}

              {tempGridLoading ? (
                <p className="page-desc">Loading grid…</p>
              ) : tempGrid ? (
                <>
                  <h3 style={{ margin: "0 0 0.5rem" }}>
                    {tempSelectedItem.antibody_target}-{tempSelectedItem.antibody_fluorochrome} — Lot {tempSelectedItem.lot_number}
                  </h3>
                  <p className="page-desc" style={{ margin: "0 0 0.5rem" }}>
                    Click cells to select/deselect vials to move. {tempMoveSelectedIds.size} selected.
                  </p>
                  <StorageGrid
                    rows={tempGrid.unit.rows}
                    cols={tempGrid.unit.cols}
                    cells={tempGrid.cells}
                    highlightVialIds={tempMoveSelectedIds}
                    onCellClick={handleTempMoveCellClick}
                    clickMode="occupied"
                    singleClickSelect
                  />

                  {/* Move controls */}
                  <div className="move-controls" style={{ marginTop: "1rem" }}>
                    <label>
                      Move to:
                      <select
                        value={tempMoveTargetUnitId}
                        onChange={(e) => handleTempTargetUnitChange(e.target.value)}
                        style={{ marginLeft: 8 }}
                      >
                        <option value="">Select storage unit…</option>
                        {storageUnits.map((u) => (
                          <option key={u.id} value={u.id}>{u.name}</option>
                        ))}
                      </select>
                    </label>

                    <button
                      className="btn-primary"
                      disabled={tempMoveSelectedIds.size === 0 || !tempMoveTargetUnitId || tempMoveLoading || tempInsufficientCells}
                      onClick={handleTempMove}
                      style={{ marginLeft: 12 }}
                    >
                      {tempMoveLoading ? "Moving…" : `Move ${tempMoveSelectedIds.size} Vial(s)`}
                    </button>
                  </div>

                  {/* Target grid preview */}
                  {tempMoveTargetGrid && (
                    <div style={{ marginTop: "1rem" }}>
                      <h4 style={{ margin: "0 0 0.25rem" }}>Destination: {tempMoveTargetGrid.unit.name}</h4>
                      <p className="page-desc" style={{ margin: "0 0 0.5rem", fontSize: "0.85em" }}>
                        {tempDestMode === "auto" && "Click an empty cell to set a starting position, or leave for auto-placement."}
                        {tempDestMode === "start" && `Vials will fill from the selected cell. Click another cell to pick individual positions.`}
                        {tempDestMode === "pick" && `Pick mode: ${tempDestPickedCellIds.size}/${tempMoveSelectedIds.size} cells selected. Click cells to toggle.`}
                        {tempDestMode !== "auto" && (
                          <button
                            className="btn-secondary btn-sm"
                            style={{ marginLeft: 8 }}
                            onClick={() => { setTempDestMode("auto"); setTempDestStartCellId(null); setTempDestPickedCellIds(new Set()); }}
                          >
                            Clear
                          </button>
                        )}
                      </p>
                      <StorageGrid
                        rows={tempMoveTargetGrid.unit.rows}
                        cols={tempMoveTargetGrid.unit.cols}
                        cells={tempMoveTargetGrid.cells}
                        highlightVialIds={new Set<string>()}
                        selectedCellId={tempDestMode === "start" ? tempDestStartCellId : undefined}
                        selectedCellIds={tempDestMode === "pick" ? tempDestPickedCellIds : undefined}
                        onCellClick={handleTempTargetCellClick}
                        clickMode="empty"
                        singleClickSelect
                        previewCellIds={tempDestMode === "start" ? tempPreviewCellIds : undefined}
                      />
                      {tempInsufficientCells && (
                        <p className="error" style={{ marginTop: 4 }}>
                          {tempDestMode === "pick"
                            ? `Select exactly ${tempMoveSelectedIds.size} cell(s) to match the number of vials.`
                            : "Not enough empty cells from the selected position."}
                        </p>
                      )}
                    </div>
                  )}
                </>
              ) : null}
            </div>
          )}
        </div>
      )}

      {selectedCard === "low" && (
        <div className="dashboard-section">
          <h2>Low Stock Antibodies</h2>
          {lowStock.length === 0 ? (
            <p className="page-desc">No low stock antibodies.</p>
          ) : isMobile ? (
            <div className="dash-card-list">
              {lowStock.map((ab) => {
                const stats = abVialStats.get(ab.id);
                const color = fluoroMap.get(ab.fluorochrome.toLowerCase());
                const badge = lowStockBadges.get(ab.id);
                return (
                  <div key={ab.id} className="dash-card" onClick={() => navigateToInventory(ab.id)} role="button" tabIndex={0} onKeyDown={(e) => handleRowKey(e, ab.id)}>
                    <div className="dash-card-title">
                      {color && <div className="color-dot" style={{ backgroundColor: color }} />}
                      {ab.target}-{ab.fluorochrome}
                      {badge && <span className={`badge ${badge.color}`} style={{ marginLeft: 6, fontSize: "0.7em" }}>{badge.label}</span>}
                    </div>
                    <div className="dash-card-row"><span>Vendor</span><span>{ab.vendor || "—"}</span></div>
                    <div className="dash-card-row"><span>Approved</span><span>{stats?.approved ?? 0}{ab.approved_low_threshold != null ? ` / ${ab.approved_low_threshold}` : ""}</span></div>
                    <div className="dash-card-row"><span>Pending</span><span>{stats?.pending ?? 0}</span></div>
                    <div className="dash-card-row"><span>Total</span><span>{stats?.total ?? 0}{ab.low_stock_threshold != null ? ` / ${ab.low_stock_threshold}` : ""}</span></div>
                    <div className="dash-card-row"><span>Catalog #</span><span>{ab.catalog_number || "—"}</span></div>
                  </div>
                );
              })}
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Antibody</th>
                  <th>Vendor</th>
                  <th>Approved Vials</th>
                  <th>Pending Vials</th>
                  <th>Total Vials</th>
                  <th>Catalog #</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {lowStock.map((ab) => {
                  const stats = abVialStats.get(ab.id);
                  const color = fluoroMap.get(ab.fluorochrome.toLowerCase());
                  const badge = lowStockBadges.get(ab.id);
                  return (
                    <tr key={ab.id} className="clickable-row" onClick={() => navigateToInventory(ab.id)} onKeyDown={(e) => handleRowKey(e, ab.id)} role="button" tabIndex={0}>
                      <td>
                        {color && <div className="color-dot" style={{ backgroundColor: color }} />}
                        {ab.target}-{ab.fluorochrome}
                      </td>
                      <td>{ab.vendor || "—"}</td>
                      <td>
                        <span className="badge">{stats?.approved ?? 0}</span>
                        {ab.approved_low_threshold != null && (
                          <span style={{ color: "#6b7280", fontSize: "0.8em", marginLeft: 4 }}>/ {ab.approved_low_threshold}</span>
                        )}
                      </td>
                      <td><span className="badge">{stats?.pending ?? 0}</span></td>
                      <td>
                        <span className="badge">{stats?.total ?? 0}</span>
                        {ab.low_stock_threshold != null && (
                          <span style={{ color: "#6b7280", fontSize: "0.8em", marginLeft: 4 }}>/ {ab.low_stock_threshold}</span>
                        )}
                      </td>
                      <td>{ab.catalog_number || "—"}</td>
                      <td>
                        {badge && <span className={`badge ${badge.color}`}>{badge.label}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {selectedCard === "expiring" && (
        <div className="dashboard-section">
          <h2>Expiring Lots</h2>
          {expiringLots.length === 0 ? (
            <p className="page-desc">No expiring lots.</p>
          ) : isMobile ? (
            <div className="dash-card-list">
              {expiringLots.map((lot) => {
                const isExpired = new Date(lot.expiration_date!) < new Date();
                const counts = lot.vial_counts || { sealed: 0, opened: 0, depleted: 0, total: 0 };
                const label = lotLabel(lot);
                const ab = antibodyMap.get(lot.antibody_id);
                const color = lot.antibody_fluorochrome
                  ? fluoroMap.get(lot.antibody_fluorochrome.toLowerCase())
                  : undefined;
                return (
                  <div key={lot.id} className="dash-card" onClick={() => navigateToInventory(lot.antibody_id)} role="button" tabIndex={0} onKeyDown={(e) => handleRowKey(e, lot.antibody_id)}>
                    <div className="dash-card-title">
                      {color && <div className="color-dot" style={{ backgroundColor: color }} />}
                      {label}
                      <span className={`badge ${isExpired ? "badge-red" : "badge-yellow"}`} style={{ marginLeft: 6, fontSize: "0.7em" }}>
                        {isExpired ? "Expired" : daysUntil(lot.expiration_date!)}
                      </span>
                      {expiringLotBadges.get(lot.id)?.map((badge, i) => (
                        <span key={i} className={`badge ${badge.color}`} style={{ marginLeft: 4, fontSize: "0.7em" }}>{badge.label}</span>
                      ))}
                    </div>
                    <div className="dash-card-row"><span>Vendor</span><span>{lotVendor(lot)}</span></div>
                    <div className="dash-card-row"><span>Lot #</span><span>{lot.lot_number}</span></div>
                    <div className="dash-card-row"><span>Catalog #</span><span>{ab?.catalog_number || "—"}</span></div>
                    <div className="dash-card-row"><span>Expiration</span><span>{lot.expiration_date ? new Date(lot.expiration_date).toLocaleDateString() : "—"}</span></div>
                    <div className="dash-card-row"><span>Sealed</span><span>{counts.sealed}</span></div>
                    <div className="dash-card-row"><span>Total</span><span>{counts.total}</span></div>
                  </div>
                );
              })}
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Antibody</th>
                  <th>Vendor</th>
                  <th>Lot #</th>
                  <th>Catalog #</th>
                  <th>Expiration</th>
                  <th>Status</th>
                  <th>Sealed</th>
                  <th>Total</th>
                  <th>Backup</th>
                </tr>
              </thead>
              <tbody>
                {expiringLots.map((lot) => {
                  const isExpired = new Date(lot.expiration_date!) < new Date();
                  const counts = lot.vial_counts || { sealed: 0, opened: 0, depleted: 0, total: 0 };
                  const label = lotLabel(lot);
                  const ab = antibodyMap.get(lot.antibody_id);
                  const color = lot.antibody_fluorochrome
                    ? fluoroMap.get(lot.antibody_fluorochrome.toLowerCase())
                    : undefined;
                  return (
                    <tr key={lot.id} className="clickable-row" onClick={() => navigateToInventory(lot.antibody_id)} onKeyDown={(e) => handleRowKey(e, lot.antibody_id)} role="button" tabIndex={0}>
                      <td>
                        {color && <div className="color-dot" style={{ backgroundColor: color }} />}
                        {label}
                      </td>
                      <td>{lotVendor(lot)}</td>
                      <td>{lot.lot_number}</td>
                      <td>{ab?.catalog_number || "—"}</td>
                      <td>{lot.expiration_date ? new Date(lot.expiration_date).toLocaleDateString() : "—"}</td>
                      <td>
                        <span className={`badge ${isExpired ? "badge-red" : "badge-yellow"}`}>
                          {isExpired ? "Expired" : daysUntil(lot.expiration_date!)}
                        </span>
                      </td>
                      <td>{counts.sealed}</td>
                      <td>{counts.total}</td>
                      <td>
                        {expiringLotBadges.get(lot.id)?.map((badge, i) => (
                          <span key={i} className={`badge ${badge.color}`} style={{ fontSize: "0.8em" }}>{badge.label}</span>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {(user?.role === "lab_admin" || user?.role === "super_admin") && user?.lab_id && (
        <div className="dashboard-section">
          <h2>Lab Settings</h2>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={labSettings.sealed_counts_only ?? false}
              onChange={async () => {
                await api.patch(`/labs/${user.lab_id}/settings`, {
                  sealed_counts_only: !(labSettings.sealed_counts_only ?? false),
                });
                await refreshUser();
              }}
            />
            Track sealed counts only (skip opened/depleted tracking)
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
            <input
              type="checkbox"
              checked={labSettings.qc_doc_required ?? false}
              onChange={async () => {
                await api.patch(`/labs/${user.lab_id}/settings`, {
                  qc_doc_required: !(labSettings.qc_doc_required ?? false),
                });
                await refreshUser();
              }}
            />
            Require QC document upload before lot approval
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
            Expiring lot warning (days):
            <input
              type="number"
              min={1}
              max={365}
              style={{ width: 70 }}
              value={labSettings.expiry_warn_days ?? DEFAULT_EXPIRY_WARN_DAYS}
              onChange={async (e) => {
                const val = parseInt(e.target.value, 10);
                if (!Number.isFinite(val) || val < 1) return;
                await api.patch(`/labs/${user.lab_id}/settings`, {
                  expiry_warn_days: val,
                });
                await refreshUser();
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}
