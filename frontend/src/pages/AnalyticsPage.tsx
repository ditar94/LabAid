import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, UserCheck, CreditCard, TrendingUp, Calendar, ArrowRight } from "lucide-react";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";

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
  if (status === "past_due") return <span className="badge badge-warning">Past Due</span>;
  if (status === "cancelled") return <span className="badge badge-danger">Cancelled</span>;
  return <span className="badge">{status}</span>;
}

export default function AnalyticsPage() {
  const { user } = useAuth();
  const [periodView, setPeriodView] = useState<"monthly" | "weekly">("monthly");

  if (user?.role !== "super_admin") {
    return (
      <div>
        <div className="page-header"><h1>Analytics</h1></div>
        <p className="text-muted">Access denied.</p>
      </div>
    );
  }

  const { data: funnel, isLoading } = useQuery<ConversionFunnel>({
    queryKey: ["conversion-funnel"],
    queryFn: () => api.get("/admin/conversion-funnel").then((r) => r.data),
  });

  if (isLoading) {
    return (
      <div>
        <div className="page-header"><h1>Analytics</h1></div>
        <div className="skeleton" style={{ height: 400 }} />
      </div>
    );
  }

  if (!funnel) {
    return (
      <div>
        <div className="page-header"><h1>Analytics</h1></div>
        <p className="text-muted">Could not load analytics data.</p>
      </div>
    );
  }

  const periods = periodView === "monthly" ? funnel.monthly : funnel.weekly;
  const overallRate = funnel.total_demos > 0
    ? ((funnel.converted_to_paid / funnel.total_demos) * 100).toFixed(1)
    : "0";

  return (
    <div>
      <div className="page-header">
        <h1>Analytics</h1>
      </div>

      {/* Funnel summary */}
      <div className="analytics-funnel-bar">
        <div className="analytics-funnel-step">
          <div className="analytics-funnel-count">{funnel.total_demos}</div>
          <div className="analytics-funnel-label">Demos</div>
        </div>
        <div className="analytics-funnel-arrow">
          <ArrowRight size={16} />
          <span className="analytics-funnel-rate">{funnel.demo_to_trial_rate.toFixed(0)}%</span>
        </div>
        <div className="analytics-funnel-step">
          <div className="analytics-funnel-count">{funnel.converted_to_trial}</div>
          <div className="analytics-funnel-label">Trials</div>
        </div>
        <div className="analytics-funnel-arrow">
          <ArrowRight size={16} />
          <span className="analytics-funnel-rate">{funnel.trial_to_paid_rate.toFixed(0)}%</span>
        </div>
        <div className="analytics-funnel-step">
          <div className="analytics-funnel-count">{funnel.converted_to_paid}</div>
          <div className="analytics-funnel-label">Paid</div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        <div className="stat-card priority-card info">
          <div className="stat-icon-wrap"><Users size={20} /></div>
          <div className="stat-value">{funnel.total_demos}</div>
          <div className="stat-label">Total Demos</div>
        </div>
        <div className="stat-card priority-card info">
          <div className="stat-icon-wrap"><UserCheck size={20} /></div>
          <div className="stat-value">{funnel.converted_to_trial}</div>
          <div className="stat-label">Converted to Trial</div>
        </div>
        <div className="stat-card priority-card info">
          <div className="stat-icon-wrap"><CreditCard size={20} /></div>
          <div className="stat-value">{funnel.converted_to_paid}</div>
          <div className="stat-label">Converted to Paid</div>
        </div>
        <div className="stat-card priority-card info">
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
          <div className="filters">
            <button
              className={`btn-secondary${periodView === "monthly" ? " active" : ""}`}
              onClick={() => setPeriodView("monthly")}
            >
              Month
            </button>
            <button
              className={`btn-secondary${periodView === "weekly" ? " active" : ""}`}
              onClick={() => setPeriodView("weekly")}
            >
              Week
            </button>
          </div>
        </div>

        {periods.length === 0 ? (
          <p className="text-muted">No data yet.</p>
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
                    <td style={{ textAlign: "right" }}>{p.demos}</td>
                    <td style={{ textAlign: "right" }}>{p.trials}</td>
                    <td style={{ textAlign: "right" }}>{p.paid}</td>
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
        <h2 style={{ marginBottom: 16 }}>All Leads</h2>
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
              {funnel.rows.map((row, i) => (
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
      </div>
    </div>
  );
}
