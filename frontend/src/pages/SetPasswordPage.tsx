import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import { ShieldCheck } from "lucide-react";

export default function SetPasswordPage() {
  const { refreshUser } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const passwordLongEnough = password.length >= 8;

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

    setLoading(true);
    try {
      await api.post("/auth/accept-invite", { token, password });
      await refreshUser();
      navigate("/");
    } catch {
      setError(
        "This link has expired or already been used. Contact your administrator."
      );
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="login-container">
        <div className="login-orb login-orb-1" aria-hidden="true" />
        <div className="login-orb login-orb-2" aria-hidden="true" />
        <div className="login-orb login-orb-3" aria-hidden="true" />
        <div className="login-card">
          <p className="error login-error">
            Invalid link. Contact your administrator.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-container">
      <div className="login-orb login-orb-1" aria-hidden="true" />
      <div className="login-orb login-orb-2" aria-hidden="true" />
      <div className="login-orb login-orb-3" aria-hidden="true" />

      <div className="login-card">
        <div className="login-brand">
          <div className="login-icon login-icon-welcome">
            <ShieldCheck size={26} />
          </div>
          <div>
            <h1>Welcome to LabAid</h1>
            <p className="subtitle">Set your password to get started</p>
          </div>
        </div>

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

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="set-password">Password</label>
            <input
              id="set-password"
              type="password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoFocus
            />
            {password.length > 0 && (
              <span
                className={`field-hint ${passwordLongEnough ? "hint-success" : "hint-warn"}`}
              >
                {passwordLongEnough
                  ? "Looks good"
                  : `${8 - password.length} more character${8 - password.length === 1 ? "" : "s"} needed`}
              </span>
            )}
          </div>
          <div className="form-group">
            <label htmlFor="confirm-set-password">Confirm Password</label>
            <input
              id="confirm-set-password"
              type="password"
              placeholder="Re-enter your password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
            />
            {confirmPassword.length > 0 && (
              <span
                className={`field-hint ${passwordsMatch ? "hint-success" : "hint-warn"}`}
              >
                {passwordsMatch ? "Passwords match" : "Passwords don't match"}
              </span>
            )}
          </div>
          {error && <p className="error login-error">{error}</p>}
          <button
            type="submit"
            className="login-submit"
            disabled={!passwordLongEnough || !passwordsMatch || loading}
          >
            {loading ? "Setting password..." : "Set Password & Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
