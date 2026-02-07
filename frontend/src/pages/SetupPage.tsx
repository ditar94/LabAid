import { useState, type FormEvent } from "react";
import api from "../api/client";
import { useNavigate } from "react-router-dom";
import { FlaskConical, ArrowRight, CheckCircle2 } from "lucide-react";

export default function SetupPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await api.post("/auth/setup", {
        email,
        password,
        full_name: fullName,
      });
      setSuccess(true);
      setTimeout(() => navigate("/login"), 2500);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Setup failed");
    }
  };

  const handleStep1 = (e: FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !email.trim()) return;
    setStep(2);
  };

  return (
    <div className="login-container">
      <div className="login-orb login-orb-1" aria-hidden="true" />
      <div className="login-orb login-orb-2" aria-hidden="true" />
      <div className="login-orb login-orb-3" aria-hidden="true" />

      <div className="login-card">
        <div className="login-brand">
          <div className="login-icon">
            <FlaskConical size={26} />
          </div>
          <div>
            <h1>LabAid Setup</h1>
            <p className="subtitle">Create the platform admin account</p>
          </div>
        </div>

        {/* Step indicator */}
        <div className="onboarding-steps">
          <div className={`onboarding-step${step > 1 ? " completed" : " active"}`}>
            <div className="step-dot" />
            <span>Your info</span>
          </div>
          <div className={`onboarding-step${success ? " completed" : step === 2 ? " active" : ""}`}>
            <div className="step-dot" />
            <span>Set password</span>
          </div>
          <div className={`onboarding-step${success ? " active" : ""}`}>
            <div className="step-dot" />
            <span>Ready</span>
          </div>
        </div>

        {success ? (
          <div className="setup-success">
            <CheckCircle2 size={40} className="setup-success-icon" />
            <p className="setup-success-title">Setup complete!</p>
            <p className="setup-success-desc">Redirecting to login...</p>
          </div>
        ) : step === 1 ? (
          <form onSubmit={handleStep1}>
            <div className="form-group">
              <label htmlFor="setup-name">Full Name</label>
              <input
                id="setup-name"
                placeholder="Your full name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="form-group">
              <label htmlFor="setup-email">Email</label>
              <input
                id="setup-email"
                type="email"
                placeholder="admin@lab.edu"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="login-submit">
              Continue <ArrowRight size={16} style={{ marginLeft: 4, verticalAlign: "middle" }} />
            </button>
          </form>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="setup-step-context">
              Setting up account for <strong>{fullName}</strong> ({email})
              <button
                type="button"
                className="setup-back-link"
                onClick={() => setStep(1)}
              >
                Change
              </button>
            </div>
            <div className="form-group">
              <label htmlFor="setup-password">Password</label>
              <input
                id="setup-password"
                type="password"
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoFocus
              />
              {password.length > 0 && password.length < 6 && (
                <span className="field-hint hint-warn">
                  {6 - password.length} more character{6 - password.length === 1 ? "" : "s"} needed
                </span>
              )}
            </div>
            {error && <p className="error login-error">{error}</p>}
            <button
              type="submit"
              className="login-submit"
              disabled={password.length < 6}
            >
              Create Admin Account
            </button>
          </form>
        )}
        <p className="login-footer">First-time setup — this creates your super admin account</p>
      </div>
    </div>
  );
}
