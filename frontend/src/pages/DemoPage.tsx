import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { DemoLab, DemoLead } from "../api/types";
import { Play, Plus, Send, Copy, Link, UserPlus } from "lucide-react";
import { useToast } from "../context/ToastContext";
import { Modal } from "../components/Modal";
import ActionMenu from "../components/ActionMenu";
import type { ActionMenuItem } from "../components/ActionMenu";

type ConfirmAction = {
  type: "reset" | "revoke";
  lab: DemoLab;
};

export default function DemoPage() {
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const [provisionCount, setProvisionCount] = useState(1);
  const [provisioning, setProvisioning] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [extendLabId, setExtendLabId] = useState<string | null>(null);
  const [extendHours, setExtendHours] = useState(24);
  const [showLeads, setShowLeads] = useState(false);
  const [resendLoading, setResendLoading] = useState<string | null>(null);
  const [assignLoading, setAssignLoading] = useState<string | null>(null);
  const [labLinkResult, setLabLinkResult] = useState<{ labId: string; link: string } | null>(null);
  const [labLinkLoading, setLabLinkLoading] = useState<string | null>(null);

  const { data: demoLabs = [], isLoading } = useQuery<DemoLab[]>({
    queryKey: ["demo-labs"],
    queryFn: () => api.get("/demo/labs").then((r) => r.data),
  });

  const { data: leads = [], isLoading: leadsLoading } = useQuery<DemoLead[]>({
    queryKey: ["demo-leads"],
    queryFn: () => api.get("/demo/leads").then((r) => r.data),
    enabled: showLeads,
  });

  const hasAvailableLabs = demoLabs.some((l) => l.demo_status === "available");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["demo-labs"] });
    queryClient.invalidateQueries({ queryKey: ["demo-leads"] });
  };

  const handleProvision = async () => {
    setProvisioning(true);
    try {
      await api.post(`/demo/provision?count=${provisionCount}`);
      await invalidate();
      addToast(`Provisioned ${provisionCount} demo lab(s)`, "success");
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Failed to provision", "danger");
    } finally {
      setProvisioning(false);
    }
  };

  const handleReset = async (labId: string) => {
    setActionLoading(labId);
    try {
      await api.post(`/demo/labs/${labId}/reset`);
      await invalidate();
      addToast("Demo lab reset and re-seeded", "success");
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Failed to reset", "danger");
    } finally {
      setActionLoading(null);
      setConfirmAction(null);
    }
  };

  const handleExtend = async (labId: string) => {
    setActionLoading(labId);
    try {
      await api.post(`/demo/labs/${labId}/extend`, { hours: extendHours });
      await invalidate();
      setExtendLabId(null);
      addToast(`Extended by ${extendHours} hours`, "success");
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Failed to extend", "danger");
    } finally {
      setActionLoading(null);
    }
  };

  const handleRevoke = async (labId: string) => {
    setActionLoading(labId);
    try {
      await api.post(`/demo/labs/${labId}/revoke`);
      await invalidate();
      addToast("Demo session revoked", "success");
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Failed to revoke", "danger");
    } finally {
      setActionLoading(null);
      setConfirmAction(null);
    }
  };

  const handleGetLabLink = async (labId: string) => {
    setLabLinkLoading(labId);
    try {
      const res = await api.post(`/demo/labs/${labId}/get-link`);
      setLabLinkResult({ labId, link: res.data.login_link });
      addToast("Magic link generated", "success");
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Failed to generate link", "danger");
    } finally {
      setLabLinkLoading(null);
    }
  };

  const handleResend = async (leadId: string) => {
    setResendLoading(leadId);
    try {
      const res = await api.post(`/demo/leads/${leadId}/resend`);
      if (res.data.email_sent) {
        addToast("Magic link email sent", "success");
      } else {
        addToast("Email send failed", "warning");
      }
      await invalidate();
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Failed to resend", "danger");
    } finally {
      setResendLoading(null);
    }
  };

  const handleAssign = async (leadId: string) => {
    setAssignLoading(leadId);
    try {
      await api.post(`/demo/leads/${leadId}/assign`);
      await invalidate();
      addToast("Lead assigned to demo lab", "success");
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Failed to assign", "danger");
    } finally {
      setAssignLoading(null);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    addToast("Link copied to clipboard", "success");
  };

  const handleExpireStale = async () => {
    try {
      const res = await api.post("/demo/expire-stale");
      await invalidate();
      addToast(
        `Released ${res.data.released} reservations, expired ${res.data.expired} sessions`,
        "success"
      );
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Failed", "danger");
    }
  };

  const labActionItems = (lab: DemoLab): ActionMenuItem[] => {
    const items: ActionMenuItem[] = [];
    if (lab.demo_status === "in_use") {
      items.push({
        label: "Extend",
        icon: "⏱",
        onClick: () => { setExtendLabId(lab.id); setExtendHours(24); },
      });
      items.push({
        label: "Revoke",
        icon: "✕",
        variant: "danger",
        onClick: () => setConfirmAction({ type: "revoke", lab }),
      });
    }
    if (lab.demo_status === "expired" || lab.demo_status === "in_use") {
      items.push({
        label: "Reset",
        icon: "↺",
        variant: "danger",
        onClick: () => setConfirmAction({ type: "reset", lab }),
      });
    }
    return items;
  };

  const statusBadge = (status: string | null) => {
    switch (status) {
      case "available":
        return <span className="badge badge-green">Available</span>;
      case "in_use":
        return <span className="badge badge-blue">In Use</span>;
      case "expired":
        return <span className="badge badge-yellow">Expired</span>;
      default:
        return <span className="badge badge-muted">{status || "—"}</span>;
    }
  };

  const leadStatusBadge = (lead: DemoLead) => {
    switch (lead.status) {
      case "waitlisted":
        return <span className="badge badge-yellow">Waitlisted</span>;
      case "notified":
        return <span className="badge badge-blue">{lead.login_count > 0 ? "Re-notified" : "Notified"}</span>;
      case "active":
        return <span className="badge badge-green">Active</span>;
      case "completed":
        return <span className="badge badge-muted">Completed</span>;
      case "rerequested":
        return <span className="badge badge-purple">Rerequested</span>;
      default:
        return <span className="badge badge-muted">{lead.status}</span>;
    }
  };

  const fmtDate = (d: string | null) =>
    d ? new Date(d).toLocaleString() : "—";

  return (
    <div>
      <div className="page-header">
        <h1>Demo Management</h1>
        <div className="action-btns">
          <button
            className="btn-chip btn-chip-secondary"
            onClick={() => setShowLeads(!showLeads)}
          >
            {showLeads ? "Hide Leads" : "Show Leads"}
          </button>
          <button className="btn-chip btn-chip-secondary" onClick={handleExpireStale}>
            Expire Stale
          </button>
        </div>
      </div>

      {/* Provision form */}
      <div className="inline-form">
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          Provision
          <input
            type="number"
            min={1}
            max={10}
            value={provisionCount}
            onChange={(e) => setProvisionCount(Number(e.target.value))}
            style={{ width: 60 }}
          />
          demo lab(s)
        </label>
        <button className="btn-chip btn-chip-primary" onClick={handleProvision} disabled={provisioning}>
          <Plus size={14} style={{ marginRight: 4, verticalAlign: -2 }} />
          {provisioning ? "Provisioning..." : "Provision"}
        </button>
      </div>

      {/* Demo Labs table */}
      {isLoading ? (
        <p className="text-muted">Loading...</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Assigned To</th>
                <th>Expires</th>
                <th>Assigned At</th>
                <th>Cycles</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {demoLabs.map((lab) => (
                <tr key={lab.id}>
                  <td>{lab.name}</td>
                  <td>{statusBadge(lab.demo_status)}</td>
                  <td>{lab.demo_assigned_email || "—"}</td>
                  <td>{fmtDate(lab.demo_expires_at)}</td>
                  <td>{fmtDate(lab.demo_assigned_at)}</td>
                  <td>{lab.demo_cycle_count}</td>
                  <td className="action-btns">
                    {lab.demo_status === "in_use" && (
                      <>
                        <button
                          className="btn-sm"
                          onClick={() => handleGetLabLink(lab.id)}
                          disabled={labLinkLoading === lab.id}
                          title="Generate magic link to access this lab"
                        >
                          <Link size={13} style={{ marginRight: 3, verticalAlign: -2 }} />
                          {labLinkLoading === lab.id ? "..." : "Get Link"}
                        </button>
                        {labLinkResult?.labId === lab.id && (
                          <button
                            className="btn-sm"
                            onClick={() => copyToClipboard(labLinkResult.link)}
                            title="Copy magic link"
                          >
                            <Copy size={13} style={{ marginRight: 3, verticalAlign: -2 }} />
                            Copy
                          </button>
                        )}
                      </>
                    )}
                    {lab.demo_status === "available" && (
                      <span className="text-muted" style={{ fontSize: "var(--text-xs)" }}>
                        <Play size={13} style={{ marginRight: 3, verticalAlign: -2 }} />
                        Ready
                      </span>
                    )}
                    {labActionItems(lab).length > 0 && (
                      <ActionMenu items={labActionItems(lab)} />
                    )}
                  </td>
                </tr>
              ))}
              {demoLabs.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-muted" style={{ textAlign: "center", padding: "var(--space-xl)" }}>
                    No demo labs provisioned yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Leads table */}
      {showLeads && (
        <>
          <h2 style={{ marginTop: "var(--space-xl)" }}>Demo Leads</h2>
          {leadsLoading ? (
            <p className="text-muted">Loading...</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Status</th>
                    <th>Source</th>
                    <th>Logins</th>
                    <th>Last Login</th>
                    <th>Requested</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => (
                    <tr key={lead.id}>
                      <td>{lead.email}</td>
                      <td>{leadStatusBadge(lead)}</td>
                      <td>{lead.source || "—"}</td>
                      <td>{lead.login_count || 0}</td>
                      <td>{fmtDate(lead.last_login_at)}</td>
                      <td>{fmtDate(lead.created_at)}</td>
                      <td className="action-btns">
                        {(lead.status === "notified" || lead.status === "active") && (
                          <button
                            className="btn-sm"
                            onClick={() => handleResend(lead.id)}
                            disabled={resendLoading === lead.id}
                            title="Send magic link via email"
                          >
                            <Send size={13} style={{ marginRight: 3, verticalAlign: -2 }} />
                            {resendLoading === lead.id ? "Sending..." : "Email Link"}
                          </button>
                        )}
                        {(lead.status === "waitlisted" || lead.status === "completed" || lead.status === "rerequested") && (
                          <button
                            className="btn-sm"
                            onClick={() => handleAssign(lead.id)}
                            disabled={assignLoading === lead.id || !hasAvailableLabs}
                            title={hasAvailableLabs ? "Assign to an available demo lab" : "No available demo labs"}
                          >
                            <UserPlus size={13} style={{ marginRight: 3, verticalAlign: -2 }} />
                            {assignLoading === lead.id ? "Assigning..." : "Assign"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {leads.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-muted" style={{ textAlign: "center", padding: "var(--space-xl)" }}>
                        No leads yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Extend modal */}
      {extendLabId && (
        <Modal onClose={() => setExtendLabId(null)} ariaLabel="Extend demo">
          <div className="modal-content">
            <h2>Extend Demo</h2>
            <p className="page-desc">
              Add more time to this demo session.
            </p>
            <div style={{ margin: "var(--space-md) 0" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                Hours to add:
                <input
                  type="number"
                  min={1}
                  max={168}
                  value={extendHours}
                  onChange={(e) => setExtendHours(Number(e.target.value))}
                  style={{ width: 80 }}
                />
              </label>
            </div>
            <div className="action-btns" style={{ marginTop: "var(--space-lg)" }}>
              <button
                className="btn-chip btn-chip-primary"
                onClick={() => handleExtend(extendLabId)}
                disabled={actionLoading === extendLabId}
              >
                {actionLoading === extendLabId ? "Extending..." : "Extend"}
              </button>
              <button className="btn-secondary" onClick={() => setExtendLabId(null)}>
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Confirm reset/revoke modal */}
      {confirmAction && (
        <Modal onClose={() => setConfirmAction(null)} ariaLabel={`Confirm ${confirmAction.type}`}>
          <div className="modal-content">
            <h2>
              {confirmAction.type === "reset" ? "Reset" : "Revoke"}{" "}
              {confirmAction.lab.name}?
            </h2>
            <p className="page-desc">
              {confirmAction.type === "reset"
                ? "This will wipe all data in this demo lab and make it available for a new prospect. This cannot be undone."
                : "This will immediately end the demo session. The user will lose access."}
            </p>
            <div className="action-btns" style={{ marginTop: "var(--space-lg)" }}>
              <button
                className="btn-danger"
                onClick={() =>
                  confirmAction.type === "reset"
                    ? handleReset(confirmAction.lab.id)
                    : handleRevoke(confirmAction.lab.id)
                }
                disabled={actionLoading === confirmAction.lab.id}
              >
                {actionLoading === confirmAction.lab.id
                  ? "Processing..."
                  : confirmAction.type === "reset"
                  ? "Reset Lab"
                  : "Revoke Access"}
              </button>
              <button className="btn-secondary" onClick={() => setConfirmAction(null)}>
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
