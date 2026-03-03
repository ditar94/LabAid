import { useState, type FormEvent } from "react";
import { useNavigate, Navigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ArrowLeft, ArrowRight } from "lucide-react";
import api from "../api/client";
import { preloadAppChunks } from "../App";

export default function SignupPage() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<1 | 2>(1);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [labName, setLabName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState<"email" | "lab" | null>(null);
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/dashboard" replace />;

  const hasLength = password.length >= 10;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /\d/.test(password);
  const passwordValid = hasLength && hasUpper && hasLower && hasDigit;
  const passwordsMatch = password.length > 0 && password === confirmPassword;

  const step1Valid = fullName.trim() && email.trim() && labName.trim();

  const handleStep1 = (e: FormEvent) => {
    e.preventDefault();
    if (!step1Valid) return;
    setError("");
    setFieldError(null);
    setStep(2);
  };

  const handleSignup = async (e: FormEvent) => {
    e.preventDefault();
    if (!passwordValid || !passwordsMatch) return;
    setError("");
    setFieldError(null);
    setLoading(true);
    try {
      await api.post("/auth/signup", {
        email: email.trim(),
        password,
        full_name: fullName.trim(),
        lab_name: labName.trim(),
      });
      preloadAppChunks();
      await refreshUser();
      navigate("/dashboard");
    } catch (err: any) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || "";
      if (status === 409 && detail.toLowerCase().includes("email")) {
        setFieldError("email");
        setStep(1);
        setError(detail);
      } else if (status === 409 && detail.toLowerCase().includes("lab")) {
        setFieldError("lab");
        setStep(1);
        setError(detail);
      } else if (status === 429) {
        setError("Too many attempts. Please wait a minute and try again.");
      } else {
        setError(detail || "Signup failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-orb login-orb-1" aria-hidden="true" />
      <div className="login-orb login-orb-2" aria-hidden="true" />
      <div className="login-orb login-orb-3" aria-hidden="true" />

      <a href="/" className="login-back-link"><ArrowLeft size={16} /> Back to home</a>
      <div className="login-card">
        <div className="login-brand">
          <div className="login-icon">
            <img src="/labaid-icon.svg" alt="" style={{ width: 72, height: 72 }} />
          </div>
          <div>
            <h1>Create your lab</h1>
            <p className="subtitle">Start your free 7-day trial</p>
          </div>
        </div>

        <div className="onboarding-steps">
          <div className={`onboarding-step ${step === 2 ? "completed" : "active"}`}>
            <div className="step-dot" />
            <span>Your details</span>
          </div>
          <div className={`onboarding-step ${step === 2 ? "active" : ""}`}>
            <div className="step-dot" />
            <span>Set password</span>
          </div>
          <div className="onboarding-step">
            <div className="step-dot" />
            <span>Set up your lab</span>
          </div>
        </div>

        {step === 1 && (
          <form onSubmit={handleStep1}>
            <div className="form-group">
              <label htmlFor="signup-name">Full name</label>
              <input
                id="signup-name"
                type="text"
                placeholder="Jane Smith"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="form-group">
              <label htmlFor="signup-email">Email</label>
              <input
                id="signup-email"
                type="email"
                placeholder="you@lab.edu"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setFieldError(null); }}
                required
                className={fieldError === "email" ? "input-error" : ""}
              />
            </div>
            <div className="form-group">
              <label htmlFor="signup-lab">Lab name</label>
              <input
                id="signup-lab"
                type="text"
                placeholder="Sacred Heart Flow Cytometry Lab"
                value={labName}
                onChange={(e) => { setLabName(e.target.value); setFieldError(null); }}
                required
                className={fieldError === "lab" ? "input-error" : ""}
              />
            </div>
            {error && <p className="error login-error">{error}</p>}
            <button type="submit" className="login-submit" disabled={!step1Valid}>
              Continue <ArrowRight size={16} style={{ marginLeft: 4, verticalAlign: -2 }} />
            </button>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={handleSignup}>
            <button
              type="button"
              className="login-back-step"
              onClick={() => { setStep(1); setError(""); }}
            >
              <ArrowLeft size={14} /> Back
            </button>
            <div className="form-group">
              <label htmlFor="signup-password">Password</label>
              <input
                id="signup-password"
                type="password"
                placeholder="At least 10 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={10}
                autoFocus
              />
              <div className="password-rules">
                <span className={`field-hint ${password.length === 0 ? "" : hasLength ? "hint-success" : "hint-warn"}`}>
                  {hasLength ? "Length OK" : "10+ characters"}
                </span>
                <span className={`field-hint ${password.length === 0 ? "" : hasUpper ? "hint-success" : "hint-warn"}`}>
                  {hasUpper ? "Uppercase OK" : "Uppercase letter"}
                </span>
                <span className={`field-hint ${password.length === 0 ? "" : hasLower ? "hint-success" : "hint-warn"}`}>
                  {hasLower ? "Lowercase OK" : "Lowercase letter"}
                </span>
                <span className={`field-hint ${password.length === 0 ? "" : hasDigit ? "hint-success" : "hint-warn"}`}>
                  {hasDigit ? "Digit OK" : "A number"}
                </span>
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="signup-confirm">Confirm password</label>
              <input
                id="signup-confirm"
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
              disabled={!passwordValid || !passwordsMatch || loading}
            >
              {loading ? "Creating your lab..." : "Create Lab"}
            </button>
          </form>
        )}

        <p className="login-footer">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
