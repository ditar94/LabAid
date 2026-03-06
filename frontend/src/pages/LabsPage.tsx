import { lazy, Suspense, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { Lab, BillingStatus } from "../api/types";
import { Building2, LogIn, Shield, Trash2 } from "lucide-react";
import EmptyState from "../components/EmptyState";
import CopyButton from "../components/CopyButton";
import ToggleSwitch from "../components/ToggleSwitch";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { useSharedData } from "../context/SharedDataContext";
import { Modal } from "../components/Modal";
import TableSkeleton from "../components/TableSkeleton";

const AuthProviderModal = lazy(() => import("../components/AuthProviderModal"));

interface SubDetailsData {
  status: string;
  current_period_start: number | null;
  current_period_end: number | null;
  created: number | null;
  collection_method: string | null;
  cancel_at_period_end: boolean;
}

function SubDetails({ labId }: { labId: string }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<SubDetailsData | null>({
    queryKey: ["lab-subscription", labId],
    queryFn: async () => {
      const r = await api.get(`/labs/${labId}/subscription`);
      // Backend may have auto-corrected billing status via read-through — refresh labs list
      queryClient.invalidateQueries({ queryKey: ["labs"] });
      return r.data;
    },
  });

  if (isLoading) return <div className="text-muted" style={{ marginTop: 6 }}>Loading...</div>;
  if (!data) return <div className="text-muted" style={{ marginTop: 6 }}>No subscription data</div>;

  const fmt = (ts: number | null) => ts ? new Date(ts * 1000).toLocaleDateString() : "-";
  const method = data.collection_method === "send_invoice" ? "Invoice" : data.collection_method === "charge_automatically" ? "Card" : data.collection_method || "-";

  return (
    <div className="sub-details">
      <div><strong>Subscribed:</strong> {fmt(data.created)}</div>
      <div><strong>Period:</strong> {fmt(data.current_period_start)} &ndash; {fmt(data.current_period_end)}</div>
      <div><strong>Payment:</strong> {method}</div>
      {data.cancel_at_period_end && <div className="text-danger"><strong>Cancels at period end</strong></div>}
    </div>
  );
}

export default function LabsPage() {
  const { refreshLabs } = useSharedData();
  const queryClient = useQueryClient();
  const { data: labs = [], isLoading: loading } = useQuery<Lab[]>({
    queryKey: ["labs"],
    queryFn: () => api.get("/labs/").then((r) => r.data),
  });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "" });
  const [error, setError] = useState<string | null>(null);
  const [suspendPrompt, setSuspendPrompt] = useState<{ id: string; name: string } | null>(null);
  const [suspendLoading, setSuspendLoading] = useState(false);
  const [enteringLabId, setEnteringLabId] = useState<string | null>(null);
  const [editingTrialId, setEditingTrialId] = useState<string | null>(null);
  const [trialDate, setTrialDate] = useState("");
  const [ssoLab, setSsoLab] = useState<{ id: string; name: string } | null>(null);
  const [linkingStripeId, setLinkingStripeId] = useState<string | null>(null);
  const [expandedSubId, setExpandedSubId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const { addToast } = useToast();
  const { startImpersonation } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/labs/", form);
      setForm({ name: "" });
      setShowForm(false);
      addToast(`Lab "${form.name}" created`, "success");
      queryClient.invalidateQueries({ queryKey: ["labs"] });
      refreshLabs();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to create lab");
    }
  };

  const handleToggleSuspend = async (labId: string) => {
    setSuspendLoading(true);
    try {
      await api.patch(`/labs/${labId}/suspend`);
      await queryClient.invalidateQueries({ queryKey: ["labs"] });
      refreshLabs();
      const lab = labs.find((l) => l.id === labId);
      addToast(
        lab?.is_active ? `"${lab.name}" suspended` : `"${lab?.name}" reactivated`,
        lab?.is_active ? "warning" : "success"
      );
      setSuspendPrompt(null);
    } catch {
      addToast("Failed to update lab status", "danger");
    } finally {
      setSuspendLoading(false);
    }
  };

  const handleBillingChange = async (labId: string, status: BillingStatus) => {
    try {
      await api.patch(`/labs/${labId}/billing`, { billing_status: status });
      await queryClient.invalidateQueries({ queryKey: ["labs"] });
      refreshLabs();
      addToast(`Billing status updated to ${status.replace("_", " ")}`, "success");
    } catch {
      addToast("Failed to update billing status", "danger");
    }
  };

  const handleEnterLab = async (labId: string) => {
    setEnteringLabId(labId);
    try {
      await startImpersonation(labId);
      navigate("/dashboard");
    } catch (err: any) {
      const detail = err.response?.data?.detail || "Failed to enter lab";
      addToast(detail, "danger");
    } finally {
      setEnteringLabId(null);
    }
  };

  const handleTrialDateSave = async (labId: string) => {
    try {
      await api.patch(`/labs/${labId}/trial`, {
        trial_ends_at: trialDate ? new Date(trialDate).toISOString() : null,
      });
      setEditingTrialId(null);
      await queryClient.invalidateQueries({ queryKey: ["labs"] });
      addToast("Trial end date updated", "success");
    } catch {
      addToast("Failed to update trial date", "danger");
    }
  };

  const handleLinkStripe = async (labId: string) => {
    setLinkingStripeId(labId);
    try {
      await api.post(`/labs/${labId}/stripe-customer`);
      await queryClient.invalidateQueries({ queryKey: ["labs"] });
      addToast("Stripe customer created", "success");
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Failed to create Stripe customer", "danger");
    } finally {
      setLinkingStripeId(null);
    }
  };

  const handleClearInvoiceBlock = async (labId: string) => {
    try {
      await api.post(`/labs/${labId}/clear-invoice-block`);
      await queryClient.invalidateQueries({ queryKey: ["labs"] });
      refreshLabs();
      addToast("Invoice billing re-enabled for this lab", "success");
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Failed to clear invoice block", "danger");
    }
  };

  const [deletePrompt, setDeletePrompt] = useState<{ id: string; name: string } | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);

  const handleDeleteLab = async () => {
    if (!deletePrompt) return;
    setDeleteLoading(true);
    try {
      await api.delete(`/labs/${deletePrompt.id}`);
      setDeletePrompt(null);
      setDeleteConfirmText("");
      await queryClient.invalidateQueries({ queryKey: ["labs"] });
      refreshLabs();
      addToast("Lab permanently deleted", "success");
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Failed to delete lab", "danger");
    } finally {
      setDeleteLoading(false);
    }
  };

  const [subscribeTarget, setSubscribeTarget] = useState<{ id: string; name: string } | null>(null);
  const [subscribeTier, setSubscribeTier] = useState<"standard" | "enterprise">("standard");
  const [subscribeLoading, setSubscribeLoading] = useState(false);
  const [subscribeError, setSubscribeError] = useState<string | null>(null);

  const handleAdminSubscribe = async () => {
    if (!subscribeTarget) return;
    setSubscribeLoading(true);
    setSubscribeError(null);
    try {
      await api.post(`/labs/${subscribeTarget.id}/admin-subscribe`, { plan_tier: subscribeTier });
      await queryClient.invalidateQueries({ queryKey: ["labs"] });
      refreshLabs();
      const tierLabel = subscribeTier === "enterprise" ? "Enterprise" : "Standard";
      addToast(`${tierLabel} invoice subscription created for "${subscribeTarget.name}"`, "success");
      setSubscribeTarget(null);
    } catch (err: any) {
      setSubscribeError(err.response?.data?.detail || "Failed to create subscription");
    } finally {
      setSubscribeLoading(false);
    }
  };

  const [upgradingLabId, setUpgradingLabId] = useState<string | null>(null);

  const handleUpgradeLab = async (labId: string, labName: string) => {
    if (!confirm(`Upgrade "${labName}" to Enterprise? Stripe will prorate the charge.`)) return;
    setUpgradingLabId(labId);
    try {
      await api.post(`/labs/${labId}/upgrade`);
      await queryClient.invalidateQueries({ queryKey: ["labs"] });
      refreshLabs();
      addToast(`"${labName}" upgraded to Enterprise`, "success");
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Failed to upgrade lab", "danger");
    } finally {
      setUpgradingLabId(null);
    }
  };

  const handleSsoToggle = async (labId: string, current: boolean) => {
    try {
      await api.patch(`/labs/${labId}/settings`, { sso_enabled: !current });
      await queryClient.invalidateQueries({ queryKey: ["labs"] });
      refreshLabs();
      addToast(!current ? "SSO enabled" : "SSO disabled", "success");
    } catch {
      addToast("Failed to update SSO setting", "danger");
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Labs</h1>
        <div className="filters">
          <input
            type="search"
            placeholder="Search labs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search labs"
            style={{ minWidth: 200 }}
          />
          <button className="btn-chip btn-chip-primary" onClick={() => setShowForm(!showForm)}>
            {showForm ? "Cancel" : "+ New Lab"}
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {showForm && (
        <form className="inline-form" onSubmit={handleSubmit}>
          <input
            aria-label="Lab name"
            placeholder="Lab Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <button type="submit">Create Lab</button>
        </form>
      )}

      {loading && labs.length === 0 ? (
        <TableSkeleton rows={3} cols={5} />
      ) : !loading && labs.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No labs yet"
          description="Create your first lab to get started."
        />
      ) : (() => {
        const q = searchQuery.toLowerCase();
        const realLabs = labs.filter(l => !l.is_demo && (!q ||
          l.name.toLowerCase().includes(q) ||
          (l.billing_email && l.billing_email.toLowerCase().includes(q))
        ));
        const sections = [
          { key: "active", title: "Active Subscribers", labs: realLabs.filter(l => l.is_active && l.billing_status === "active") },
          { key: "invoice_pending", title: "Invoice Pending", labs: realLabs.filter(l => l.is_active && l.billing_status === "invoice_pending") },
          { key: "trial", title: "Trial", labs: realLabs.filter(l => l.is_active && l.billing_status === "trial") },
          { key: "past_due", title: "Past Due", labs: realLabs.filter(l => l.is_active && l.billing_status === "past_due") },
          { key: "cancelled", title: "Cancelled", labs: realLabs.filter(l => l.is_active && l.billing_status === "cancelled") },
          { key: "suspended", title: "Suspended", labs: realLabs.filter(l => !l.is_active) },
        ].filter(s => s.labs.length > 0);

        const renderLabRow = (l: Lab, sectionKey: string) => (
              <tr key={l.id}>
                <td>{l.name}</td>
                <td>
                  <ToggleSwitch
                    checked={l.is_active}
                    onChange={() => {
                      if (l.is_active) {
                        setSuspendPrompt({ id: l.id, name: l.name });
                      } else {
                        handleToggleSuspend(l.id);
                      }
                    }}
                    label={l.is_active ? "Active" : "Suspended"}
                  />
                </td>
                <td>
                  {l.stripe_subscription_id ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span className="badge badge-info" title="Managed by Stripe — change status in Stripe Dashboard">
                        {l.billing_status === "active" ? "Active" : l.billing_status === "invoice_pending" ? "Invoice Pending" : l.billing_status === "past_due" ? "Past Due" : l.billing_status === "cancelled" ? (
                          l.cancellation_reason === "trial_expired" ? "Cancelled (trial expired)" :
                          l.cancellation_reason === "payment_failed" ? "Cancelled (payment failed)" :
                          l.cancellation_reason === "customer_requested" ? "Cancelled (requested)" :
                          l.cancellation_reason === "invoice_uncollectible" ? "Cancelled (invoice unpaid)" :
                          l.cancellation_reason === "admin_manual" ? "Cancelled (by admin)" : "Cancelled"
                        ) : l.billing_status === "trial" ? "Trial" : l.billing_status}
                      </span>
                      {l.cancellation_reason === "invoice_uncollectible" && (
                        <button
                          className="btn-sm btn-secondary"
                          onClick={() => handleClearInvoiceBlock(l.id)}
                          title="Re-enable invoice billing for this lab"
                        >
                          Allow Invoice
                        </button>
                      )}
                      {l.billing_status === "cancelled" && l.stripe_customer_id && (
                        <button
                          className="btn-sm btn-primary"
                          onClick={() => { setSubscribeTarget({ id: l.id, name: l.name }); setSubscribeTier("standard"); setSubscribeError(null); }}
                          title="Create a new subscription for this cancelled lab"
                        >
                          Subscribe
                        </button>
                      )}
                    </div>
                  ) : (
                    <select
                      className="billing-select"
                      aria-label={`Billing status for ${l.name}`}
                      value={l.billing_status || "trial"}
                      onChange={(e) => handleBillingChange(l.id, e.target.value as BillingStatus)}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <option value="trial">Trial</option>
                      <option value="active">Active</option>
                      <option value="invoice_pending">Invoice Pending</option>
                      <option value="past_due">Past Due</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  )}
                </td>
                <td>
                  <span className={`badge ${l.plan_tier === "enterprise" ? "badge-info" : "badge-muted"}`}>
                    {l.plan_tier === "enterprise" ? "Enterprise" : "Standard"}
                  </span>
                  {l.is_active && (l.billing_status === "active" || l.billing_status === "invoice_pending") && l.plan_tier !== "enterprise" && l.stripe_subscription_id && (
                    <button
                      className="btn-sm btn-secondary"
                      style={{ marginLeft: 6 }}
                      onClick={() => handleUpgradeLab(l.id, l.name)}
                      disabled={upgradingLabId === l.id}
                    >
                      {upgradingLabId === l.id ? "..." : "Upgrade"}
                    </button>
                  )}
                </td>
                <td>
                  {sectionKey === "trial" ? (
                    l.stripe_subscription_id ? (
                      l.trial_ends_at ? new Date(l.trial_ends_at).toLocaleDateString() : <span className="text-muted">-</span>
                    ) : editingTrialId === l.id ? (
                      <span className="inline-edit">
                        <input
                          type="date"
                          aria-label="Trial end date"
                          value={trialDate}
                          onChange={(e) => setTrialDate(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleTrialDateSave(l.id);
                            if (e.key === "Escape") setEditingTrialId(null);
                          }}
                          autoFocus
                          style={{ width: 140 }}
                        />
                        <button className="btn-sm" onClick={() => handleTrialDateSave(l.id)}>Save</button>
                        <button className="btn-sm btn-secondary" onClick={() => setEditingTrialId(null)}>Cancel</button>
                      </span>
                    ) : (
                      <button
                        className="btn-link"
                        onClick={() => {
                          setEditingTrialId(l.id);
                          setTrialDate(l.trial_ends_at ? l.trial_ends_at.slice(0, 10) : "");
                        }}
                      >
                        {l.trial_ends_at ? new Date(l.trial_ends_at).toLocaleDateString() : "Not set"}
                      </button>
                    )
                  ) : l.current_period_end ? (
                    new Date(l.current_period_end).toLocaleDateString()
                  ) : (
                    <span className="text-muted">-</span>
                  )}
                </td>
                <td>
                  {l.stripe_customer_id ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span className={`badge ${l.stripe_subscription_id ? "badge-success" : "badge-muted"}`} style={{ fontFamily: "monospace", fontSize: "0.8em" }}>
                        {l.stripe_customer_id}
                      </span>
                      <CopyButton value={l.stripe_customer_id} />
                      {l.stripe_subscription_id && (
                        <button
                          className="btn-sm btn-secondary"
                          onClick={(e) => { e.stopPropagation(); setExpandedSubId(expandedSubId === l.id ? null : l.id); }}
                          style={{ marginLeft: 4 }}
                        >
                          Details
                        </button>
                      )}
                    </div>
                  ) : (
                    <button
                      className="btn-sm"
                      onClick={() => handleLinkStripe(l.id)}
                      disabled={linkingStripeId === l.id}
                    >
                      {linkingStripeId === l.id ? "Linking..." : "Link to Stripe"}
                    </button>
                  )}
                  {expandedSubId === l.id && <SubDetails labId={l.id} />}
                </td>
                <td style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <ToggleSwitch
                    checked={l.settings?.sso_enabled === true}
                    onChange={() => handleSsoToggle(l.id, l.settings?.sso_enabled === true)}
                  />
                  {l.settings?.sso_enabled === true && (
                    <button
                      className="btn-sm btn-secondary"
                      onClick={() => setSsoLab({ id: l.id, name: l.name })}
                      title="Configure SSO providers"
                    >
                      <Shield size={14} style={{ marginRight: 4, verticalAlign: -2 }} />
                      Configure
                    </button>
                  )}
                </td>
                <td>
                  <span
                    className={`badge ${l.settings?.support_access_enabled ? "badge-success" : "badge-muted"}`}
                    title="Controlled by Lab Admin from their Dashboard settings"
                  >
                    {l.settings?.support_access_enabled ? "Enabled" : "Disabled"}
                  </span>
                </td>
                <td>{new Date(l.created_at).toLocaleString()}</td>
                <td>
                  <div style={{ display: "flex", gap: 6 }}>
                    {l.is_active && l.settings?.support_access_enabled && (
                      <button
                        className="btn-sm"
                        onClick={() => handleEnterLab(l.id)}
                        disabled={enteringLabId === l.id}
                        title="Enter this lab in support mode"
                      >
                        <LogIn size={14} style={{ marginRight: 4, verticalAlign: -2 }} />
                        {enteringLabId === l.id ? "Entering..." : "Enter Lab"}
                      </button>
                    )}
                    {!l.is_demo && l.billing_status === "cancelled" && (
                      <button
                        className="btn-sm btn-danger-outline"
                        onClick={() => { setDeletePrompt({ id: l.id, name: l.name }); setDeleteConfirmText(""); }}
                        title="Permanently delete this lab and all data"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
        );

        return sections.map(section => (
          <div key={section.key} style={{ marginBottom: "var(--space-xl)" }}>
            <h2 style={{ fontSize: "var(--text-base)", marginBottom: "var(--space-sm)" }}>
              {section.title}
              <span className="text-muted" style={{ fontWeight: 400, marginLeft: 8 }}>{section.labs.length}</span>
            </h2>
            <div className="table-scroll">
            <table className="labs-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Billing</th>
                  <th>Plan</th>
                  <th>{section.key === "trial" ? "Trial Ends" : "Period Ends"}</th>
                  <th>Subscription</th>
                  <th>SSO</th>
                  <th>Support Access</th>
                  <th>Created At</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {section.labs.map(l => renderLabRow(l, section.key))}
              </tbody>
            </table>
            </div>
          </div>
        ));
      })()}

      {ssoLab && (
        <Suspense fallback={null}>
          <AuthProviderModal
            labId={ssoLab.id}
            labName={ssoLab.name}
            onClose={() => setSsoLab(null)}
          />
        </Suspense>
      )}

      {suspendPrompt && (
        <Modal onClose={() => setSuspendPrompt(null)} ariaLabel="Suspend lab">
          <div className="modal-content">
            <h2>Suspend {suspendPrompt.name}?</h2>
            <p className="page-desc">
              Users in this lab will have read-only access. No data will be deleted.
              You can reactivate the lab at any time.
            </p>
            <div className="action-btns" style={{ marginTop: "var(--space-lg)" }}>
              <button
                className="btn-danger"
                onClick={() => handleToggleSuspend(suspendPrompt.id)}
                disabled={suspendLoading}
              >
                {suspendLoading ? "Suspending..." : "Suspend Lab"}
              </button>
              <button
                className="btn-secondary"
                onClick={() => setSuspendPrompt(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}

      {deletePrompt && (
        <Modal onClose={() => setDeletePrompt(null)} ariaLabel="Delete lab">
          <div className="modal-content">
            <h2>Permanently delete {deletePrompt.name}?</h2>
            <p className="page-desc">
              This action is <strong>irreversible</strong>. All users, inventory data, QC documents,
              audit logs, and the Stripe customer will be permanently deleted.
            </p>
            <p className="page-desc" style={{ marginTop: "var(--space-sm)" }}>
              Type <strong>{deletePrompt.name}</strong> to confirm:
            </p>
            <input
              type="text"
              className="input"
              value={deleteConfirmText}
              onChange={e => setDeleteConfirmText(e.target.value)}
              placeholder={deletePrompt.name}
              autoFocus
            />
            <div className="action-btns" style={{ marginTop: "var(--space-lg)" }}>
              <button
                className="btn-danger"
                onClick={handleDeleteLab}
                disabled={deleteLoading || deleteConfirmText !== deletePrompt.name}
              >
                {deleteLoading ? "Deleting..." : "Delete Lab Permanently"}
              </button>
              <button
                className="btn-secondary"
                onClick={() => setDeletePrompt(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}

      {subscribeTarget && (
        <Modal onClose={() => setSubscribeTarget(null)} ariaLabel="Subscribe lab">
          <div className="modal-content" style={{ maxWidth: 480 }}>
            <h2>Subscribe {subscribeTarget.name}</h2>
            <p className="text-muted" style={{ margin: "8px 0 16px" }}>
              Create an invoice subscription for this cancelled lab.
            </p>
            <div className="plan-selector">
              {(["standard", "enterprise"] as const).map((tier) => (
                <button
                  key={tier}
                  type="button"
                  className={`plan-option${subscribeTier === tier ? " plan-option--selected" : ""}`}
                  onClick={() => setSubscribeTier(tier)}
                >
                  <strong>{tier === "enterprise" ? "Enterprise" : "Standard"}</strong>
                  <div className="plan-option-price">{tier === "enterprise" ? "$700/mo" : "$350/mo"}</div>
                  <div className="text-muted" style={{ fontSize: "var(--text-sm)" }}>
                    {tier === "enterprise" ? "$8,400/year" : "$4,200/year"}
                  </div>
                </button>
              ))}
            </div>
            {subscribeError && <div className="form-error" style={{ marginTop: 12 }}>{subscribeError}</div>}
            <div style={{ marginTop: 16, display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn-secondary" onClick={() => setSubscribeTarget(null)} disabled={subscribeLoading}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleAdminSubscribe} disabled={subscribeLoading}>
                {subscribeLoading ? "Creating..." : `Create ${subscribeTier === "enterprise" ? "Enterprise" : "Standard"} Subscription`}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
