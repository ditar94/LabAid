import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import type { Antibody, Lot } from "../api/types";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import {
  FileText,
  FileSpreadsheet,
  ClipboardList,
  Activity,
  ShieldCheck,
  Download,
  BarChart3,
} from "lucide-react";
import EmptyState from "../components/EmptyState";

type ReportType = "lot-activity" | "usage" | "admin-activity" | "audit-trail";

const REPORT_CARDS: {
  type: ReportType;
  title: string;
  description: string;
  icon: typeof FileText;
  formats: ("csv" | "pdf")[];
  needsAntibody: boolean;
  needsLot: boolean;
}[] = [
  {
    type: "lot-activity",
    title: "Lot Activity",
    description:
      "Per-lot milestones: received, QC, opened dates, vial counts. Select by antibody with optional lot and date range.",
    icon: Activity,
    formats: ["csv", "pdf"],
    needsAntibody: true,
    needsLot: true,
  },
  {
    type: "usage",
    title: "Usage Report",
    description:
      "Consumption analytics: vials received vs consumed, average usage rate per week, and lot status.",
    icon: BarChart3,
    formats: ["csv", "pdf"],
    needsAntibody: true,
    needsLot: true,
  },
  {
    type: "admin-activity",
    title: "Admin Activity",
    description:
      "User management, settings changes, support sessions, and other administrative actions.",
    icon: ShieldCheck,
    formats: ["csv", "pdf"],
    needsAntibody: false,
    needsLot: false,
  },
  {
    type: "audit-trail",
    title: "Audit Trail Export",
    description:
      "Full audit log with user, action, entity, and timestamps. Filterable by date range, entity type, and action.",
    icon: ClipboardList,
    formats: ["csv", "pdf"],
    needsAntibody: false,
    needsLot: false,
  },
];

const ENTITY_TYPE_OPTIONS = [
  { value: "", label: "All types" },
  { value: "vial", label: "Vial" },
  { value: "lot", label: "Lot" },
  { value: "antibody", label: "Antibody" },
  { value: "document", label: "Document" },
  { value: "user", label: "User" },
  { value: "storage_unit", label: "Storage Unit" },
  { value: "lab", label: "Lab" },
];

function fmtDateHint(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

export default function ReportsPage() {
  const { user } = useAuth();
  const { addToast } = useToast();

  const [activeReport, setActiveReport] = useState<ReportType | null>(null);

  // Shared filter state
  const [filterAntibody, setFilterAntibody] = useState("");
  const [filterLot, setFilterLot] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [entityType, setEntityType] = useState("");
  const [actionFilter, setActionFilter] = useState("");

  // Preview state
  const [preview, setPreview] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  // Date range hint
  const [rangeHint, setRangeHint] = useState<{ min: string | null; max: string | null } | null>(null);

  const { data: antibodies = [] } = useQuery<Antibody[]>({
    queryKey: ["antibodies"],
    queryFn: () => api.get("/antibodies/").then((r) => r.data),
    staleTime: 20_000,
  });

  const { data: lots = [] } = useQuery<Lot[]>({
    queryKey: ["lots", "by-antibody", filterAntibody],
    queryFn: () =>
      api
        .get("/lots/", { params: { antibody_id: filterAntibody, include_archived: "true" } })
        .then((r) => r.data),
    enabled: !!filterAntibody,
    staleTime: 20_000,
  });

  // Reset preview when switching reports or changing filters
  useEffect(() => {
    setPreview(null);
  }, [activeReport, filterAntibody, filterLot, dateFrom, dateTo, entityType, actionFilter]);

  // Fetch date range hint when report or antibody changes
  useEffect(() => {
    setRangeHint(null);
    if (!activeReport) return;

    let rangeUrl = "";
    const params: Record<string, string> = {};

    if (activeReport === "lot-activity" || activeReport === "usage") {
      if (!filterAntibody) return;
      rangeUrl = `/reports/${activeReport === "usage" ? "lot-activity" : activeReport}/range`;
      params.antibody_id = filterAntibody;
    } else if (activeReport === "admin-activity") {
      rangeUrl = "/reports/admin-activity/range";
    } else {
      // audit-trail uses the existing audit range endpoint
      rangeUrl = "/audit/range";
    }

    api
      .get(rangeUrl, { params })
      .then((res) => setRangeHint(res.data))
      .catch(() => {});
  }, [activeReport, filterAntibody]);

  const handleCardClick = (type: ReportType) => {
    if (activeReport === type) {
      setActiveReport(null);
    } else {
      setActiveReport(type);
      setPreview(null);
      setRangeHint(null);
    }
  };

  const buildParams = (): Record<string, string> => {
    const params: Record<string, string> = {};
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    if (entityType && activeReport === "audit-trail") params.entity_type = entityType;
    if (actionFilter && activeReport === "audit-trail") params.action = actionFilter;
    if (
      filterAntibody &&
      (activeReport === "lot-activity" || activeReport === "usage")
    )
      params.antibody_id = filterAntibody;
    if (
      filterLot &&
      (activeReport === "lot-activity" || activeReport === "usage")
    )
      params.lot_id = filterLot;
    return params;
  };

  const validate = (): boolean => {
    if (
      (activeReport === "lot-activity" || activeReport === "usage") &&
      !filterAntibody
    ) {
      addToast("Select an antibody", "warning");
      return false;
    }
    return true;
  };

  const handlePreview = async () => {
    if (!activeReport || !validate()) return;
    setPreviewLoading(true);
    try {
      const res = await api.get(`/reports/${activeReport}/preview`, {
        params: buildParams(),
      });
      setPreview(res.data);
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Failed to load preview", "danger");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleDownload = async (format: "csv" | "pdf") => {
    if (!activeReport || !validate()) return;
    setDownloading(format);
    try {
      const res = await api.get(`/reports/${activeReport}/${format}`, {
        params: buildParams(),
        responseType: "blob",
      });
      const contentDisposition = res.headers["content-disposition"] || "";
      const match = contentDisposition.match(/filename="?([^"]+)"?/);
      const filename = match ? match[1] : `report.${format}`;
      const blob = new Blob([res.data], {
        type: format === "pdf" ? "application/pdf" : "text/csv",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      addToast(`Downloaded ${filename}`, "success");
    } catch (err: any) {
      addToast(
        err.response?.data?.detail || `Failed to download ${format.toUpperCase()}`,
        "danger",
      );
    } finally {
      setDownloading(null);
    }
  };

  const card = activeReport ? REPORT_CARDS.find((c) => c.type === activeReport) : null;

  const renderConfig = () => {
    if (!activeReport || !card) return null;

    const isAuditTrail = activeReport === "audit-trail";

    return (
      <div className="report-config">
        <div className="report-config-filters">
          {card.needsAntibody && (
            <label>
              <span>Antibody</span>
              <select
                value={filterAntibody}
                onChange={(e) => {
                  setFilterAntibody(e.target.value);
                  setFilterLot("");
                }}
              >
                <option value="">Select antibody...</option>
                {antibodies.map((ab) => (
                  <option key={ab.id} value={ab.id}>
                    {ab.target} {ab.fluorochrome}
                  </option>
                ))}
              </select>
            </label>
          )}
          {card.needsLot && (
            <label>
              <span>Lot (optional)</span>
              <select
                value={filterLot}
                onChange={(e) => setFilterLot(e.target.value)}
                disabled={!filterAntibody}
              >
                <option value="">
                  {filterAntibody ? "All lots" : "Select antibody first"}
                </option>
                {lots.map((lot) => (
                  <option key={lot.id} value={lot.id}>
                    {lot.lot_number}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            <span>From</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <label>
            <span>To</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
          {isAuditTrail && (
            <>
              <label>
                <span>Entity Type</span>
                <select
                  value={entityType}
                  onChange={(e) => setEntityType(e.target.value)}
                >
                  {ENTITY_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Action</span>
                <input
                  type="text"
                  value={actionFilter}
                  onChange={(e) => setActionFilter(e.target.value)}
                  placeholder="e.g. vial.opened"
                />
              </label>
            </>
          )}
        </div>
        {rangeHint && (rangeHint.min || rangeHint.max) && (
          <p className="text-muted" style={{ fontSize: "0.8rem", margin: "4px 0 0" }}>
            Data available: {fmtDateHint(rangeHint.min) || "?"} &ndash;{" "}
            {fmtDateHint(rangeHint.max) || "?"}
          </p>
        )}
        <div className="report-actions">
          <button
            className="btn-sm btn-secondary"
            onClick={handlePreview}
            disabled={previewLoading}
          >
            {previewLoading ? "Loading..." : "Preview"}
          </button>
          {card.formats.map((fmt) => (
            <button
              key={fmt}
              className="btn-sm btn-green"
              onClick={() => handleDownload(fmt)}
              disabled={downloading === fmt}
            >
              <Download
                size={14}
                style={{ marginRight: 4, verticalAlign: -2 }}
              />
              {downloading === fmt
                ? "Downloading..."
                : fmt === "csv"
                  ? "Download CSV"
                  : "Download PDF"}
            </button>
          ))}
        </div>
      </div>
    );
  };

  const renderPreview = () => {
    if (!preview || !activeReport) return null;

    const rows = preview.rows || [];
    const total: number = preview.total ?? rows.length;

    if (rows.length === 0) {
      return (
        <div className="report-preview">
          <EmptyState
            icon={FileText}
            title="No data"
            description="No entries match the selected filters."
          />
        </div>
      );
    }

    const heading = `Preview (${total} row${total !== 1 ? "s" : ""}${total > rows.length ? `, showing first ${rows.length}` : ""})`;

    if (activeReport === "lot-activity") {
      return (
        <div className="report-preview">
          <h3>{heading}</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Lot #</th>
                  <th>Received</th>
                  <th>Received By</th>
                  <th>QC Doc</th>
                  <th>QC Approved</th>
                  <th>QC Approved By</th>
                  <th>First Opened</th>
                  <th>Last Opened</th>
                  <th>Sealed</th>
                  <th>Opened</th>
                  <th>Depleted</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any, i: number) => (
                  <tr key={i}>
                    <td>{r.lot_number}</td>
                    <td>{r.received || "\u2014"}</td>
                    <td>{r.received_by || "\u2014"}</td>
                    <td>{r.qc_doc}</td>
                    <td>{r.qc_approved || "\u2014"}</td>
                    <td>{r.qc_approved_by || "\u2014"}</td>
                    <td>{r.first_opened || "\u2014"}</td>
                    <td>{r.last_opened || "\u2014"}</td>
                    <td>{r.sealed}</td>
                    <td>{r.opened}</td>
                    <td>{r.depleted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    if (activeReport === "usage") {
      return (
        <div className="report-preview">
          <h3>{heading}</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Lot #</th>
                  <th>Expiration</th>
                  <th>Received</th>
                  <th>Vials Received</th>
                  <th>Vials Consumed</th>
                  <th>First Opened</th>
                  <th>Last Opened</th>
                  <th>Avg/Week</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any, i: number) => (
                  <tr key={i}>
                    <td>{r.lot_number}</td>
                    <td>{r.expiration || "\u2014"}</td>
                    <td>{r.received || "\u2014"}</td>
                    <td>{r.vials_received}</td>
                    <td>{r.vials_consumed}</td>
                    <td>{r.first_opened || "\u2014"}</td>
                    <td>{r.last_opened || "\u2014"}</td>
                    <td>{r.avg_week || "\u2014"}</td>
                    <td>{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    if (activeReport === "admin-activity") {
      return (
        <div className="report-preview">
          <h3>{heading}</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Action</th>
                  <th>Performed By</th>
                  <th>Target</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any, i: number) => (
                  <tr key={i}>
                    <td>{r.timestamp?.slice(0, 19)}</td>
                    <td>
                      <span className="action-tag action-admin">
                        {r.action}
                      </span>
                    </td>
                    <td>{r.performed_by}</td>
                    <td>{r.target}</td>
                    <td>{r.details || "\u2014"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    // audit-trail
    return (
      <div className="report-preview">
        <h3>{heading}</h3>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Action</th>
                <th>User</th>
                <th>Entity Type</th>
                <th>Entity</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any, i: number) => (
                <tr key={i}>
                  <td>{r.timestamp?.slice(0, 19)}</td>
                  <td>
                    <span
                      className={`action-tag ${
                        r.action?.startsWith("vial.") ||
                        r.action?.startsWith("vials.")
                          ? "action-vial"
                          : r.action?.startsWith("lot.")
                            ? "action-lot"
                            : r.action?.startsWith("antibody.")
                              ? "action-antibody"
                              : r.action?.startsWith("document.")
                                ? "action-lot"
                                : "action-admin"
                      }`}
                    >
                      {r.action}
                    </span>
                  </td>
                  <td>{r.user}</td>
                  <td>{r.entity_type}</td>
                  <td>{r.entity}</td>
                  <td>{r.note || "\u2014"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // Admin-only reports: hide admin-activity for non-admin roles
  const visibleCards = REPORT_CARDS.filter((c) => {
    if (c.type === "admin-activity") {
      return user?.role === "super_admin" || user?.role === "lab_admin";
    }
    return true;
  });

  return (
    <div>
      <div className="page-header">
        <h1>
          <FileSpreadsheet
            size={22}
            style={{ marginRight: 8, verticalAlign: -4 }}
          />
          Compliance Reports
        </h1>
      </div>

      <div className="report-cards">
        {visibleCards.map((c) => {
          const Icon = c.icon;
          const isActive = activeReport === c.type;
          return (
            <button
              key={c.type}
              className={`report-card${isActive ? " report-card-active" : ""}`}
              onClick={() => handleCardClick(c.type)}
            >
              <Icon size={24} className="report-card-icon" />
              <div className="report-card-content">
                <div className="report-card-title">{c.title}</div>
                <div className="report-card-desc">{c.description}</div>
              </div>
              <div className="report-card-formats">
                {c.formats.map((f) => (
                  <span key={f} className="report-format-badge">
                    {f.toUpperCase()}
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {renderConfig()}
      {renderPreview()}
    </div>
  );
}
