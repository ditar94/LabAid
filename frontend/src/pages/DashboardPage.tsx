import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type {
  Antibody, Lot, TempStorageSummary, TempStorageSummaryItem,
  StorageGrid as StorageGridData,
  LotRequest,
} from "../api/types";
import { StorageView } from "../components/storage";
import type { StorageViewHandle } from "../components/storage";
import { useAuth } from "../context/AuthContext";
import { useSharedData } from "../context/SharedDataContext";
import { useMediaQuery } from "../hooks/useMediaQuery";
import {
  Clock,
  Thermometer,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  PackagePlus,
} from "lucide-react";
import { useToast } from "../context/ToastContext";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import PullToRefresh from "../components/PullToRefresh";
import LotRequestReviewModal from "../components/LotRequestReviewModal";
import CopyButton from "../components/CopyButton";
import LotTable from "../components/LotTable";
import LotCardList from "../components/LotCardList";
import { formatDate } from "../utils/format";

const DEFAULT_EXPIRY_WARN_DAYS = 30;
const CURRENT_LOT_EXPIRY_WARN_DAYS = 7;
const EMPTY_LOT_AGE_MAP = new Map<string, "current" | "new">();

export default function DashboardPage() {
  const { user, labSettings } = useAuth();
  const { labs, fluorochromes, selectedLab, setSelectedLab } = useSharedData();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedCard, setSelectedCard] = useState<"requests" | "pending" | "low" | "expiring" | "temp" | null>(null);
  const [reviewingRequest, setReviewingRequest] = useState<LotRequest | null>(null);

  // Temp storage drill-down + move (local UI state only)
  const [tempSelectedItem, setTempSelectedItem] = useState<TempStorageSummaryItem | null>(null);
  const [tempGrid, setTempGrid] = useState<StorageGridData | null>(null);
  const [tempGridLoading, setTempGridLoading] = useState(false);
  const [tempMessage, setTempMessage] = useState<string | null>(null);
  const [tempError, setTempError] = useState<string | null>(null);
  const tempViewRef = useRef<StorageViewHandle>(null);

  const isMobile = useMediaQuery("(max-width: 768px)");
  const LotList = isMobile ? LotCardList : LotTable;
  const { addToast } = useToast();

  const isSupervisorPlus = user?.role === "super_admin" || user?.role === "lab_admin" || user?.role === "supervisor";
  const labParams = selectedLab ? { lab_id: selectedLab } : undefined;

  // ── Data queries (cached, stale-while-revalidate) ──

  const { data: antibodies = [], isSuccess: abLoaded } = useQuery({
    queryKey: ["antibodies", selectedLab],
    queryFn: () => api.get<Antibody[]>("/antibodies/", { params: labParams }).then(r => r.data),
    enabled: !!selectedLab,
  });

  const { data: allLots = [], isSuccess: lotsLoaded } = useQuery({
    queryKey: ["lots", selectedLab],
    queryFn: () => api.get<Lot[]>("/lots/", { params: labParams }).then(r => r.data),
    enabled: !!selectedLab,
  });

  const { data: lowStock = [] } = useQuery({
    queryKey: ["antibodies", "low-stock", selectedLab],
    queryFn: () => api.get<Antibody[]>("/antibodies/low-stock", { params: labParams }).then(r => r.data),
    enabled: !!selectedLab,
  });

  const { data: tempSummary } = useQuery({
    queryKey: ["temp-storage", "summary", selectedLab],
    queryFn: () => api.get<TempStorageSummary>("/storage/temp-storage/summary", { params: labParams }).then(r => r.data),
    enabled: !!selectedLab,
  });

  const { data: allRequests = [] } = useQuery({
    queryKey: ["lot-requests", selectedLab],
    queryFn: () => api.get<LotRequest[]>("/lot-requests/").then(r => r.data),
    enabled: !!selectedLab && !!isSupervisorPlus,
  });

  // ── Derived state (computed from query data) ──

  const dataLoaded = abLoaded || lotsLoaded;
  const pendingLots = useMemo(() => allLots.filter(l => l.qc_status === "pending"), [allLots]);
  const pendingRequests = useMemo(() => allRequests.filter(r => r.status === "pending"), [allRequests]);

  const expiringLots = useMemo(() => {
    const expiryWarnDays = labSettings.expiry_warn_days ?? DEFAULT_EXPIRY_WARN_DAYS;
    const now = new Date();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + expiryWarnDays);
    const expiring = allLots
      .filter(l => {
        if (!l.expiration_date) return false;
        const exp = new Date(l.expiration_date);
        return exp <= cutoff && exp >= now;
      })
      .sort((a, b) => new Date(a.expiration_date!).getTime() - new Date(b.expiration_date!).getTime());
    const expired = allLots
      .filter(l => {
        if (!l.expiration_date) return false;
        return new Date(l.expiration_date) < now;
      })
      .sort((a, b) => new Date(a.expiration_date!).getTime() - new Date(b.expiration_date!).getTime());
    return [...expired, ...expiring];
  }, [allLots, labSettings.expiry_warn_days]);

  // Invalidate all dashboard queries (used by pull-to-refresh + mutation callbacks)
  const invalidateDashboard = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["antibodies"] });
    queryClient.invalidateQueries({ queryKey: ["lots"] });
    queryClient.invalidateQueries({ queryKey: ["temp-storage"] });
    queryClient.invalidateQueries({ queryKey: ["lot-requests"] });
  }, [queryClient]);

  const ptr = usePullToRefresh({
    onRefresh: async () => { invalidateDashboard(); },
    disabled: !isMobile,
  });

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
    if (!ab) return "—";
    return ab.name || [ab.target, ab.fluorochrome].filter(Boolean).join("-") || "—";
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

  const storageEnabled = labSettings.storage_enabled !== false;
  const cards = [
    ...(isSupervisorPlus && pendingRequests.length > 0
      ? [{ key: "requests" as const, label: "Pending Antibodies", count: pendingRequests.length, className: "info", icon: PackagePlus }]
      : []),
    { key: "pending" as const, label: "Pending QC", count: pendingLots.length, className: "warn", icon: Clock },
    ...(storageEnabled
      ? [{ key: "temp" as const, label: "Temp Storage", count: tempSummary?.total_vials ?? 0, className: "warn", icon: Thermometer }]
      : []),
    { key: "low" as const, label: "Low Stock", count: lowStock.length, className: "danger", icon: AlertTriangle },
    { key: "expiring" as const, label: "Expiring Lots", count: expiringLots.length, className: "warn", icon: CalendarClock },
  ];

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

  // Helper: render antibody label + vendor as a prefix column for LotTable/LotCardList
  const renderLotPrefix = (lot: Lot, extraBadges?: React.ReactNode) => {
    const label = lotLabel(lot);
    const color = lot.antibody_fluorochrome
      ? fluoroMap.get(lot.antibody_fluorochrome.toLowerCase())
      : undefined;
    const ab = antibodyMap.get(lot.antibody_id);
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {color && <div className="color-dot" style={{ backgroundColor: color }} />}
          {label}
          {ab && <span className={`badge badge-designation-${ab.designation}`} style={{ marginLeft: 6, fontSize: "0.75em" }}>{ab.designation.toUpperCase()}</span>}
          {extraBadges}
        </div>
        <div style={{ fontSize: "0.85em", color: "var(--text-muted)" }}>{lotVendor(lot)}</div>
      </div>
    );
  };

  // ── Temp storage drill-down handlers ──

  // Toggle drill-down for a temp storage lot item
  const handleTempLotClick = useCallback(async (item: TempStorageSummaryItem) => {
    // Collapse if clicking the same lot
    if (tempSelectedItem?.lot_id === item.lot_id) {
      setTempSelectedItem(null);
      setTempGrid(null);
      setTempMessage(null);
      setTempError(null);
      return;
    }

    // Expand new lot
    setTempSelectedItem(item);
    setTempMessage(null);
    setTempError(null);

    if (!tempSummary?.unit_id) return;

    // Load the temp storage grid (source)
    setTempGridLoading(true);
    try {
      const gridRes = await api.get<StorageGridData>(`/storage/units/${tempSummary.unit_id}/grid`);
      setTempGrid(gridRes.data);
    } catch (err: any) {
      setTempError(err.response?.data?.detail || "Failed to load temp storage grid");
    } finally {
      setTempGridLoading(false);
    }
  }, [tempSelectedItem, tempSummary]);

  // Auto-enter move mode when temp grid loads with a selected item
  const handleTempRefresh = useCallback(async () => {
    queryClient.invalidateQueries({ queryKey: ["temp-storage", "summary", selectedLab] });
    setTempSelectedItem(null);
    setTempGrid(null);
  }, [selectedLab, queryClient]);

  useEffect(() => {
    if (tempGrid && tempSelectedItem) {
      tempViewRef.current?.enterMoveMode(new Set(tempSelectedItem.vial_ids));
    }
  }, [tempGrid, tempSelectedItem]);

  const allClear = dataLoaded && cards.every((c) => c.count === 0);

  return (
    <div ref={ptr.containerRef}>
      <PullToRefresh
        pulling={ptr.pulling}
        refreshing={ptr.refreshing}
        pullDistance={ptr.pullDistance}
        progress={ptr.progress}
        isPastThreshold={ptr.isPastThreshold}
      />
      <div className="page-header">
        <h1>Dashboard</h1>
        {user?.role === "super_admin" && labs.length > 0 && (
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

      <div className="stats-grid stagger-reveal">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.key}
              type="button"
              className={`stat-card priority-card ${card.className} ${
                selectedCard === card.key ? "selected" : ""
              }${dataLoaded && card.count === 0 ? " clear" : ""}`}
              onClick={() =>
                setSelectedCard(selectedCard === card.key ? null : card.key)
              }
              aria-expanded={selectedCard === card.key}
              aria-controls={`dashboard-section-${card.key}`}
            >
              <div className={`stat-icon-wrap`}>
                {dataLoaded && card.count === 0 ? <CheckCircle2 size={20} /> : <Icon size={20} />}
              </div>
              <div className="stat-value">{dataLoaded ? card.count : <span className="shimmer shimmer-text" />}</div>
              <div className="stat-label">{card.label}</div>
            </button>
          );
        })}
      </div>

      <div className={`dashboard-section-wrapper${selectedCard === "requests" ? " open" : ""}`}>
        <div className="dashboard-section-inner">
        <div className="dashboard-section" id="dashboard-section-requests">
          <h2>Pending Antibodies</h2>
          {pendingRequests.length === 0 ? (
            <p className="page-desc">No pending requests.</p>
          ) : isMobile ? (
            <div className="dash-card-list">
              {pendingRequests.map((req) => {
                const ab = req.proposed_antibody as Record<string, string>;
                const abLabel = ab.name || [ab.target, ab.fluorochrome].filter(Boolean).join(" - ") || "Unnamed";
                return (
                  <div key={req.id} className="dash-card clickable" onClick={() => setReviewingRequest(req)} role="button" tabIndex={0}>
                    <div className="dash-card-title">{abLabel}</div>
                    <div className="dash-card-row"><span>Submitted by</span><span>{req.user_full_name || "Unknown"}</span></div>
                    <div className="dash-card-row"><span>Barcode</span><span style={{ fontSize: "0.85em", wordBreak: "break-all" }}>{req.barcode}</span></div>
                    <div className="dash-card-row"><span>Lot #</span><span>{req.lot_number || "—"}</span></div>
                    <div className="dash-card-row"><span>Quantity</span><span>{req.quantity}</span></div>
                    <div className="dash-card-row"><span>Submitted</span><span>{formatDate(req.created_at)}</span></div>
                    <div className="dash-card-row">
                      <span />
                      <button className="btn-sm" onClick={(e) => { e.stopPropagation(); setReviewingRequest(req); }}>Review</button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Pending Antibody</th>
                  <th>Submitted By</th>
                  <th>Lot #</th>
                  <th>Qty</th>
                  <th>Submitted</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pendingRequests.map((req) => {
                  const ab = req.proposed_antibody as Record<string, string>;
                  const abLabel = ab.name || [ab.target, ab.fluorochrome].filter(Boolean).join(" - ") || "Unnamed";
                  return (
                    <tr key={req.id}>
                      <td>
                        {abLabel}
                        {ab.designation && (
                          <span className={`badge badge-designation-${ab.designation}`} style={{ marginLeft: 6, fontSize: "0.75em" }}>
                            {String(ab.designation).toUpperCase()}
                          </span>
                        )}
                      </td>
                      <td>{req.user_full_name || "Unknown"}</td>
                      <td>{req.lot_number || "—"}</td>
                      <td>{req.quantity}</td>
                      <td>{formatDate(req.created_at)}</td>
                      <td>
                        <button className="btn-sm" onClick={() => setReviewingRequest(req)}>Review</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        </div>
      </div>

      {reviewingRequest && (
        <LotRequestReviewModal
          request={reviewingRequest}
          onClose={() => setReviewingRequest(null)}
          onSuccess={() => {
            setReviewingRequest(null);
            addToast("Lot request processed", "success");
            invalidateDashboard();
          }}
        />
      )}

      <div className={`dashboard-section-wrapper${selectedCard === "pending" ? " open" : ""}`}>
        <div className="dashboard-section-inner">
        <div className="dashboard-section" id="dashboard-section-pending">
          <h2>Pending QC Lots</h2>
          {pendingLots.length === 0 ? (
            <p className="page-desc">No pending QC lots.</p>
          ) : (
            <LotList
              lots={pendingLots}
              sealedOnly={false}
              hideDepleted
              canQC={false}
              storageEnabled={false}
              lotAgeBadgeMap={EMPTY_LOT_AGE_MAP}
              hideActions
              hideQc
              onLotClick={(lot) => navigateToInventory(lot.antibody_id)}
              prefixColumn={{
                header: "Antibody",
                render: (lot) => renderLotPrefix(lot, <>
                  {pendingQCBadges.get(lot.id)?.map((badge, i) => (
                    <span key={i} className="badge badge-red" style={{ marginLeft: 6, fontSize: "0.7em" }}>{badge}</span>
                  ))}
                  {(labSettings.qc_doc_required ?? false) && !lot.has_qc_document && (
                    <span className="badge badge-orange needs-doc-badge" style={{ marginLeft: 6, fontSize: "0.7em" }}>Needs QC</span>
                  )}
                </>),
              }}
            />
          )}
        </div>
        </div>
      </div>

      {storageEnabled && (
      <div className={`dashboard-section-wrapper${selectedCard === "temp" ? " open" : ""}`}>
        <div className="dashboard-section-inner">
        <div className="dashboard-section" id="dashboard-section-temp">
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
                    {item.antibody_name || [item.antibody_target, item.antibody_fluorochrome].filter(Boolean).join("-") || "Unnamed"}
                  </div>
                  <div className="dash-card-row"><span>Lot #</span><span>{item.lot_number}</span></div>
                  <div className="dash-card-row"><span>Vials</span><span>{item.vial_count}</span></div>
                  {item.vendor_barcode && (
                    <div className="dash-card-row">
                      <span />
                      <button
                        className="btn-sm btn-secondary"
                        onClick={(e) => { e.stopPropagation(); navigate(`/scan-search?barcode=${encodeURIComponent(item.vendor_barcode!)}`); }}
                      >
                        Search Lot
                      </button>
                    </div>
                  )}
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
                  <th></th>
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
                    <td>{item.antibody_name || [item.antibody_target, item.antibody_fluorochrome].filter(Boolean).join("-") || "Unnamed"}</td>
                    <td>{item.lot_number}</td>
                    <td>{item.vial_count}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {item.vendor_barcode && (
                        <button
                          className="btn-sm btn-secondary"
                          onClick={() => navigate(`/scan-search?barcode=${encodeURIComponent(item.vendor_barcode!)}`)}
                        >
                          Search Lot
                        </button>
                      )}
                    </td>
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

              {tempGridLoading ? null : tempGrid ? (
                <>
                  <h3 style={{ margin: "0 0 0.5rem" }}>
                    {tempSelectedItem.antibody_name || [tempSelectedItem.antibody_target, tempSelectedItem.antibody_fluorochrome].filter(Boolean).join("-") || "Unnamed"} — Lot {tempSelectedItem.lot_number}
                  </h3>
                  <StorageView
                    ref={tempViewRef}
                    grids={[tempGrid]}
                    fluorochromes={fluorochromes}
                    highlightVialIds={new Set(tempSelectedItem.vial_ids)}
                    highlightOnly
                    onRefresh={handleTempRefresh}
                    excludeUnitIds={[tempGrid.unit.id]}
                  />
                </>
              ) : null}
            </div>
          )}
        </div>
        </div>
      </div>
      )}

      <div className={`dashboard-section-wrapper${selectedCard === "low" ? " open" : ""}`}>
        <div className="dashboard-section-inner">
        <div className="dashboard-section" id="dashboard-section-low">
          <h2>Low Stock Antibodies</h2>
          {lowStock.length === 0 ? (
            <p className="page-desc">No low stock antibodies.</p>
          ) : isMobile ? (
            <div className="dash-card-list">
              {lowStock.map((ab) => {
                const stats = abVialStats.get(ab.id);
                const color = ab.fluorochrome ? fluoroMap.get(ab.fluorochrome.toLowerCase()) : ab.color ?? undefined;
                const badge = lowStockBadges.get(ab.id);
                return (
                  <div key={ab.id} className="dash-card" onClick={() => navigateToInventory(ab.id)} role="button" tabIndex={0} onKeyDown={(e) => handleRowKey(e, ab.id)}>
                    <div className="dash-card-title">
                      {color && <div className="color-dot" style={{ backgroundColor: color }} />}
                      {ab.name || [ab.target, ab.fluorochrome].filter(Boolean).join("-") || "Unnamed"}
                      <span className={`badge badge-designation-${ab.designation}`} style={{ marginLeft: 6, fontSize: "0.7em" }}>{ab.designation.toUpperCase()}</span>
                      {badge && <span className={`badge ${badge.color}`} style={{ marginLeft: 6, fontSize: "0.7em" }}>{badge.label}</span>}
                    </div>
                    {ab.name && ab.target && ab.fluorochrome && <div className="dash-card-row"><span>Antibody</span><span>{ab.target}-{ab.fluorochrome}</span></div>}
                    <div className="dash-card-row"><span>Vendor</span><span>{ab.vendor || "—"}</span></div>
                    <div className="dash-card-row"><span>Approved</span><span>{stats?.approved ?? 0}{ab.approved_low_threshold != null ? ` / ${ab.approved_low_threshold}` : ""}</span></div>
                    <div className="dash-card-row"><span>Pending</span><span>{stats?.pending ?? 0}</span></div>
                    <div className="dash-card-row"><span>Total</span><span>{stats?.total ?? 0}{ab.low_stock_threshold != null ? ` / ${ab.low_stock_threshold}` : ""}</span></div>
                    <div className="dash-card-row"><span>Catalog #</span><span>{ab.catalog_number ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>{ab.catalog_number}<CopyButton value={ab.catalog_number} /></span> : "—"}</span></div>
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
                  const color = ab.fluorochrome ? fluoroMap.get(ab.fluorochrome.toLowerCase()) : ab.color ?? undefined;
                  const badge = lowStockBadges.get(ab.id);
                  return (
                    <tr key={ab.id} className="clickable-row" onClick={() => navigateToInventory(ab.id)} onKeyDown={(e) => handleRowKey(e, ab.id)} role="button" tabIndex={0}>
                      <td>
                        {color && <div className="color-dot" style={{ backgroundColor: color }} />}
                        {ab.name || [ab.target, ab.fluorochrome].filter(Boolean).join("-") || "Unnamed"}
                        <span className={`badge badge-designation-${ab.designation}`} style={{ marginLeft: 6, fontSize: "0.75em" }}>{ab.designation.toUpperCase()}</span>
                        {ab.name && ab.target && ab.fluorochrome && <span className="inventory-subtitle">{ab.target}-{ab.fluorochrome}</span>}
                      </td>
                      <td>{ab.vendor || "—"}</td>
                      <td>
                        <span className="badge">{stats?.approved ?? 0}</span>
                        {ab.approved_low_threshold != null && (
                          <span className="text-muted text-xs" style={{ marginLeft: 4 }}>/ {ab.approved_low_threshold}</span>
                        )}
                      </td>
                      <td><span className="badge">{stats?.pending ?? 0}</span></td>
                      <td>
                        <span className="badge">{stats?.total ?? 0}</span>
                        {ab.low_stock_threshold != null && (
                          <span className="text-muted text-xs" style={{ marginLeft: 4 }}>/ {ab.low_stock_threshold}</span>
                        )}
                      </td>
                      <td>{ab.catalog_number ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', whiteSpace: 'nowrap' }}>{ab.catalog_number}<CopyButton value={ab.catalog_number} /></span> : "—"}</td>
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
        </div>
      </div>

      <div className={`dashboard-section-wrapper${selectedCard === "expiring" ? " open" : ""}`}>
        <div className="dashboard-section-inner">
        <div className="dashboard-section" id="dashboard-section-expiring">
          <h2>Expiring Lots</h2>
          {expiringLots.length === 0 ? (
            <p className="page-desc">No expiring lots.</p>
          ) : (
            <LotList
              lots={expiringLots}
              sealedOnly
              canQC={false}
              storageEnabled={false}
              lotAgeBadgeMap={EMPTY_LOT_AGE_MAP}
              hideActions
              hideQc
              hideReceived
              onLotClick={(lot) => navigateToInventory(lot.antibody_id)}
              prefixColumn={{
                header: "Antibody",
                render: (lot) => renderLotPrefix(lot),
              }}
              extraColumns={[
                {
                  header: "Catalog #",
                  render: (lot) => {
                    const catNum = antibodyMap.get(lot.antibody_id)?.catalog_number;
                    return catNum ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', whiteSpace: 'nowrap' }}>{catNum}<CopyButton value={catNum} /></span> : <>&#8212;</>;
                  },
                },
                {
                  header: "Status",
                  render: (lot) => {
                    const isExpired = new Date(lot.expiration_date!) < new Date();
                    return (
                      <span className={`badge ${isExpired ? "badge-red" : "badge-yellow"}`}>
                        {isExpired ? "Expired" : daysUntil(lot.expiration_date!)}
                      </span>
                    );
                  },
                },
                {
                  header: "Backup",
                  render: (lot) => (
                    <>
                      {expiringLotBadges.get(lot.id)?.map((badge, i) => (
                        <span key={i} className={`badge ${badge.color}`} style={{ fontSize: "0.8em" }}>{badge.label}</span>
                      ))}
                    </>
                  ),
                },
              ]}
            />
          )}
        </div>
        </div>
      </div>

    </div>
  );
}
