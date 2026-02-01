import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";

export default function ChangePasswordPage() {
  const { refreshUser } = useAuth();
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    try {
      await api.post("/auth/change-password", { new_password: newPassword });
      await refreshUser();
      navigate("/");
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to change password");
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <h1>Change Password</h1>
        <p className="subtitle">
          You must choose a new password before continuing.
        </p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            placeholder="New Password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={6}
            autoFocus
          />
          <input
            type="password"
            placeholder="Confirm Password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={6}
          />
          {error && <p className="error">{error}</p>}
          <button type="submit">Set New Password</button>
        </form>
      </div>
    </div>
  );
}
