import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, UserCheck, CreditCard, TrendingUp, Calendar, ArrowRight } from "lucide-react";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import MonthPicker, { type DateRange } from "../components/MonthPicker";

interface PeriodStats {
  period: string;
  demos: number;
  trials: number;
  paid: number;
}

interface FunnelRow {
  email: string;
  demo_date: string | null;
  demo_source: string | null;
  demo_logins: number;
  signup_date: string | null;
  lab_name: string | null;
  billing_status: string | null;
  paid_date: string | null;
}

interface ConversionFunnel {
  total_demos: number;
  converted_to_trial: number;
  converted_to_paid: number;
  demo_to_trial_rate: number;
  trial_to_paid_rate: number;
  monthly: PeriodStats[];
  weekly: PeriodStats[];
  rows: FunnelRow[];
}

function formatDate(d: string | null): string {
  if (!d) return "-";
  return new Date(d).toLocaleDateString();
}

function formatPeriodLabel(period: string): string {
  if (period.includes("-W")) {
    const [year, week] = period.split("-W");
    return `Week ${parseInt(week)}, ${year}`;
  }
  const [year, month] = period.split("-");
  const date = new Date(parseInt(year), parseInt(month) - 1);
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function statusBadge(status: string | null) {
  if (!status) return <span className="badge badge-info">Demo Only</span>;
  if (status === "active") return <span className="badge badge-success">Paid</span>;
  if (status === "trial") return <span className="badge badge-info">Trial</span>;
  if (status === "invoice_pending") return <span className="badge badge-warning">Invoice Pending</span>;
  if (status === "past_due") return <span className="badge badge-warning">Past Due</span>;
  if (status === "cancelled") return <span className="badge badge-danger">Cancelled</span>;
  return <span className="badge">{status}</span>;
}

function monthKeyInRange(period: string, fromKey: string, toKey: string): boolean {
  return period >= fromKey && period <= toKey;
}

function weekKeyInRange(period: string, fromKey: string, toKey: string): boolean {
  const [yearStr, weekPart] = period.split("-W");
  const year = parseInt(yearStr);
  const week = parseInt(weekPart);
  const approxMonth = Math.min(11, Math.floor((week - 1) / 4.345));
  const monthKey = `${year}-${String(approxMonth + 1).padStart(2, "0")}`;
  return monthKey >= fromKey && monthKey <= toKey;
}

function barCell(value: number, max: number, color: string) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <td style={{ textAlign: "right" }}>
      <span className="analytics-bar-cell">
        <span
          className="analytics-bar"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
        <span className="analytics-bar-value">{value}</span>
      </span>
    </td>
  );
}

const LEADS_PAGE_SIZE = 50;

export default function AnalyticsPage() {
  const { user } = useAuth();
  const [periodView, setPeriodView] = useState<"monthly" | "weekly">("monthly");
  const [dateRange, setDateRange] = useState<DateRange | null>(null);
  const [leadsShown, setLeadsShown] = useState(LEADS_PAGE_SIZE);

  const isSuperAdmin = user?.role === "super_admin";

  const { data: funnel, isLoading } = useQuery<ConversionFunnel>({
    queryKey: ["conversion-funnel"],
    queryFn: () => api.get("/admin/conversion-funnel").then((r) => r.data),
    enabled: isSuperAdmin,
  });

  useEffect(() => {
    setLeadsShown(LEADS_PAGE_SIZE);
  }, [dateRange]);

  const filtered = useMemo(() => {
    if (!funnel) return null;
    if (!dateRange) return funnel;

    const fromKey = `${dateRange.fromYear}-${String(dateRange.fromMonth + 1).padStart(2, "0")}`;
    const toKey = `${dateRange.toYear}-${String(dateRange.toMonth + 1).padStart(2, "0")}`;

    const filteredMonthly = funnel.monthly.filter((p) => monthKeyInRange(p.period, fromKey, toKey));
    const filteredWeekly = funnel.weekly.filter((p) => weekKeyInRange(p.period, fromKey, toKey));

    const fromDate = new Date(dateRange.fromYear, dateRange.fromMonth, 1);
    const toDate = new Date(
      dateRange.toMonth === 11 ? dateRange.toYear + 1 : dateRange.toYear,
      dateRange.toMonth === 11 ? 0 : dateRange.toMonth + 1,
      1,
    );

    const filteredRows = funnel.rows.filter((row) => {
      if (!row.demo_date) return false;
      const d = new Date(row.demo_date);
      return d >= fromDate && d < toDate;
    });

    const total_demos = filteredRows.length;
    const converted_to_trial = filteredRows.filter((r) => r.lab_name).length;
    const converted_to_paid = filteredRows.filter((r) => r.billing_status === "active").length;

    return {
      ...funnel,
      total_demos,
      converted_to_trial,
      converted_to_paid,
      demo_to_trial_rate: total_demos > 0 ? (converted_to_trial / total_demos) * 100 : 0,
      trial_to_paid_rate: converted_to_trial > 0 ? (converted_to_paid / converted_to_trial) * 100 : 0,
      monthly: filteredMonthly,
      weekly: filteredWeekly,
      rows: filteredRows,
    };
  }, [funnel, dateRange]);

  if (!isSuperAdmin) {
    return (
      <div>
        <div className="page-header"><h1>Analytics</h1></div>
        <p className="text-muted">Access denied.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div>
        <div className="page-header"><h1>Analytics</h1></div>
        <div className="skeleton" style={{ height: 400 }} />
      </div>
    );
  }

  if (!filtered) {
    return (
      <div>
        <div className="page-header"><h1>Analytics</h1></div>
        <p className="text-muted">Could not load analytics data.</p>
      </div>
    );
  }

  const periods = periodView === "monthly" ? filtered.monthly : filtered.weekly;
  const overallRate = filtered.total_demos > 0
    ? ((filtered.converted_to_paid / filtered.total_demos) * 100).toFixed(1)
    : "0";

  const maxDemos = Math.max(1, ...periods.map((p) => p.demos));
  const maxTrials = Math.max(1, ...periods.map((p) => p.trials));
  const maxPaid = Math.max(1, ...periods.map((p) => p.paid));

  const visibleRows = filtered.rows.slice(0, leadsShown);
  const hasMoreLeads = leadsShown < filtered.rows.length;

  return (
    <div>
      <div className="page-header">
        <h1>Analytics</h1>
        <MonthPicker
          value={dateRange}
          onChange={setDateRange}
          onClear={() => setDateRange(null)}
        />
      </div>

      {/* Funnel summary */}
      <div className="analytics-funnel-bar">
        <div className="analytics-funnel-step">
          <div className="analytics-funnel-count">{filtered.total_demos}</div>
          <div className="analytics-funnel-label">Demos</div>
        </div>
        <div className="analytics-funnel-arrow">
          <ArrowRight size={16} />
          <span className="analytics-funnel-rate">{filtered.demo_to_trial_rate.toFixed(0)}%</span>
        </div>
        <div className="analytics-funnel-step">
          <div className="analytics-funnel-count">{filtered.converted_to_trial}</div>
          <div className="analytics-funnel-label">Trials</div>
        </div>
        <div className="analytics-funnel-arrow">
          <ArrowRight size={16} />
          <span className="analytics-funnel-rate">{filtered.trial_to_paid_rate.toFixed(0)}%</span>
        </div>
        <div className="analytics-funnel-step">
          <div className="analytics-funnel-count">{filtered.converted_to_paid}</div>
          <div className="analytics-funnel-label">Paid</div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        <div className="stat-card info">
          <div className="stat-icon-wrap"><Users size={20} /></div>
          <div className="stat-value">{filtered.total_demos}</div>
          <div className="stat-label">Total Demos</div>
        </div>
        <div className="stat-card info">
          <div className="stat-icon-wrap"><UserCheck size={20} /></div>
          <div className="stat-value">{filtered.converted_to_trial}</div>
          <div className="stat-label">Converted to Trial</div>
        </div>
        <div className="stat-card info">
          <div className="stat-icon-wrap"><CreditCard size={20} /></div>
          <div className="stat-value">{filtered.converted_to_paid}</div>
          <div className="stat-label">Converted to Paid</div>
        </div>
        <div className="stat-card info">
          <div className="stat-icon-wrap"><TrendingUp size={20} /></div>
          <div className="stat-value">{overallRate}%</div>
          <div className="stat-label">Overall Conversion</div>
        </div>
      </div>

      {/* Period breakdown */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>
            <Calendar size={18} style={{ marginRight: 8, verticalAlign: "text-bottom" }} />
            Conversions by {periodView === "monthly" ? "Month" : "Week"}
          </h2>
          <div className="view-toggle">
            <button
              className={`view-toggle-btn${periodView === "monthly" ? " active" : ""}`}
              onClick={() => setPeriodView("monthly")}
            >
              Month
            </button>
            <button
              className={`view-toggle-btn${periodView === "weekly" ? " active" : ""}`}
              onClick={() => setPeriodView("weekly")}
            >
              Week
            </button>
          </div>
        </div>

        {periods.length === 0 ? (
          <p className="text-muted">No data for this period.</p>
        ) : (
          <div className="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>Period</th>
                  <th style={{ textAlign: "right" }}>Demos</th>
                  <th style={{ textAlign: "right" }}>Trials</th>
                  <th style={{ textAlign: "right" }}>Paid</th>
                  <th style={{ textAlign: "right" }}>Demo&rarr;Trial</th>
                  <th style={{ textAlign: "right" }}>Trial&rarr;Paid</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => (
                  <tr key={p.period}>
                    <td>{formatPeriodLabel(p.period)}</td>
                    {barCell(p.demos, maxDemos, "var(--primary-500)")}
                    {barCell(p.trials, maxTrials, "var(--warning-500)")}
                    {barCell(p.paid, maxPaid, "var(--success-500)")}
                    <td style={{ textAlign: "right" }}>
                      {p.demos > 0 ? `${((p.trials / p.demos) * 100).toFixed(0)}%` : "-"}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {p.trials > 0 ? `${((p.paid / p.trials) * 100).toFixed(0)}%` : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Lead detail table */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>All Leads</h2>
          <span className="text-muted" style={{ fontSize: "var(--text-sm)" }}>
            {filtered.rows.length} total
          </span>
        </div>
        <div className="table-responsive">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Source</th>
                <th>Demo Date</th>
                <th style={{ textAlign: "right" }}>Logins</th>
                <th>Signup Date</th>
                <th>Lab</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, i) => (
                <tr key={`${row.email}-${i}`}>
                  <td>{row.email}</td>
                  <td>{row.demo_source || <span className="text-muted">-</span>}</td>
                  <td>{formatDate(row.demo_date)}</td>
                  <td style={{ textAlign: "right" }}>{row.demo_logins}</td>
                  <td>{formatDate(row.signup_date)}</td>
                  <td>{row.lab_name || <span className="text-muted">-</span>}</td>
                  <td>{statusBadge(row.billing_status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {hasMoreLeads && (
          <div style={{ textAlign: "center", padding: "1rem" }}>
            <button
              className="btn-secondary"
              onClick={() => setLeadsShown((n) => n + LEADS_PAGE_SIZE)}
            >
              Load more ({filtered.rows.length - leadsShown} remaining)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
