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
  ShieldCheck,
  History,
  Download,
} from "lucide-react";
import EmptyState from "../components/EmptyState";

type ReportType = "audit-trail" | "lot-lifecycle" | "qc-history" | "qc-verification";

const REPORT_CARDS: {
  type: ReportType;
  title: string;
  description: string;
  icon: typeof FileText;
  formats: ("csv" | "pdf")[];
}[] = [
  {
    type: "audit-trail",
    title: "Audit Trail Export",
    description: "Full audit log with user, action, entity, and timestamps. Filterable by date range, entity type, and action.",
    icon: ClipboardList,
    formats: ["csv", "pdf"],
  },
  {
    type: "lot-lifecycle",
    title: "Lot Lifecycle Report",
    description: "Per-lot timeline from creation through receiving, QC, opening, and depletion. Select by antibody or specific lot.",
    icon: History,
    formats: ["csv", "pdf"],
  },
  {
    type: "qc-history",
    title: "QC History Export",
    description: "All QC status changes, document uploads, and override events across lots. Filterable by date and antibody.",
    icon: ShieldCheck,
    formats: ["csv", "pdf"],
  },
  {
    type: "qc-verification",
    title: "QC Verification Dossier",
    description: "Single-lot compliance dossier: lot info, QC approval chain, attached documents, and full audit trail.",
    icon: FileText,
    formats: ["pdf"],
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

export default function ReportsPage() {
  useAuth(); // ensure user is authenticated
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

  const { data: antibodies = [] } = useQuery<Antibody[]>({
    queryKey: ["antibodies"],
    queryFn: () => api.get("/antibodies/").then((r) => r.data),
    staleTime: 20_000,
  });

  const { data: lots = [] } = useQuery<Lot[]>({
    queryKey: ["lots", "by-antibody", filterAntibody],
    queryFn: () => api.get("/lots/", { params: { antibody_id: filterAntibody, include_archived: "true" } }).then((r) => r.data),
    enabled: !!filterAntibody,
    staleTime: 20_000,
  });

  // Reset preview when switching reports or changing filters
  useEffect(() => {
    setPreview(null);
  }, [activeReport, filterAntibody, filterLot, dateFrom, dateTo, entityType, actionFilter]);

  const handleCardClick = (type: ReportType) => {
    if (activeReport === type) {
      setActiveReport(null);
    } else {
      setActiveReport(type);
      setPreview(null);
    }
  };

  const buildParams = (): Record<string, string> => {
    const params: Record<string, string> = {};
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    if (entityType && activeReport === "audit-trail") params.entity_type = entityType;
    if (actionFilter && activeReport === "audit-trail") params.action = actionFilter;
    if (filterAntibody && activeReport !== "audit-trail") params.antibody_id = filterAntibody;
    if (filterLot && (activeReport === "lot-lifecycle" || activeReport === "qc-verification")) params.lot_id = filterLot;
    return params;
  };

  const handlePreview = async () => {
    if (!activeReport) return;
    // Validation
    if (activeReport === "lot-lifecycle" && !filterAntibody && !filterLot) {
      addToast("Select an antibody or lot", "warning");
      return;
    }
    if (activeReport === "qc-verification" && !filterLot) {
      addToast("Select a specific lot", "warning");
      return;
    }
    setPreviewLoading(true);
    try {
      const res = await api.get(`/reports/${activeReport}/preview`, { params: buildParams() });
      setPreview(res.data);
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Failed to load preview", "danger");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleDownload = async (format: "csv" | "pdf") => {
    if (!activeReport) return;
    // Validation
    if (activeReport === "lot-lifecycle" && !filterAntibody && !filterLot) {
      addToast("Select an antibody or lot", "warning");
      return;
    }
    if (activeReport === "qc-verification" && !filterLot) {
      addToast("Select a specific lot", "warning");
      return;
    }
    setDownloading(format);
    try {
      const res = await api.get(`/reports/${activeReport}/${format}`, {
        params: buildParams(),
        responseType: "blob",
      });
      const contentDisposition = res.headers["content-disposition"] || "";
      const match = contentDisposition.match(/filename="?([^"]+)"?/);
      const filename = match ? match[1] : `report.${format}`;
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      addToast(`Downloaded ${filename}`, "success");
    } catch (err: any) {
      addToast(err.response?.data?.detail || `Failed to download ${format.toUpperCase()}`, "danger");
    } finally {
      setDownloading(null);
    }
  };

  const renderConfig = () => {
    if (!activeReport) return null;

    const needsAntibody = activeReport !== "audit-trail";
    const needsLot = activeReport === "lot-lifecycle" || activeReport === "qc-verification";
    const needsDateRange = activeReport !== "qc-verification";
    const needsEntityType = activeReport === "audit-trail";
    const lotRequired = activeReport === "qc-verification";
    const card = REPORT_CARDS.find((c) => c.type === activeReport)!;

    return (
      <div className="report-config">
        <div className="report-config-filters">
          {needsDateRange && (
            <>
              <label>
                <span>From</span>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </label>
              <label>
                <span>To</span>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </label>
            </>
          )}
          {needsEntityType && (
            <label>
              <span>Entity Type</span>
              <select value={entityType} onChange={(e) => setEntityType(e.target.value)}>
                {ENTITY_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          )}
          {needsEntityType && (
            <label>
              <span>Action</span>
              <input
                type="text"
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
                placeholder="e.g. vial.opened"
              />
            </label>
          )}
          {needsAntibody && (
            <label>
              <span>Antibody{!needsLot && " (optional)"}</span>
              <select value={filterAntibody} onChange={(e) => { setFilterAntibody(e.target.value); setFilterLot(""); }}>
                <option value="">All antibodies</option>
                {antibodies.map((ab) => (
                  <option key={ab.id} value={ab.id}>{ab.target} {ab.fluorochrome}</option>
                ))}
              </select>
            </label>
          )}
          {needsLot && (
            <label>
              <span>Lot{lotRequired ? " (required)" : ""}</span>
              <select
                value={filterLot}
                onChange={(e) => setFilterLot(e.target.value)}
                disabled={!filterAntibody && lots.length === 0}
              >
                <option value="">{filterAntibody ? "All lots" : "Select antibody first"}</option>
                {lots.map((lot) => (
                  <option key={lot.id} value={lot.id}>{lot.lot_number}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="report-actions">
          <button className="btn-sm btn-secondary" onClick={handlePreview} disabled={previewLoading}>
            {previewLoading ? "Loading..." : "Preview"}
          </button>
          {card.formats.map((fmt) => (
            <button
              key={fmt}
              className="btn-sm btn-green"
              onClick={() => handleDownload(fmt)}
              disabled={downloading === fmt}
            >
              <Download size={14} style={{ marginRight: 4, verticalAlign: -2 }} />
              {downloading === fmt ? "Downloading..." : fmt === "csv" ? "Download CSV" : "Download PDF"}
            </button>
          ))}
        </div>
      </div>
    );
  };

  const renderPreview = () => {
    if (!preview) return null;

    // QC Verification has a different shape
    if (activeReport === "qc-verification") {
      return (
        <div className="report-preview">
          <h3>QC Verification Preview — Lot {preview.lot_number}</h3>
          <div className="report-preview-meta">
            <span>Antibody: {preview.antibody}</span>
            <span>QC Status: {preview.qc_status}</span>
            <span>Documents: {preview.document_count}</span>
            <span>Audit Events: {preview.audit_event_count}</span>
          </div>
          {preview.qc_history && preview.qc_history.length > 0 && (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Action</th>
                    <th>User</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.qc_history.map((row: any, i: number) => (
                    <tr key={i}>
                      <td>{row.timestamp?.slice(0, 19)}</td>
                      <td><span className="action-tag action-lot">{row.action}</span></td>
                      <td>{row.user}</td>
                      <td>{row.note || "\u2014"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      );
    }

    // Lot lifecycle preview shows lot-level rows
    if (activeReport === "lot-lifecycle") {
      const rows = preview.rows || [];
      return (
        <div className="report-preview">
          <h3>Preview ({preview.total} lot{preview.total !== 1 ? "s" : ""})</h3>
          {rows.length === 0 ? (
            <EmptyState icon={FileText} title="No data" description="No lots match the selected filters." />
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Lot</th>
                    <th>Antibody</th>
                    <th>Expiration</th>
                    <th>QC Status</th>
                    <th>Vials</th>
                    <th>Events</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row: any, i: number) => (
                    <tr key={i}>
                      <td>{row.lot_number}</td>
                      <td>{row.antibody}</td>
                      <td>{row.expiration_date || "\u2014"}</td>
                      <td>{row.qc_status}</td>
                      <td>S:{row.sealed} O:{row.opened} D:{row.depleted}</td>
                      <td>{row.event_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      );
    }

    // Audit trail and QC history have flat row lists
    const rows = preview.rows || [];
    const isQcHistory = activeReport === "qc-history";
    return (
      <div className="report-preview">
        <h3>Preview ({preview.total} row{preview.total !== 1 ? "s" : ""}{preview.total > 25 ? ", showing first 25" : ""})</h3>
        {rows.length === 0 ? (
          <EmptyState icon={FileText} title="No data" description="No entries match the selected filters." />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  {isQcHistory && <th>Lot</th>}
                  {isQcHistory && <th>Antibody</th>}
                  <th>Action</th>
                  <th>User</th>
                  {!isQcHistory && <th>Entity Type</th>}
                  <th>Entity</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row: any, i: number) => (
                  <tr key={i}>
                    <td>{row.timestamp?.slice(0, 19)}</td>
                    {isQcHistory && <td>{row.lot_number}</td>}
                    {isQcHistory && <td>{row.antibody}</td>}
                    <td>
                      <span className={`action-tag ${
                        row.action?.startsWith("vial.") || row.action?.startsWith("vials.") ? "action-vial" :
                        row.action?.startsWith("lot.") ? "action-lot" :
                        row.action?.startsWith("antibody.") ? "action-antibody" :
                        row.action?.startsWith("document.") ? "action-lot" :
                        "action-admin"
                      }`}>{row.action}</span>
                    </td>
                    <td>{row.user}</td>
                    {!isQcHistory && <td>{row.entity_type}</td>}
                    <td>{row.entity}</td>
                    <td>{row.note || "\u2014"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <div className="page-header">
        <h1>
          <FileSpreadsheet size={22} style={{ marginRight: 8, verticalAlign: -4 }} />
          Compliance Reports
        </h1>
      </div>

      <div className="report-cards">
        {REPORT_CARDS.map((card) => {
          const Icon = card.icon;
          const isActive = activeReport === card.type;
          return (
            <button
              key={card.type}
              className={`report-card${isActive ? " report-card-active" : ""}`}
              onClick={() => handleCardClick(card.type)}
            >
              <Icon size={24} className="report-card-icon" />
              <div className="report-card-content">
                <div className="report-card-title">{card.title}</div>
                <div className="report-card-desc">{card.description}</div>
              </div>
              <div className="report-card-formats">
                {card.formats.map((f) => (
                  <span key={f} className="report-format-badge">{f.toUpperCase()}</span>
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
