import { useState, type FormEvent } from "react";
import { useNavigate, Navigate, Link } from "react-router-dom";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import { ShieldCheck, KeyRound } from "lucide-react";

export default function ChangePasswordPage() {
  const { user, labSettings, refreshUser } = useAuth();

  if (labSettings.password_enabled === false) {
    return <Navigate to="/dashboard" replace />;
  }
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");

  const isForced = !!user?.must_change_password;
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;
  const hasLength = newPassword.length >= 10;
  const hasUpper = /[A-Z]/.test(newPassword);
  const hasLower = /[a-z]/.test(newPassword);
  const hasDigit = /\d/.test(newPassword);
  const passwordValid = hasLength && hasUpper && hasLower && hasDigit;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (!passwordValid) {
      setError("Password does not meet all requirements");
      return;
    }
    if (!passwordsMatch) {
      setError("Passwords do not match");
      return;
    }

    try {
      await api.post("/auth/change-password", {
        ...(!isForced && { current_password: currentPassword }),
        new_password: newPassword,
      });
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
          {!isForced && (
            <div className="form-group">
              <label htmlFor="current-password">Current Password</label>
              <input
                id="current-password"
                type="password"
                placeholder="Enter your current password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoFocus
              />
            </div>
          )}
          <div className="form-group">
            <label htmlFor="new-password">New Password</label>
            <input
              id="new-password"
              type="password"
              placeholder="At least 10 characters"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={10}
              autoFocus={isForced}
            />
            <div className="password-rules">
              <span className={`field-hint ${newPassword.length === 0 ? "" : hasLength ? "hint-success" : "hint-warn"}`}>
                {hasLength ? "Length OK" : "10+ characters"}
              </span>
              <span className={`field-hint ${newPassword.length === 0 ? "" : hasUpper ? "hint-success" : "hint-warn"}`}>
                {hasUpper ? "Uppercase OK" : "Uppercase letter"}
              </span>
              <span className={`field-hint ${newPassword.length === 0 ? "" : hasLower ? "hint-success" : "hint-warn"}`}>
                {hasLower ? "Lowercase OK" : "Lowercase letter"}
              </span>
              <span className={`field-hint ${newPassword.length === 0 ? "" : hasDigit ? "hint-success" : "hint-warn"}`}>
                {hasDigit ? "Digit OK" : "A number"}
              </span>
            </div>
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
              minLength={10}
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
            disabled={!passwordValid || !passwordsMatch || (!isForced && !currentPassword)}
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
