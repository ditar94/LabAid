import { useState, type FormEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import { ShieldCheck, KeyRound } from "lucide-react";

export default function ChangePasswordPage() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");

  const isForced = !!user?.must_change_password;
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;
  const passwordLongEnough = newPassword.length >= 8;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (!passwordLongEnough) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (!passwordsMatch) {
      setError("Passwords do not match");
      return;
    }

    try {
      await api.post("/auth/change-password", { new_password: newPassword });
      await refreshUser();
      navigate("/dashboard");
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to change password");
    }
  };

  return (
    <div className="login-container">
      <div className="login-orb login-orb-1" aria-hidden="true" />
      <div className="login-orb login-orb-2" aria-hidden="true" />
      <div className="login-orb login-orb-3" aria-hidden="true" />

      <div className="login-card">
        <div className="login-brand">
          <div className={`login-icon${isForced ? " login-icon-welcome" : ""}`}>
            {isForced ? <ShieldCheck size={26} /> : <KeyRound size={26} />}
          </div>
          <div>
            <h1>{isForced ? "Welcome to LabAid" : "Change Password"}</h1>
            <p className="subtitle">
              {isForced
                ? "Set your personal password to get started"
                : "Enter a new password for your account"}
            </p>
          </div>
        </div>

        {isForced && (
          <div className="onboarding-steps">
            <div className="onboarding-step completed">
              <div className="step-dot" />
              <span>Account created</span>
            </div>
            <div className="onboarding-step active">
              <div className="step-dot" />
              <span>Set password</span>
            </div>
            <div className="onboarding-step">
              <div className="step-dot" />
              <span>Start using LabAid</span>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="new-password">New Password</label>
            <input
              id="new-password"
              type="password"
              placeholder="At least 8 characters"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              autoFocus
            />
            {newPassword.length > 0 && (
              <span className={`field-hint ${passwordLongEnough ? "hint-success" : "hint-warn"}`}>
                {passwordLongEnough ? "Looks good" : `${8 - newPassword.length} more character${8 - newPassword.length === 1 ? "" : "s"} needed`}
              </span>
            )}
          </div>
          <div className="form-group">
            <label htmlFor="confirm-password">Confirm Password</label>
            <input
              id="confirm-password"
              type="password"
              placeholder="Re-enter your password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
            />
            {confirmPassword.length > 0 && (
              <span className={`field-hint ${passwordsMatch ? "hint-success" : "hint-warn"}`}>
                {passwordsMatch ? "Passwords match" : "Passwords don't match"}
              </span>
            )}
          </div>
          {error && <p className="error login-error">{error}</p>}
          <button
            type="submit"
            className="login-submit"
            disabled={!passwordLongEnough || !passwordsMatch}
          >
            {isForced ? "Set Password & Continue" : "Update Password"}
          </button>
        </form>
        {isForced ? (
          <p className="login-footer">You can change your password later in settings</p>
        ) : (
          <p className="login-footer">
            <Link to="/dashboard">Cancel</Link>
          </p>
        )}
      </div>
    </div>
  );
}
