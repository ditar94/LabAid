import { useState, lazy, Suspense, type FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { Navigate, useNavigate, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { version } from "../../package.json";
import { preloadAppChunks } from "../App";
import api from "../api/client";

const TermsModal = lazy(() => import("../components/TermsModal"));

const SSO_LABELS: Record<string, string> = {
  oidc_microsoft: "Sign in with Microsoft",
  oidc_google: "Sign in with Google",
};

export default function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<"email" | "auth">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [providers, setProviders] = useState<string[]>([]);

  const [error, setError] = useState("");
  const [shaking, setShaking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showTerms, setShowTerms] = useState(false);

  if (user) return <Navigate to="/dashboard" replace />;

  const handleDiscover = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api.post("/auth/discover", { email });
      const disc: string[] = res.data.providers;
      const hasPass = disc.includes("password");
      const sso = disc.filter((p) => p !== "password" && SSO_LABELS[p]);

      // SSO-only with a single provider — auto-redirect
      if (!hasPass && sso.length === 1) {
        sessionStorage.setItem("sso_email", email);
        const domain = email.split("@")[1];
        window.location.href = `/api/auth/sso/${sso[0]}/authorize?email_domain=${encodeURIComponent(domain)}&login_hint=${encodeURIComponent(email)}`;
        return;
      }

      setProviders(disc);
      setStep("auth");
    } catch (err: any) {
      if (err?.response?.status === 429) {
        setError("Too many attempts. Please wait a minute and try again.");
      } else {
        // Fallback to password-only for unknown domains
        setProviders(["password"]);
        setStep("auth");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      preloadAppChunks();
      navigate("/dashboard");
    } catch (err: any) {
      if (err?.response?.status === 429) {
        setError("Too many login attempts. Please wait a minute and try again.");
      } else if (err?.code === "ECONNABORTED") {
        setError("Login request timed out. Please try again.");
      } else if (err?.response?.status === 401) {
        setError("Invalid credentials");
      } else if (err?.response?.data?.detail) {
        setError(String(err.response.data.detail));
      } else {
        setError("Sign-in failed. Please try again.");
      }
      setShaking(true);
      setTimeout(() => setShaking(false), 500);
    } finally {
      setLoading(false);
    }
  };

  const handleSSO = (providerType: string) => {
    sessionStorage.setItem("sso_email", email);
    const domain = email.split("@")[1];
    window.location.href = `/api/auth/sso/${providerType}/authorize?email_domain=${encodeURIComponent(domain)}&login_hint=${encodeURIComponent(email)}`;
  };

  const goBack = () => {
    setStep("email");
    setPassword("");
    setError("");
    setProviders([]);
  };

  const hasPassword = providers.includes("password");
  const ssoProviders = providers.filter((p) => p !== "password" && SSO_LABELS[p]);

  return (
    <div className="login-container">
      <div className="login-orb login-orb-1" aria-hidden="true" />
      <div className="login-orb login-orb-2" aria-hidden="true" />
      <div className="login-orb login-orb-3" aria-hidden="true" />

      <a href="/" className="login-back-link"><ArrowLeft size={16} /> Back to home</a>
      <div className={`login-card${shaking ? " shake" : ""}`}>
        <div className="login-brand">
          <div className="login-icon">
            <img src="/labaid-icon.svg" alt="" style={{ width: 100, height: 100 }} />
          </div>
          <div>
            <h1>LabAid</h1>
            <p className="subtitle">Laboratory Inventory Management</p>
          </div>
        </div>

        {step === "email" && (
          <form onSubmit={handleDiscover}>
            <div className="form-group">
              <label htmlFor="login-email">Email</label>
              <input
                id="login-email"
                type="email"
                placeholder="you@lab.edu"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            {error && <p className="error login-error">{error}</p>}
            <button type="submit" className="login-submit" disabled={loading}>
              {loading ? "Checking..." : "Continue"}
            </button>
          </form>
        )}

        {step === "auth" && (
          <>
            <button type="button" className="login-back-step" onClick={goBack}>
              <ArrowLeft size={14} /> {email}
            </button>

            {hasPassword && (
              <form onSubmit={handleLogin}>
                <div className="form-group">
                  <label htmlFor="login-password">Password</label>
                  <input
                    id="login-password"
                    type="password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoFocus
                  />
                  <Link to="/forgot-password" className="forgot-password-link">Forgot password?</Link>
                </div>
                {error && <p className="error login-error">{error}</p>}
                <button type="submit" className="login-submit" disabled={loading}>
                  {loading ? "Signing in..." : "Sign In"}
                </button>
              </form>
            )}

            {hasPassword && ssoProviders.length > 0 && (
              <div className="login-divider"><span>or</span></div>
            )}

            {ssoProviders.map((p) => (
              <button
                key={p}
                type="button"
                className="login-sso-btn"
                onClick={() => handleSSO(p)}
              >
                {SSO_LABELS[p]}
              </button>
            ))}

            {!hasPassword && !ssoProviders.length && (
              <p className="error login-error">No login methods available for this account.</p>
            )}

            {!hasPassword && error && (
              <p className="error login-error">{error}</p>
            )}
          </>
        )}

        <p className="login-footer">
          Laboratory inventory management &middot; <button type="button" className="link-button" onClick={() => setShowTerms(true)}>Terms of Use</button>
        </p>
        <p className="login-version">
          v{version}
          {import.meta.env.VITE_APP_ENV && import.meta.env.VITE_APP_ENV !== "production" && (
            <> {import.meta.env.VITE_APP_ENV}</>
          )}
          {import.meta.env.VITE_GIT_SHA && (
            <> &middot; {import.meta.env.VITE_GIT_SHA.slice(0, 7)}</>
          )}
        </p>
      </div>
      {showTerms && (
        <Suspense fallback={null}>
          <TermsModal onClose={() => setShowTerms(false)} />
        </Suspense>
      )}
    </div>
  );
}
