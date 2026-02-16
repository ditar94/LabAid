import { useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { User } from "../api/types";
import { useAuth } from "../context/AuthContext";
import { useSharedData } from "../context/SharedDataContext";
import { Users as UsersIcon, ChevronDown, ChevronRight } from "lucide-react";
import EmptyState from "../components/EmptyState";
import { useToast } from "../context/ToastContext";

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const { labs, selectedLab, setSelectedLab } = useSharedData();
  const queryClient = useQueryClient();
  const labParams = currentUser?.role === "super_admin" && selectedLab ? { lab_id: selectedLab } : {};
  const { data: users = [], isLoading: loading } = useQuery<User[]>({
    queryKey: ["users", selectedLab],
    queryFn: () => api.get("/auth/users", { params: labParams }).then(r => r.data),
    enabled: !!selectedLab,
  });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    email: "",
    full_name: "",
    role: "tech",
  });
  const [inviteResult, setInviteResult] = useState<{
    email: string;
    link?: string;
    sent: boolean;
  } | null>(null);
  const [resetResult, setResetResult] = useState<{
    email: string;
    link?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { addToast } = useToast();
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [editEmailValue, setEditEmailValue] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInviteResult(null);
    try {
      const params: Record<string, string> = {};
      if (currentUser?.role === "super_admin" && selectedLab) {
        params.lab_id = selectedLab;
      }
      const res = await api.post("/auth/users", form, { params });
      setInviteResult({
        email: form.email,
        link: res.data.set_password_link || undefined,
        sent: res.data.invite_sent,
      });
      if (res.data.invite_sent) {
        addToast(`User "${form.full_name}" created — invite sent`, "success");
      } else {
        addToast(`User created but invite email failed to send`, "warning");
      }
      setForm({ email: "", full_name: "", role: "tech" });
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ["users"] });
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to create user");
    }
  };

  const handleResetPassword = async (userId: string) => {
    setError(null);
    setResetResult(null);
    try {
      const u = users.find((u) => u.id === userId);
      const res = await api.post(`/auth/users/${userId}/reset-password`);
      setResetResult({
        email: u?.email || "",
        link: res.data.set_password_link || undefined,
      });
      addToast(`Password reset for ${u?.full_name || "user"}`, "info");
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to reset password");
    }
  };

  // Build role options based on current user's role
  const roleOptions: { value: string; label: string }[] = [];
  if (
    currentUser?.role === "super_admin"
  ) {
    roleOptions.push(
      { value: "lab_admin", label: "Lab Admin" },
      { value: "supervisor", label: "Supervisor" },
      { value: "tech", label: "Tech" },
      { value: "read_only", label: "Read Only" }
    );
  } else if (currentUser?.role === "lab_admin") {
    roleOptions.push(
      { value: "lab_admin", label: "Lab Admin" },
      { value: "supervisor", label: "Supervisor" },
      { value: "tech", label: "Tech" },
      { value: "read_only", label: "Read Only" }
    );
  }

  const canManage = currentUser?.role === "super_admin" || currentUser?.role === "lab_admin";
  const [showInactive, setShowInactive] = useState(false);

  const { activeUsers, inactiveUsers } = useMemo(() => {
    const active: User[] = [];
    const inactive: User[] = [];
    for (const u of users) {
      if (u.is_active) active.push(u);
      else inactive.push(u);
    }
    return { activeUsers: active, inactiveUsers: inactive };
  }, [users]);

  const handleRoleChange = async (userId: string, newRole: string) => {
    setError(null);
    try {
      await api.patch(`/auth/users/${userId}/role`, { role: newRole });
      const u = users.find((u) => u.id === userId);
      addToast(`Role updated for ${u?.full_name || "user"}`, "success");
      queryClient.invalidateQueries({ queryKey: ["users"] });
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to update role");
    }
  };

  const handleToggleActive = async (u: User) => {
    setError(null);
    const newActive = !u.is_active;
    const action = newActive ? "reactivate" : "deactivate";
    if (!confirm(`Are you sure you want to ${action} ${u.full_name}?`)) return;
    try {
      await api.patch(`/auth/users/${u.id}`, { is_active: newActive });
      addToast(`${u.full_name} ${newActive ? "reactivated" : "deactivated"}`, "success");
      queryClient.invalidateQueries({ queryKey: ["users"] });
    } catch (err: any) {
      setError(err.response?.data?.detail || `Failed to ${action} user`);
    }
  };

  const handleEmailSave = async (userId: string) => {
    setError(null);
    try {
      await api.patch(`/auth/users/${userId}`, { email: editEmailValue });
      addToast("Email updated", "success");
      setEditingEmail(null);
      queryClient.invalidateQueries({ queryKey: ["users"] });
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to update email");
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Users</h1>
        <div className="filters">
          {currentUser?.role === "super_admin" && labs.length > 0 && (
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
          )}
          {canManage && (
            <button onClick={() => setShowForm(!showForm)}>
              {showForm ? "Cancel" : "+ New User"}
            </button>
          )}
        </div>
      </div>

      {inviteResult && (
        <div className="temp-password-banner">
          {inviteResult.sent
            ? <>Invite email sent to <strong>{inviteResult.email}</strong>.</>
            : <>User created but invite email failed to send to <strong>{inviteResult.email}</strong>. Use "Reset Password" to resend.</>
          }
          {inviteResult.link && (
            <>
              {" "}Dev link:{" "}
              <a href={inviteResult.link} target="_blank" rel="noopener noreferrer" className="mono">
                {inviteResult.link}
              </a>
            </>
          )}
        </div>
      )}

      {resetResult && (
        <div className="temp-password-banner">
          Password reset email sent to <strong>{resetResult.email}</strong>.
          {resetResult.link && (
            <>
              {" "}Dev link:{" "}
              <a href={resetResult.link} target="_blank" rel="noopener noreferrer" className="mono">
                {resetResult.link}
              </a>
            </>
          )}
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {showForm && (
        <form className="inline-form" onSubmit={handleSubmit}>
          <input
            placeholder="Full Name"
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            required
          />
          <input
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            {roleOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <button type="submit">Create User</button>
        </form>
      )}

      {!loading && users.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title="No users found"
          description="Create a user to give them access to this lab."
        />
      ) : (
        <>
        <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {activeUsers.map((u) => {
              const canEdit = canManage && u.id !== currentUser?.id && u.role !== "super_admin";
              return (
              <tr key={u.id}>
                <td>{u.full_name}</td>
                <td>
                  {editingEmail === u.id ? (
                    <span className="inline-edit">
                      <input
                        type="email"
                        value={editEmailValue}
                        onChange={(e) => setEditEmailValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleEmailSave(u.id);
                          if (e.key === "Escape") setEditingEmail(null);
                        }}
                        autoFocus
                      />
                      <button className="btn-sm" onClick={() => handleEmailSave(u.id)}>Save</button>
                      <button className="btn-sm btn-secondary" onClick={() => setEditingEmail(null)}>Cancel</button>
                    </span>
                  ) : (
                    <span>
                      {u.email}
                      {canEdit && (
                        <button
                          className="btn-link btn-edit-email"
                          onClick={() => { setEditingEmail(u.id); setEditEmailValue(u.email); }}
                          title="Edit email"
                        >
                          Edit
                        </button>
                      )}
                    </span>
                  )}
                </td>
                <td>
                  {canEdit ? (
                    <select
                      value={u.role}
                      onChange={(e) => handleRoleChange(u.id, e.target.value)}
                    >
                      {roleOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    u.role.replaceAll("_", " ")
                  )}
                </td>
                <td className="action-btns">
                  {canEdit && (
                    <>
                      <button
                        className="btn-sm"
                        onClick={() => handleResetPassword(u.id)}
                      >
                        Reset Password
                      </button>
                      <button
                        className="btn-sm btn-danger"
                        onClick={() => handleToggleActive(u)}
                      >
                        Deactivate
                      </button>
                    </>
                  )}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        </div>

        {inactiveUsers.length > 0 && (
          <div style={{ marginTop: "1.5rem" }}>
            <button
              className="btn-sm btn-secondary"
              onClick={() => setShowInactive(!showInactive)}
              style={{ display: "flex", alignItems: "center", gap: 4 }}
            >
              {showInactive ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Inactive Users ({inactiveUsers.length})
            </button>
            {showInactive && (
              <div className="table-scroll" style={{ marginTop: "0.5rem" }}>
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {inactiveUsers.map((u) => {
                    const canEdit = canManage && u.id !== currentUser?.id && u.role !== "super_admin";
                    return (
                    <tr key={u.id} className="row-inactive">
                      <td>{u.full_name}</td>
                      <td>{u.email}</td>
                      <td>{u.role.replaceAll("_", " ")}</td>
                      <td className="action-btns">
                        {canEdit && (
                          <button
                            className="btn-sm btn-success"
                            onClick={() => handleToggleActive(u)}
                          >
                            Activate
                          </button>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            )}
          </div>
        )}
        </>
      )}
    </div>
  );
}
