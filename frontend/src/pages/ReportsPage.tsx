import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import type { Antibody, CocktailLot, CocktailRecipe, Lot } from "../api/types";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import MonthPicker, {
  type DateRange,
  dateRangeToParams,
} from "../components/MonthPicker";
import {
  FileText,
  FileSpreadsheet,
  ClipboardList,
  Activity,
  ShieldCheck,
  Download,
  BarChart3,
  FlaskConical,
} from "lucide-react";
import EmptyState from "../components/EmptyState";

type ReportType = "lot-activity" | "usage" | "usage-trend" | "cocktail-lots" | "admin-activity" | "audit-trail";

const REPORT_CARDS: {
  type: ReportType;
  title: string;
  description: string;
  icon: typeof FileText;
  formats: ("csv" | "pdf")[];
  needsAntibody: boolean;
  needsLot: boolean;
  needsRecipe?: boolean;
  dateLabel: string;
}[] = [
  {
    type: "lot-activity",
    title: "Lot Activity",
    description:
      "Per-lot milestones: received, QC, opened dates. Select by antibody or view all with optional lot and date range.",
    icon: Activity,
    formats: ["csv", "pdf"],
    needsAntibody: true,
    needsLot: true,
    dateLabel: "Received Date",
  },
  {
    type: "usage",
    title: "Usage by Lot",
    description:
      "Consumption analytics per lot: vials received vs consumed, average usage rate per week, and lot status.",
    icon: BarChart3,
    formats: ["csv", "pdf"],
    needsAntibody: true,
    needsLot: true,
    dateLabel: "Usage Date",
  },
  {
    type: "usage-trend",
    title: "Usage by Month",
    description:
      "Monthly consumption trend: vials opened, active lots, and average usage rate per week for each month.",
    icon: BarChart3,
    formats: ["csv", "pdf"],
    needsAntibody: true,
    needsLot: false,
    dateLabel: "Usage Date",
  },
  {
    type: "cocktail-lots",
    title: "Cocktail Lots",
    description:
      "Cocktail lot traceability: recipe, source lots, preparation and expiration dates, QC status, and renewals.",
    icon: FlaskConical,
    formats: ["csv", "pdf"],
    needsAntibody: false,
    needsLot: false,
    needsRecipe: true,
    dateLabel: "Preparation Date",
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
    dateLabel: "Activity Date",
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
    dateLabel: "Event Date",
  },
];

const ENTITY_TYPE_OPTIONS = [
  { value: "", label: "All types" },
  { value: "vial", label: "Vial" },
  { value: "lot", label: "Lot" },
  { value: "antibody", label: "Antibody" },
  { value: "document", label: "Document" },
  { value: "cocktail_recipe", label: "Cocktail Recipe" },
  { value: "cocktail_lot", label: "Cocktail Lot" },
  { value: "cocktail_document", label: "Cocktail Document" },
  { value: "user", label: "User" },
  { value: "storage_unit", label: "Storage Unit" },
  { value: "lab", label: "Lab" },
];

export default function ReportsPage() {
  const { user, labSettings } = useAuth();
  const { addToast } = useToast();
  const cocktailsEnabled = labSettings.cocktails_enabled === true;

  const [activeReport, setActiveReport] = useState<ReportType | null>(null);

  // Shared filter state
  const [filterAntibody, setFilterAntibody] = useState("");
  const [filterLot, setFilterLot] = useState("");
  const [filterRecipe, setFilterRecipe] = useState("");
  const [filterCocktailLot, setFilterCocktailLot] = useState("");
  const [dateRange, setDateRange] = useState<DateRange | null>(null);
  const [entityType, setEntityType] = useState("");
  const [actionFilter, setActionFilter] = useState("");

  // Preview state
  const [preview, setPreview] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  // Doc export state
  const [includeDocs, setIncludeDocs] = useState(false);
  const [exportFormat, setExportFormat] = useState<"zip" | "combined_pdf">("zip");

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

  const { data: recipes = [] } = useQuery<CocktailRecipe[]>({
    queryKey: ["cocktail-recipes"],
    queryFn: () => api.get("/cocktails/recipes").then((r) => r.data),
    enabled: cocktailsEnabled && activeReport === "cocktail-lots",
    staleTime: 20_000,
  });

  const { data: cocktailLots = [] } = useQuery<CocktailLot[]>({
    queryKey: ["cocktail-lots", "by-recipe", filterRecipe],
    queryFn: () =>
      api
        .get("/cocktails/lots", { params: { recipe_id: filterRecipe } })
        .then((r) => r.data),
    enabled: !!filterRecipe,
    staleTime: 20_000,
  });

  // Reset preview when switching reports or changing filters
  useEffect(() => {
    setPreview(null);
  }, [activeReport, filterAntibody, filterLot, filterRecipe, filterCocktailLot, dateRange, entityType, actionFilter]);

  const handleCardClick = (type: ReportType) => {
    if (activeReport === type) {
      setActiveReport(null);
    } else {
      setActiveReport(type);
      setPreview(null);
    }
  };

  const isAllAntibodies = (activeReport === "lot-activity" || activeReport === "usage" || activeReport === "usage-trend") && !filterAntibody;

  const buildParams = (): Record<string, string> => {
    const params: Record<string, string> = {};
    if (dateRange) {
      const { date_from, date_to } = dateRangeToParams(dateRange);
      params.date_from = date_from;
      params.date_to = date_to;
    }
    if (entityType && activeReport === "audit-trail") params.entity_type = entityType;
    if (actionFilter && activeReport === "audit-trail") params.action = actionFilter;
    if (
      filterAntibody &&
      (activeReport === "lot-activity" || activeReport === "usage" || activeReport === "usage-trend")
    )
      params.antibody_id = filterAntibody;
    if (
      filterLot &&
      (activeReport === "lot-activity" || activeReport === "usage")
    )
      params.lot_id = filterLot;
    if (filterRecipe && activeReport === "cocktail-lots")
      params.recipe_id = filterRecipe;
    if (filterCocktailLot && activeReport === "cocktail-lots")
      params.lot_id = filterCocktailLot;
    return params;
  };

  const handlePreview = async () => {
    if (!activeReport) return;
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
    if (!activeReport) return;
    setDownloading(format);
    try {
      const params = buildParams();
      params.tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await api.get(`/reports/${activeReport}/${format}`, {
        params,
        responseType: "blob",
      });
      const contentDisposition = res.headers["content-disposition"] || "";
      const match = contentDisposition.match(/filename="?([^"]+)"?/);
      const filename = match ? match[1] : `report.${format}`;
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      addToast(`Downloaded ${filename}`, "success");
    } catch (err: any) {
      let message = `Failed to download ${format.toUpperCase()}`;
      if (err.response?.data instanceof Blob) {
        try {
          const text = await err.response.data.text();
          const json = JSON.parse(text);
          if (json.detail) message = json.detail;
        } catch { /* use default message */ }
      } else if (err.response?.data?.detail) {
        message = err.response.data.detail;
      }
      addToast(message, "danger");
    } finally {
      setDownloading(null);
    }
  };

  const handleExportWithDocs = async () => {
    if (!activeReport) return;
    setDownloading("export");
    try {
      const params = buildParams();
      params.tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      params.format = exportFormat;
      const res = await api.get(`/reports/${activeReport}/export`, {
        params,
        responseType: "blob",
      });
      const contentDisposition = res.headers["content-disposition"] || "";
      const match = contentDisposition.match(/filename="?([^"]+)"?/);
      const ext = exportFormat === "combined_pdf" ? "pdf" : "zip";
      const filename = match ? match[1] : `report_with_docs.${ext}`;
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      addToast(`Downloaded ${filename}`, "success");
    } catch (err: any) {
      let message = "Failed to export with documents";
      if (err.response?.data instanceof Blob) {
        try {
          const text = await err.response.data.text();
          const json = JSON.parse(text);
          if (json.detail) message = json.detail;
        } catch { /* use default message */ }
      } else if (err.response?.data?.detail) {
        message = err.response.data.detail;
      }
      addToast(message, "danger");
    } finally {
      setDownloading(null);
    }
  };

  const supportsExport = activeReport === "lot-activity" || activeReport === "usage" || activeReport === "cocktail-lots";

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
                <option value="">All antibodies</option>
                {antibodies.map((ab) => (
                  <option key={ab.id} value={ab.id}>
                    {ab.target} {ab.fluorochrome}
                  </option>
                ))}
              </select>
            </label>
          )}
          {card.needsLot && filterAntibody && (
            <label>
              <span>Lot (optional)</span>
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
            </label>
          )}
          {card.needsRecipe && (
            <label>
              <span>Recipe</span>
              <select
                value={filterRecipe}
                onChange={(e) => {
                  setFilterRecipe(e.target.value);
                  setFilterCocktailLot("");
                }}
              >
                <option value="">All recipes</option>
                {recipes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {card.needsRecipe && filterRecipe && (
            <label>
              <span>Lot (optional)</span>
              <select
                value={filterCocktailLot}
                onChange={(e) => setFilterCocktailLot(e.target.value)}
              >
                <option value="">All lots</option>
                {cocktailLots.map((cl) => (
                  <option key={cl.id} value={cl.id}>
                    {cl.lot_number}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            <span>{card.dateLabel}</span>
            <MonthPicker
              value={dateRange}
              onChange={setDateRange}
              onClear={() => setDateRange(null)}
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
          {supportsExport && (
            <>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.85em", color: "var(--text-secondary)", cursor: "pointer", marginLeft: 8 }}>
                <input type="checkbox" checked={includeDocs} onChange={(e) => setIncludeDocs(e.target.checked)} />
                Include QC docs
              </label>
              {includeDocs && (
                <>
                  <select
                    value={exportFormat}
                    onChange={(e) => setExportFormat(e.target.value as "zip" | "combined_pdf")}
                    style={{ fontSize: "0.85em", padding: "2px 4px" }}
                  >
                    <option value="zip">ZIP archive</option>
                    <option value="combined_pdf">Combined PDF</option>
                  </select>
                  <button
                    className="btn-sm btn-green"
                    onClick={handleExportWithDocs}
                    disabled={downloading === "export"}
                  >
                    <Download size={14} style={{ marginRight: 4, verticalAlign: -2 }} />
                    {downloading === "export" ? "Exporting..." : "Export with Docs"}
                  </button>
                </>
              )}
            </>
          )}
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
      // Group by antibody when "All Antibodies" selected
      if (isAllAntibodies) {
        const groups: Record<string, any[]> = {};
        for (const r of rows) {
          const ab = r.antibody_full || r.antibody || "Unknown";
          (groups[ab] ??= []).push(r);
        }
        return (
          <div className="report-preview">
            <h3>{heading}</h3>
            {Object.entries(groups).map(([abName, groupRows]) => (
              <div key={abName} style={{ marginBottom: 20 }}>
                <h4 style={{ fontSize: "0.85rem", margin: "12px 0 6px", color: "var(--text-secondary)" }}>{abName}</h4>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Lot #</th>
                        <th>Expiration</th>
                        <th>Received</th>
                        <th>Received By</th>
                        <th>QC Doc</th>
                        <th>QC Approved</th>
                        <th>Approved By</th>
                        <th>First Opened</th>
                        <th>Last Opened</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupRows.map((r: any, i: number) => (
                        <tr key={i}>
                          <td>{r.lot_number}</td>
                          <td>{r.expiration || "\u2014"}</td>
                          <td>{r.received || "\u2014"}</td>
                          <td>{r.received_by || "\u2014"}</td>
                          <td>{r.qc_doc === "Yes" ? "\u2713" : "\u2014"}</td>
                          <td>{r.qc_approved || "\u2014"}</td>
                          <td>{r.qc_approved_by || "\u2014"}</td>
                          <td>{r.first_opened || "\u2014"}</td>
                          <td>{r.last_opened || "\u2014"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        );
      }

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
                  <th>Received By</th>
                  <th>QC Doc</th>
                  <th>QC Approved</th>
                  <th>Approved By</th>
                  <th>First Opened</th>
                  <th>Last Opened</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any, i: number) => (
                  <tr key={i}>
                    <td>{r.lot_number}</td>
                    <td>{r.expiration || "\u2014"}</td>
                    <td>{r.received || "\u2014"}</td>
                    <td>{r.received_by || "\u2014"}</td>
                    <td>{r.qc_doc === "Yes" ? "\u2713" : "\u2014"}</td>
                    <td>{r.qc_approved || "\u2014"}</td>
                    <td>{r.qc_approved_by || "\u2014"}</td>
                    <td>{r.first_opened || "\u2014"}</td>
                    <td>{r.last_opened || "\u2014"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    if (activeReport === "usage") {
      if (isAllAntibodies) {
        const groups: Record<string, any[]> = {};
        for (const r of rows) {
          const ab = r.antibody_full || r.antibody || "Unknown";
          (groups[ab] ??= []).push(r);
        }
        return (
          <div className="report-preview">
            <h3>{heading}</h3>
            {Object.entries(groups).map(([abName, groupRows]) => (
              <div key={abName} style={{ marginBottom: 20 }}>
                <h4 style={{ fontSize: "0.85rem", margin: "12px 0 6px", color: "var(--text-secondary)" }}>{abName}</h4>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Lot #</th>
                        <th>Expiration</th>
                        <th>Received</th>
                        <th>Vials Rcvd</th>
                        <th>Vials Used</th>
                        <th>First Opened</th>
                        <th>Last Opened</th>
                        <th>Avg/Wk</th>
                        <th>Ab Avg/Wk</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupRows.map((r: any, i: number) => (
                        <tr key={i}>
                          <td>{r.lot_number}</td>
                          <td>{r.expiration || "\u2014"}</td>
                          <td>{r.received || "\u2014"}</td>
                          <td>{r.vials_received}</td>
                          <td>{r.vials_consumed}</td>
                          <td>{r.first_opened || "\u2014"}</td>
                          <td>{r.last_opened || "\u2014"}</td>
                          <td>{r.avg_week || "\u2014"}</td>
                          <td>{r.ab_avg_week || "\u2014"}</td>
                          <td>{r.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        );
      }

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
                  <th>Received</th>
                  <th>Consumed</th>
                  <th>First Opened</th>
                  <th>Last Opened</th>
                  <th>Avg/Wk</th>
                  <th>Ab Avg/Wk</th>
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
                    <td>{r.ab_avg_week || "\u2014"}</td>
                    <td>{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    if (activeReport === "usage-trend") {
      // Group by antibody
      const groups: Record<string, any[]> = {};
      for (const r of rows) {
        const ab = r.antibody_full || r.antibody || "Unknown";
        (groups[ab] ??= []).push(r);
      }
      const antibodyKeys = Object.keys(groups);
      const isSingleAntibody = antibodyKeys.length === 1;

      const renderTrendTable = (groupRows: any[]) => {
        const totalVials = groupRows[0]?.total_vials ?? 0;
        const totalWeeks = groupRows[0]?.total_weeks ?? "";
        const totalAvg = groupRows[0]?.total_avg_week ?? "";
        return (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Vials Opened</th>
                  <th>Lots Active</th>
                  <th>Weeks</th>
                  <th>Avg/Wk</th>
                </tr>
              </thead>
              <tbody>
                {groupRows.map((r: any, i: number) => (
                  <tr key={i}>
                    <td>{r.month_label}</td>
                    <td>{r.vials_opened}</td>
                    <td>{r.lots_active}</td>
                    <td>{r.weeks}</td>
                    <td>{r.avg_week}</td>
                  </tr>
                ))}
                {totalVials > 0 && (
                  <tr style={{ fontWeight: 600, borderTop: "2px solid var(--border)" }}>
                    <td>Total</td>
                    <td>{totalVials}</td>
                    <td></td>
                    <td>{totalWeeks}</td>
                    <td>{totalAvg}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        );
      };

      if (!isSingleAntibody) {
        return (
          <div className="report-preview">
            <h3>{heading}</h3>
            {antibodyKeys.map((abName) => (
              <div key={abName} style={{ marginBottom: 20 }}>
                <h4 style={{ fontSize: "0.85rem", margin: "12px 0 6px", color: "var(--text-secondary)" }}>{abName}</h4>
                {renderTrendTable(groups[abName])}
              </div>
            ))}
          </div>
        );
      }

      return (
        <div className="report-preview">
          <h3>{heading}</h3>
          {renderTrendTable(rows)}
        </div>
      );
    }

    if (activeReport === "cocktail-lots") {
      // Group by recipe name
      const groups: Record<string, any[]> = {};
      for (const r of rows) {
        const rn = r.recipe_name || "Unknown Recipe";
        (groups[rn] ??= []).push(r);
      }
      return (
        <div className="report-preview">
          <h3>{heading}</h3>
          {Object.entries(groups).map(([recipeName, groupRows]) => (
            <div key={recipeName} style={{ marginBottom: 20 }}>
              <h4 style={{ fontSize: "0.85rem", margin: "12px 0 6px", color: "var(--text-secondary)" }}>{recipeName}</h4>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Lot #</th>
                      <th>Prepared</th>
                      <th>Expires</th>
                      <th>QC Status</th>
                      <th>QC By</th>
                      <th>Renewals</th>
                      <th>Tests</th>
                      <th>Status</th>
                      <th>Created By</th>
                      <th>Components</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupRows.map((r: any, i: number) => (
                      <tr key={i}>
                        <td>{r.lot_number}</td>
                        <td>{r.preparation_date || "\u2014"}</td>
                        <td>{r.expiration_date || "\u2014"}</td>
                        <td>
                          <span className={`badge ${r.qc_status === "approved" ? "badge-green" : r.qc_status === "failed" ? "badge-red" : "badge-yellow"}`}>
                            {r.qc_status}
                          </span>
                        </td>
                        <td>{r.qc_approved_by || "\u2014"}</td>
                        <td>{r.renewal_count}</td>
                        <td>{r.test_count || "\u2014"}</td>
                        <td>{r.status}</td>
                        <td>{r.created_by || "\u2014"}</td>
                        <td style={{ fontSize: "0.8em", maxWidth: 260, whiteSpace: "pre-line", lineHeight: 1.5 }}>
                          {r.components
                            ? r.components.split("\n").map((line: string, j: number) => (
                                <span key={j}>
                                  {line}
                                  {j < r.components.split("\n").length - 1 && <br />}
                                </span>
                              ))
                            : "\u2014"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
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
                    <td style={{ whiteSpace: "nowrap" }}>{r.timestamp ? new Date(r.timestamp).toLocaleString() : "\u2014"}</td>
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
                                : r.action?.startsWith("cocktail_lot.") || r.action?.startsWith("cocktail_recipe.") || r.action?.startsWith("cocktail_document.")
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

  // Filter report cards by role and feature flags
  const visibleCards = REPORT_CARDS.filter((c) => {
    if (c.type === "admin-activity") {
      return user?.role === "super_admin" || user?.role === "lab_admin";
    }
    if (c.type === "cocktail-lots") {
      return cocktailsEnabled;
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
