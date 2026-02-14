import { useEffect, useState, type FormEvent } from "react";
import api from "../api/client";
import type { User } from "../api/types";
import { useAuth } from "../context/AuthContext";
import { useSharedData } from "../context/SharedDataContext";
import { Users as UsersIcon } from "lucide-react";
import EmptyState from "../components/EmptyState";
import { useToast } from "../context/ToastContext";

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const { labs, selectedLab, setSelectedLab } = useSharedData();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    email: "",
    full_name: "",
    role: "tech",
  });
  const [inviteResult, setInviteResult] = useState<{
    email: string;
    link?: string;
  } | null>(null);
  const [resetResult, setResetResult] = useState<{
    email: string;
    link?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { addToast } = useToast();

  const load = () => {
    if (!selectedLab) return;
    const params: Record<string, string> = {};
    if (currentUser?.role === "super_admin") {
      params.lab_id = selectedLab;
    }
    api
      .get("/auth/users", { params })
      .then((r) => setUsers(r.data))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (selectedLab) {
      setLoading(true);
      load();
    }
  }, [selectedLab]);

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
      });
      addToast(`User "${form.full_name}" created`, "success");
      setForm({ email: "", full_name: "", role: "tech" });
      setShowForm(false);
      load();
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

  const handleRoleChange = async (userId: string, newRole: string) => {
    setError(null);
    try {
      await api.patch(`/auth/users/${userId}/role`, { role: newRole });
      const u = users.find((u) => u.id === userId);
      addToast(`Role updated for ${u?.full_name || "user"}`, "success");
      load();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to update role");
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
          Invite email sent to <strong>{inviteResult.email}</strong>.
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

      {loading ? (
        <div className="stagger-reveal">
          <div className="skeleton skeleton-row" />
          <div className="skeleton skeleton-row" />
          <div className="skeleton skeleton-row" />
          <div className="skeleton skeleton-row" />
        </div>
      ) : users.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title="No users found"
          description="Create a user to give them access to this lab."
        />
      ) : (
        <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Active</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.full_name}</td>
                <td>{u.email}</td>
                <td>
                  {canManage && u.id !== currentUser?.id && u.role !== "super_admin" ? (
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
                <td>{u.is_active ? "Yes" : "No"}</td>
                <td className="action-btns">
                  {canManage && u.id !== currentUser?.id && (
                    <button
                      className="btn-sm"
                      onClick={() => handleResetPassword(u.id)}
                    >
                      Reset Password
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
