import { useEffect, useRef, useState } from "react";
import api from "../api/client";
import type { Antibody, AuditLogEntry, AuditLogRange, Lab, Lot } from "../api/types";
import { useAuth } from "../context/AuthContext";
import { ClipboardList, Download } from "lucide-react";
import EmptyState from "../components/EmptyState";

const ACTION_OPTIONS = [
  { group: "Vials", items: [
    { value: "vial.received", label: "Received" },
    { value: "vial.stocked", label: "Stocked" },
    { value: "vial.opened", label: "Opened" },
    { value: "vial.depleted", label: "Depleted" },
    { value: "vial.returned_to_storage", label: "Returned to Storage" },
    { value: "vial.corrected", label: "Corrected" },
    { value: "vials.moved", label: "Vials Moved" },
  ]},
  { group: "Lots", items: [
    { value: "lot.created", label: "Lot Created" },
    { value: "lot.qc_approved", label: "QC Approved" },
    { value: "lot.qc_pending", label: "QC Pending" },
    { value: "lot.qc_failed", label: "QC Failed" },
    { value: "lot.archived", label: "Lot Archived" },
    { value: "lot.unarchived", label: "Lot Unarchived" },
  ]},
  { group: "Antibodies", items: [
    { value: "antibody.created", label: "Ab Created" },
    { value: "antibody.updated", label: "Ab Updated" },
    { value: "antibody.archived", label: "Ab Archived" },
    { value: "antibody.unarchived", label: "Ab Unarchived" },
  ]},
  { group: "Other", items: [
    { value: "document.uploaded", label: "Document Uploaded" },
    { value: "user.created", label: "User Created" },
    { value: "user.password_reset", label: "Password Reset" },
    { value: "storage_unit.created", label: "Storage Unit Created" },
  ]},
  { group: "Support", items: [
    { value: "support.impersonate_start", label: "Impersonation Started" },
    { value: "support.impersonate_end", label: "Impersonation Ended" },
    { value: "lab.settings_updated", label: "Lab Settings Updated" },
  ]},
];

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface DateRange {
  fromYear: number;
  fromMonth: number; // 0-indexed
  toYear: number;
  toMonth: number;   // 0-indexed, inclusive
}

function dateRangeLabel(r: DateRange): string {
  if (r.fromYear === r.toYear && r.fromMonth === 0 && r.toMonth === 11) {
    return `${r.fromYear}`;
  }
  if (r.fromYear === r.toYear && r.fromMonth === r.toMonth) {
    return `${MONTH_NAMES[r.fromMonth]} ${r.fromYear}`;
  }
  if (r.fromYear === r.toYear) {
    return `${MONTH_NAMES[r.fromMonth]}–${MONTH_NAMES[r.toMonth]} ${r.fromYear}`;
  }
  return `${MONTH_NAMES[r.fromMonth]} ${r.fromYear} – ${MONTH_NAMES[r.toMonth]} ${r.toYear}`;
}

function dateRangeToParams(r: DateRange): { date_from: string; date_to: string } {
  const df = `${r.fromYear}-${String(r.fromMonth + 1).padStart(2, "0")}-01`;
  // date_to is exclusive: first day of the month AFTER toMonth
  const nextM = r.toMonth === 11 ? 0 : r.toMonth + 1;
  const nextY = r.toMonth === 11 ? r.toYear + 1 : r.toYear;
  const dt = `${nextY}-${String(nextM + 1).padStart(2, "0")}-01`;
  return { date_from: df, date_to: dt };
}

function monthIndex(year: number, month: number) {
  return year * 12 + month;
}

function monthIndexFromDate(d: Date) {
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

function monthRangeFromIndex(fromIdx: number, toIdx: number): DateRange {
  return {
    fromYear: Math.floor(fromIdx / 12),
    fromMonth: fromIdx % 12,
    toYear: Math.floor(toIdx / 12),
    toMonth: toIdx % 12,
  };
}

function monthLabelFromIndex(idx: number) {
  const year = Math.floor(idx / 12);
  const month = idx % 12;
  return `${MONTH_NAMES[month]} ${year}`;
}

interface RangeNotice {
  suggested: DateRange;
  currentLabel: string;
  suggestedLabel: string;
  earliestLabel: string;
  latestLabel: string;
}

function MonthPicker({
  value,
  onChange,
  onClear,
}: {
  value: DateRange | null;
  onChange: (r: DateRange) => void;
  onClear: () => void;
}) {
  const now = new Date();
  const [viewYear, setViewYear] = useState(value?.fromYear ?? now.getFullYear());
  const [open, setOpen] = useState(false);
  const [rangeStart, setRangeStart] = useState<{ year: number; month: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setRangeStart(null);
      }
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [open]);

  const isFuture = (y: number, m: number) =>
    y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth());

  const isInRange = (y: number, m: number) => {
    if (!value) return false;
    const v = y * 12 + m;
    const from = value.fromYear * 12 + value.fromMonth;
    const to = value.toYear * 12 + value.toMonth;
    return v >= from && v <= to;
  };

  const isRangeStart = (y: number, m: number) =>
    value?.fromYear === y && value?.fromMonth === m;
  const isRangeEnd = (y: number, m: number) =>
    value?.toYear === y && value?.toMonth === m;

  const handleMonthClick = (month: number, e: React.MouseEvent) => {
    if (e.shiftKey && rangeStart) {
      // Shift+click: create range from rangeStart to this month
      const a = rangeStart.year * 12 + rangeStart.month;
      const b = viewYear * 12 + month;
      const from = Math.min(a, b);
      const to = Math.max(a, b);
      onChange({
        fromYear: Math.floor(from / 12),
        fromMonth: from % 12,
        toYear: Math.floor(to / 12),
        toMonth: to % 12,
      });
      setRangeStart(null);
    } else {
      // Single click: select one month and remember as range start
      onChange({ fromYear: viewYear, fromMonth: month, toYear: viewYear, toMonth: month });
      setRangeStart({ year: viewYear, month });
    }
  };

  const handleYearClick = () => {
    const lastMonth = viewYear === now.getFullYear() ? now.getMonth() : 11;
    onChange({ fromYear: viewYear, fromMonth: 0, toYear: viewYear, toMonth: lastMonth });
    setRangeStart(null);
    setOpen(false);
  };

  const label = value ? dateRangeLabel(value) : "All time";

  return (
    <div className="month-picker" ref={ref}>
      <button
        className="month-picker-trigger"
        onClick={() => setOpen(!open)}
      >
        {label}
        <span className="action-multiselect-arrow">{open ? "\u25B2" : "\u25BC"}</span>
      </button>
      {open && (
        <div className="month-picker-dropdown">
          <div className="month-picker-header">
            <button onClick={() => setViewYear((y) => y - 1)}>&lsaquo;</button>
            <button className="month-picker-year-btn" onClick={handleYearClick} title="Select entire year">
              {viewYear}
            </button>
            <button
              onClick={() => setViewYear((y) => y + 1)}
              disabled={viewYear >= now.getFullYear()}
            >
              &rsaquo;
            </button>
          </div>
          {rangeStart && (
            <div className="month-picker-hint">Shift+click to select range</div>
          )}
          <div className="month-picker-grid">
            {MONTH_NAMES.map((name, i) => {
              const future = isFuture(viewYear, i);
              const inRange = isInRange(viewYear, i);
              const start = isRangeStart(viewYear, i);
              const end = isRangeEnd(viewYear, i);
              let cls = "month-picker-cell";
              if (inRange) cls += " in-range";
              if (start) cls += " range-start";
              if (end) cls += " range-end";
              if (start && end) cls += " selected";
              if (future) cls += " disabled";
              return (
                <button
                  key={i}
                  className={cls}
                  disabled={future}
                  onClick={(e) => handleMonthClick(i, e)}
                >
                  {name}
                </button>
              );
            })}
          </div>
          <div className="month-picker-footer">
            {value && (
              <button className="month-picker-clear" onClick={() => { onClear(); setRangeStart(null); setOpen(false); }}>
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function exportAuditCsv(logs: AuditLogEntry[]) {
  const headers = ["Timestamp", "User", "Action", "Entity Type", "Entity", "Note", "Support Action"];
  const rows = logs.map((log) => [
    new Date(log.created_at).toISOString(),
    log.user_full_name || log.user_id,
    log.action,
    log.entity_type,
    log.entity_label || log.entity_id,
    log.note || "",
    log.is_support_action ? "Yes" : "No",
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const PAGE_SIZE = 100;

export default function AuditPage() {
  const { user } = useAuth();
  const [labs, setLabs] = useState<Lab[]>([]);
  const [selectedLab, setSelectedLab] = useState<string>("");
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);

  // Filter state
  const [antibodies, setAntibodies] = useState<Antibody[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [filterAntibody, setFilterAntibody] = useState("");
  const [filterLot, setFilterLot] = useState("");
  const [filterActions, setFilterActions] = useState<Set<string>>(new Set());
  const [dateRange, setDateRange] = useState<DateRange | null>(null);
  const [actionDropdownOpen, setActionDropdownOpen] = useState(false);
  const actionDropdownRef = useRef<HTMLDivElement>(null);
  const [rangeNotice, setRangeNotice] = useState<RangeNotice | null>(null);
  const [rangeNoticeDismissed, setRangeNoticeDismissed] = useState(false);

  // Close action dropdown on outside click
  useEffect(() => {
    if (!actionDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (actionDropdownRef.current && !actionDropdownRef.current.contains(e.target as Node)) {
        setActionDropdownOpen(false);
      }
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [actionDropdownOpen]);

  // Load labs for super admin
  useEffect(() => {
    if (user?.role === "super_admin") {
      api.get("/labs/").then((r) => {
        setLabs(r.data);
        if (r.data.length > 0) setSelectedLab(r.data[0].id);
      });
    }
  }, [user]);

  // Load antibodies
  useEffect(() => {
    const params: Record<string, string> = {};
    if (user?.role === "super_admin" && selectedLab) params.lab_id = selectedLab;
    api.get("/antibodies/", { params }).then((r) => setAntibodies(r.data));
  }, [selectedLab, user]);

  // Load lots when antibody changes
  useEffect(() => {
    if (!filterAntibody) {
      setLots([]);
      return;
    }
    const params: Record<string, string> = { antibody_id: filterAntibody, include_archived: "true" };
    if (user?.role === "super_admin" && selectedLab) params.lab_id = selectedLab;
    api.get("/lots/", { params }).then((r) => setLots(r.data));
  }, [filterAntibody, selectedLab]);

  // Build shared query params for audit fetches
  const buildAuditParams = (offset: number): Record<string, string> => {
    const params: Record<string, string> = {
      limit: String(PAGE_SIZE),
      offset: String(offset),
    };
    if (user?.role === "super_admin" && selectedLab) params.lab_id = selectedLab;
    if (filterAntibody) params.antibody_id = filterAntibody;
    if (filterLot) params.lot_id = filterLot;
    if (filterActions.size > 0) params.action = Array.from(filterActions).join(",");
    if (dateRange) {
      const dp = dateRangeToParams(dateRange);
      params.date_from = dp.date_from;
      params.date_to = dp.date_to;
    }
    return params;
  };

  // Load first page of audit logs when filters change
  useEffect(() => {
    const params = buildAuditParams(0);
    api.get("/audit/", { params }).then((r) => {
      setLogs(r.data);
      setHasMore(r.data.length === PAGE_SIZE);
    });
  }, [filterAntibody, filterLot, filterActions, dateRange, selectedLab]);

  const loadMore = () => {
    const params = buildAuditParams(logs.length);
    api.get("/audit/", { params }).then((r) => {
      setLogs((prev) => [...prev, ...r.data]);
      setHasMore(r.data.length === PAGE_SIZE);
    });
  };

  useEffect(() => {
    setRangeNoticeDismissed(false);
  }, [filterAntibody, filterLot, filterActions, dateRange, selectedLab]);

  useEffect(() => {
    let cancelled = false;
    const hasScope = !!filterLot || !!filterAntibody;
    if (!dateRange || !hasScope) {
      setRangeNotice(null);
      return () => {
        cancelled = true;
      };
    }
    const activeRange = dateRange;

    const params: Record<string, string> = {};
    if (user?.role === "super_admin" && selectedLab) params.lab_id = selectedLab;
    if (filterAntibody) params.antibody_id = filterAntibody;
    if (filterLot) params.lot_id = filterLot;
    if (filterActions.size > 0) params.action = Array.from(filterActions).join(",");

    api.get<AuditLogRange>("/audit/range", { params })
      .then((r) => {
        if (cancelled) return;
        const { min_created_at, max_created_at } = r.data;
        if (!min_created_at || !max_created_at) {
          setRangeNotice(null);
          return;
        }

        const minIdx = monthIndexFromDate(new Date(min_created_at));
        const maxIdx = monthIndexFromDate(new Date(max_created_at));
        const rangeFromIdx = monthIndex(activeRange.fromYear, activeRange.fromMonth);
        const rangeToIdx = monthIndex(activeRange.toYear, activeRange.toMonth);
        if (rangeFromIdx <= minIdx && rangeToIdx >= maxIdx) {
          setRangeNotice(null);
          return;
        }

        const suggested = monthRangeFromIndex(minIdx, maxIdx);
        setRangeNotice({
          suggested,
          currentLabel: dateRangeLabel(activeRange),
          suggestedLabel: dateRangeLabel(suggested),
          earliestLabel: monthLabelFromIndex(minIdx),
          latestLabel: monthLabelFromIndex(maxIdx),
        });
      })
      .catch(() => {
        if (!cancelled) setRangeNotice(null);
      });

    return () => {
      cancelled = true;
    };
  }, [dateRange, filterAntibody, filterLot, filterActions, selectedLab, user]);

  const toggleAction = (value: string) => {
    setFilterActions((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const actionLabel = filterActions.size === 0
    ? "Actions"
    : filterActions.size === 1
    ? ACTION_OPTIONS.flatMap((g) => g.items).find((i) => filterActions.has(i.value))?.label || "1 action"
    : `${filterActions.size} actions`;

  // Build active filter chips
  const activeFilters: { key: string; label: string; onClear: () => void }[] = [];
  if (filterAntibody) {
    const ab = antibodies.find((a) => a.id === filterAntibody);
    activeFilters.push({
      key: "ab",
      label: ab ? `${ab.target} ${ab.fluorochrome}` : "Antibody",
      onClear: () => { setFilterAntibody(""); setFilterLot(""); },
    });
  }
  if (filterLot) {
    const lot = lots.find((l) => l.id === filterLot);
    activeFilters.push({
      key: "lot",
      label: lot ? `Lot ${lot.lot_number}` : "Lot",
      onClear: () => setFilterLot(""),
    });
  }
  if (filterActions.size > 0) {
    const labels = ACTION_OPTIONS.flatMap((g) => g.items)
      .filter((i) => filterActions.has(i.value))
      .map((i) => i.label);
    activeFilters.push({
      key: "actions",
      label: labels.join(", "),
      onClear: () => setFilterActions(new Set()),
    });
  }
  if (dateRange) {
    activeFilters.push({
      key: "date",
      label: dateRangeLabel(dateRange),
      onClear: () => setDateRange(null),
    });
  }

  // Handlers for inline scope buttons on rows
  const handleScopeLot = (log: AuditLogEntry) => {
    if (!log.lot_id) return;
    if (!filterAntibody && log.antibody_id) {
      setFilterAntibody(log.antibody_id);
    }
    setFilterLot(log.lot_id);
  };

  const handleScopeAntibody = (log: AuditLogEntry) => {
    if (!log.antibody_id) return;
    setFilterAntibody(log.antibody_id);
    setFilterLot("");
  };

  const clearAll = () => {
    setFilterAntibody("");
    setFilterLot("");
    setFilterActions(new Set());
    setDateRange(null);
  };

  const scopeLabel = (() => {
    if (filterLot) {
      const lot = lots.find((l) => l.id === filterLot);
      return lot ? `Lot ${lot.lot_number}` : "This lot";
    }
    if (filterAntibody) {
      const ab = antibodies.find((a) => a.id === filterAntibody);
      return ab ? `${ab.target} ${ab.fluorochrome}` : "This antibody";
    }
    return "This selection";
  })();

  return (
    <div>
      <div className="page-header">
        <h1>Audit Log</h1>
        <button
          className="btn-sm btn-secondary"
          onClick={() => exportAuditCsv(logs)}
          disabled={logs.length === 0}
        >
          <Download size={14} style={{ marginRight: 4, verticalAlign: -2 }} />
          Export CSV
        </button>
      </div>

      <div className="audit-filters">
        {user?.role === "super_admin" && (
          <select
            value={selectedLab}
            onChange={(e) => setSelectedLab(e.target.value)}
          >
            <option value="">All Labs</option>
            {labs.map((lab) => (
              <option key={lab.id} value={lab.id}>{lab.name}</option>
            ))}
          </select>
        )}

        <select
          value={filterAntibody}
          onChange={(e) => { setFilterAntibody(e.target.value); setFilterLot(""); }}
        >
          <option value="">All antibodies</option>
          {antibodies.map((ab) => (
            <option key={ab.id} value={ab.id}>
              {ab.target} {ab.fluorochrome}
            </option>
          ))}
        </select>

        {filterAntibody && lots.length > 0 && (
          <select
            value={filterLot}
            onChange={(e) => setFilterLot(e.target.value)}
          >
            <option value="">All lots</option>
            {lots.map((lot) => (
              <option key={lot.id} value={lot.id}>
                {lot.lot_number}
              </option>
            ))}
          </select>
        )}

        <div className="action-multiselect" ref={actionDropdownRef}>
          <button
            className="action-multiselect-trigger"
            onClick={() => setActionDropdownOpen(!actionDropdownOpen)}
          >
            {actionLabel}
            <span className="action-multiselect-arrow">{actionDropdownOpen ? "\u25B2" : "\u25BC"}</span>
          </button>
          {actionDropdownOpen && (
            <div className="action-multiselect-dropdown">
              {ACTION_OPTIONS.map((group) => (
                <div key={group.group}>
                  <div className="action-multiselect-group">{group.group}</div>
                  {group.items.map((item) => (
                    <label key={item.value} className="action-multiselect-item">
                      <input
                        type="checkbox"
                        checked={filterActions.has(item.value)}
                        onChange={() => toggleAction(item.value)}
                      />
                      {item.label}
                    </label>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <MonthPicker
          value={dateRange}
          onChange={setDateRange}
          onClear={() => setDateRange(null)}
        />
      </div>

      {rangeNotice && !rangeNoticeDismissed && (
        <div className="audit-range-banner">
          <div>
            <strong>Heads up:</strong>{" "}
            {scopeLabel} has events outside {rangeNotice.currentLabel}. Earliest: {rangeNotice.earliestLabel}. Latest: {rangeNotice.latestLabel}. Include {rangeNotice.suggestedLabel}?
          </div>
          <div className="audit-range-actions">
            <button className="btn-sm btn-green" onClick={() => setDateRange(rangeNotice.suggested)}>
              Include months
            </button>
            <button className="btn-sm btn-secondary" onClick={() => setRangeNoticeDismissed(true)}>
              Keep current
            </button>
          </div>
        </div>
      )}

      {activeFilters.length > 0 && (
        <div className="scope-chips">
          {activeFilters.map((f) => (
            <span key={f.key} className="scope-chip">
              {f.label}
              <button onClick={f.onClear} title="Clear">&times;</button>
            </span>
          ))}
          {activeFilters.length > 1 && (
            <button className="scope-clear-all" onClick={clearAll}>
              Clear all
            </button>
          )}
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>User</th>
            <th>Action</th>
            <th>Entity</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id}>
              <td>{new Date(log.created_at).toLocaleString()}</td>
              <td>{log.user_full_name || log.user_id.slice(0, 8)}</td>
              <td>
                <span className={`action-tag ${
                  log.action.startsWith("vial.") || log.action.startsWith("vials.") ? "action-vial" :
                  log.action.startsWith("lot.") ? "action-lot" :
                  log.action.startsWith("antibody.") ? "action-antibody" :
                  log.action.startsWith("user.") || log.action.startsWith("lab.") || log.action.startsWith("storage_unit.") || log.action.startsWith("support.") ? "action-admin" :
                  ""
                }`}>{log.action}</span>
                {log.is_support_action && (
                  <span className="badge badge-warning" style={{ marginLeft: 4, fontSize: "0.65rem" }}>Support</span>
                )}
              </td>
              <td>
                {log.entity_label ? (
                  <span title={log.entity_id}>{log.entity_label}</span>
                ) : (
                  <span>
                    {log.entity_type}{" "}
                    <span className="mono" style={{ fontSize: "0.8em" }}>
                      {log.entity_id.slice(0, 8)}
                    </span>
                  </span>
                )}
                {(log.lot_id || log.antibody_id) && (
                  <span className="scope-btns">
                    {log.lot_id && (
                      <button
                        className="scope-btn"
                        onClick={() => handleScopeLot(log)}
                        title="Filter to this lot"
                      >
                        lot
                      </button>
                    )}
                    {log.antibody_id && (
                      <button
                        className="scope-btn"
                        onClick={() => handleScopeAntibody(log)}
                        title="Filter to this antibody"
                      >
                        ab
                      </button>
                    )}
                  </span>
                )}
              </td>
              <td>
                {log.action === "document.uploaded" && log.after_state ? (() => {
                  try {
                    const state = JSON.parse(log.after_state);
                    if (state.document_id) {
                      return (
                        <a
                          href="#"
                          onClick={async (e) => {
                            e.preventDefault();
                            const res = await api.get(`/documents/${state.document_id}`, { responseType: "blob" });
                            const url = URL.createObjectURL(res.data);
                            const w = window.open(url, "_blank", "noopener,noreferrer");
                            if (!w) { const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.click(); }
                            setTimeout(() => URL.revokeObjectURL(url), 60_000);
                          }}
                          title="Open document"
                        >
                          {log.note || "View document"}
                        </a>
                      );
                    }
                  } catch { /* ignore parse errors */ }
                  return log.note || "\u2014";
                })() : (log.note || "\u2014")}
              </td>
            </tr>
          ))}
          {logs.length === 0 && (
            <tr>
              <td colSpan={5}>
                <EmptyState
                  icon={ClipboardList}
                  title="No audit entries"
                  description="Audit events will appear here as actions are performed."
                />
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {hasMore && (
        <div style={{ textAlign: "center", padding: "1rem" }}>
          <button className="btn-sm btn-secondary" onClick={loadMore}>
            Load more
          </button>
        </div>
      )}
    </div>
  );
}
