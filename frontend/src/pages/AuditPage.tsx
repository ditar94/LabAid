import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import api from "../api/client";
import type { Antibody, AuditLogEntry, AuditLogRange, Lot } from "../api/types";
import { useAuth } from "../context/AuthContext";
import { useSharedData } from "../context/SharedDataContext";
import { ClipboardList, Download } from "lucide-react";
import EmptyState from "../components/EmptyState";
import MonthPicker, {
  type DateRange,
  dateRangeLabel,
  dateRangeToParams,
  monthIndex,
  monthIndexFromDate,
  monthRangeFromIndex,
  monthLabelFromIndex,
} from "../components/MonthPicker";
import { openDocumentInNewTab } from "../utils/documents";

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
  { group: "Cocktails", items: [
    { value: "cocktail_recipe.created", label: "Cocktail Created" },
    { value: "cocktail_recipe.updated", label: "Cocktail Updated" },
    { value: "cocktail_lot.created", label: "Lot Prepared" },
    { value: "cocktail_lot.qc_approved", label: "Cocktail QC Approved" },
    { value: "cocktail_lot.qc_failed", label: "Cocktail QC Failed" },
    { value: "cocktail_lot.renewed", label: "Cocktail Renewed" },
    { value: "cocktail_lot.depleted", label: "Cocktail Depleted" },
    { value: "cocktail_lot.archived", label: "Cocktail Archived" },
  ]},
  { group: "Other", items: [
    { value: "document.uploaded", label: "Document Uploaded" },
    { value: "document.updated", label: "Document Updated" },
    { value: "document.deleted", label: "Document Deleted" },
    { value: "cocktail_document.uploaded", label: "Cocktail Doc Uploaded" },
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


interface RangeNotice {
  suggested: DateRange;
  currentLabel: string;
  suggestedLabel: string;
  earliestLabel: string;
  latestLabel: string;
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
  const { labs } = useSharedData();
  const isSuperAdmin = user?.role === "super_admin";
  const [selectedLab, setSelectedLab] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [filterAntibody, setFilterAntibody] = useState("");
  const [filterLot, setFilterLot] = useState("");
  const [filterActions, setFilterActions] = useState<Set<string>>(new Set());
  const [dateRange, setDateRange] = useState<DateRange | null>(null);
  const [actionDropdownOpen, setActionDropdownOpen] = useState(false);
  const actionDropdownRef = useRef<HTMLDivElement>(null);
  const [rangeNoticeDismissed, setRangeNoticeDismissed] = useState(false);

  // Set initial lab for super admin
  useEffect(() => {
    if (isSuperAdmin && labs.length > 0 && !selectedLab) {
      setSelectedLab(labs[0].id);
    }
  }, [isSuperAdmin, labs, selectedLab]);

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

  const labParam = isSuperAdmin && selectedLab ? selectedLab : undefined;

  const { data: antibodies = [] } = useQuery<Antibody[]>({
    queryKey: ["audit-antibodies", labParam],
    queryFn: () => {
      const params: Record<string, string> = {};
      if (labParam) params.lab_id = labParam;
      return api.get("/antibodies/", { params }).then((r) => r.data);
    },
  });

  const { data: lots = [] } = useQuery<Lot[]>({
    queryKey: ["audit-lots", filterAntibody, labParam],
    queryFn: () => {
      const params: Record<string, string> = { antibody_id: filterAntibody, include_archived: "true" };
      if (labParam) params.lab_id = labParam;
      return api.get("/lots/", { params }).then((r) => r.data);
    },
    enabled: !!filterAntibody,
  });

  // Build shared query params for audit fetches
  const actionsKey = useMemo(() => Array.from(filterActions).sort().join(","), [filterActions]);
  const buildAuditParams = (offset: number): Record<string, string> => {
    const params: Record<string, string> = {
      limit: String(PAGE_SIZE),
      offset: String(offset),
    };
    if (labParam) params.lab_id = labParam;
    if (filterAntibody) params.antibody_id = filterAntibody;
    if (filterLot) params.lot_id = filterLot;
    if (filterActions.size > 0) params.action = actionsKey;
    if (dateRange) {
      const dp = dateRangeToParams(dateRange);
      params.date_from = dp.date_from;
      params.date_to = dp.date_to;
    }
    return params;
  };

  const {
    data: auditData,
    isLoading: loadingLogs,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<AuditLogEntry[]>({
    queryKey: ["audit-logs", labParam, filterAntibody, filterLot, actionsKey, dateRange],
    queryFn: ({ pageParam }) => {
      const params = buildAuditParams(pageParam as number);
      return api.get("/audit/", { params }).then((r) => r.data);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      return allPages.reduce((sum, p) => sum + p.length, 0);
    },
  });

  const logs = useMemo(() => auditData?.pages.flat() ?? [], [auditData]);

  // Range notice query
  const hasScope = !!filterLot || !!filterAntibody;
  const { data: rangeNotice } = useQuery<RangeNotice | null>({
    queryKey: ["audit-range", labParam, filterAntibody, filterLot, actionsKey, dateRange],
    queryFn: async () => {
      if (!dateRange) return null;
      const params: Record<string, string> = {};
      if (labParam) params.lab_id = labParam;
      if (filterAntibody) params.antibody_id = filterAntibody;
      if (filterLot) params.lot_id = filterLot;
      if (filterActions.size > 0) params.action = actionsKey;

      const r = await api.get<AuditLogRange>("/audit/range", { params });
      const { min_created_at, max_created_at } = r.data;
      if (!min_created_at || !max_created_at) return null;

      const minIdx = monthIndexFromDate(new Date(min_created_at));
      const maxIdx = monthIndexFromDate(new Date(max_created_at));
      const rangeFromIdx = monthIndex(dateRange.fromYear, dateRange.fromMonth);
      const rangeToIdx = monthIndex(dateRange.toYear, dateRange.toMonth);
      if (rangeFromIdx <= minIdx && rangeToIdx >= maxIdx) return null;

      const suggested = monthRangeFromIndex(minIdx, maxIdx);
      return {
        suggested,
        currentLabel: dateRangeLabel(dateRange),
        suggestedLabel: dateRangeLabel(suggested),
        earliestLabel: monthLabelFromIndex(minIdx),
        latestLabel: monthLabelFromIndex(maxIdx),
      };
    },
    enabled: !!dateRange && hasScope,
  });

  // Reset range notice dismissed when filters change
  useEffect(() => {
    setRangeNoticeDismissed(false);
  }, [filterAntibody, filterLot, filterActions, dateRange, selectedLab]);

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
    <div className="audit-page">
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
        {user?.role === "super_admin" && labs.length > 0 && (
          <select
            aria-label="Filter by lab"
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
          aria-label="Filter by antibody"
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
            aria-label="Filter by lot"
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
      {error && <p className="error">{error}</p>}

      {rangeNotice && !rangeNoticeDismissed && (
        <div className="audit-range-banner">
          <div>
            <strong>Heads up:</strong>{" "}
            {scopeLabel} has events outside {rangeNotice.currentLabel}. Earliest: {rangeNotice.earliestLabel}. Latest: {rangeNotice.latestLabel}. Include {rangeNotice.suggestedLabel}?
          </div>
          <div className="audit-range-actions">
            <button className="btn-sm btn-success" onClick={() => setDateRange(rangeNotice.suggested)}>
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

      <div className="table-scroll">
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
                  log.action.startsWith("cocktail_lot.") || log.action.startsWith("cocktail_recipe.") || log.action.startsWith("cocktail_document.") ? "action-lot" :
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
                        className="btn-chip btn-chip-primary"
                        onClick={() => handleScopeLot(log)}
                        title="Filter to this lot"
                      >
                        lot
                      </button>
                    )}
                    {log.antibody_id && (
                      <button
                        className="btn-chip btn-chip-primary"
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
                {(log.action === "document.uploaded" || log.action === "document.updated") && log.after_state ? (() => {
                  try {
                    const state = JSON.parse(log.after_state);
                    const docId = state.document_id || state.id;
                    if (docId) {
                      return (
                        <a
                          href="#"
                          onClick={async (e) => {
                            e.preventDefault();
                            try {
                              await openDocumentInNewTab(docId);
                            } catch (err: any) {
                              setError(err?.message || "Failed to open document");
                            }
                          }}
                          title="Open document"
                        >
                          {log.note || "View document"}
                        </a>
                      );
                    }
                  } catch { /* ignore parse errors */ }
                  return log.note || "\u2014";
                })() : log.action === "lab.settings_updated" && log.before_state && log.after_state ? (() => {
                  try {
                    const before = JSON.parse(log.before_state).settings || {};
                    const after = JSON.parse(log.after_state).settings || {};
                    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
                    const changes: string[] = [];
                    for (const key of allKeys) {
                      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
                        const label = key.replace(/_/g, " ");
                        changes.push(`${label}: ${String(before[key] ?? "unset")} → ${String(after[key] ?? "unset")}`);
                      }
                    }
                    return changes.length > 0 ? changes.join(", ") : log.note || "\u2014";
                  } catch { return log.note || "\u2014"; }
                })() : (log.note || "\u2014")}
              </td>
            </tr>
          ))}
          {loadingLogs && logs.length === 0 && Array.from({ length: 5 }, (_, i) => (
            <tr key={`skel-${i}`}>
              {[1, 2, 3, 4, 5].map((c) => (
                <td key={c}><span className="shimmer shimmer-text" style={{ width: `${60 + ((i + c) % 4) * 25}px` }} /></td>
              ))}
            </tr>
          ))}
          {!loadingLogs && logs.length === 0 && (
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
      </div>
      {hasNextPage && (
        <div style={{ textAlign: "center", padding: "1rem" }}>
          <button className="btn-sm btn-secondary" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? "Loading..." : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
