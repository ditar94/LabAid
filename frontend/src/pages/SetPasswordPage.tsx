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
  const hasLength = password.length >= 10;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /\d/.test(password);
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

    setLoading(true);
    try {
      await api.post("/auth/accept-invite", { token, password });
      // Password set successfully — try to auto-login via cookie
      try {
        await refreshUser();
        navigate("/dashboard");
      } catch {
        // Cookie may not propagate through Firebase Hosting — redirect to login
        navigate("/login");
      }
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
              placeholder="At least 10 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={10}
              autoFocus
            />
            {password.length > 0 && (
              <div className="password-rules">
                <span className={`field-hint ${hasLength ? "hint-success" : "hint-warn"}`}>
                  {hasLength ? "Length OK" : `${10 - password.length} more character${10 - password.length === 1 ? "" : "s"}`}
                </span>
                <span className={`field-hint ${hasUpper ? "hint-success" : "hint-warn"}`}>
                  {hasUpper ? "Uppercase OK" : "Need uppercase"}
                </span>
                <span className={`field-hint ${hasLower ? "hint-success" : "hint-warn"}`}>
                  {hasLower ? "Lowercase OK" : "Need lowercase"}
                </span>
                <span className={`field-hint ${hasDigit ? "hint-success" : "hint-warn"}`}>
                  {hasDigit ? "Digit OK" : "Need a digit"}
                </span>
              </div>
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
              minLength={10}
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
            disabled={!passwordValid || !passwordsMatch || loading}
          >
            {loading ? "Setting password..." : "Set Password & Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
