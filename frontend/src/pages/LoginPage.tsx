import { useState, type FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { Navigate, useNavigate, Link } from "react-router-dom";
import { FlaskConical } from "lucide-react";
import { version } from "../../package.json";
import { preloadAppChunks } from "../App";

export default function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();

  // Already authenticated (e.g. page refresh while logged in) — go to dashboard
  if (user) return <Navigate to="/" replace />;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [shaking, setShaking] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      preloadAppChunks();
      navigate("/");
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

  return (
    <div className="login-container">
      <div className="login-orb login-orb-1" aria-hidden="true" />
      <div className="login-orb login-orb-2" aria-hidden="true" />
      <div className="login-orb login-orb-3" aria-hidden="true" />

      <div className={`login-card${shaking ? " shake" : ""}`}>
        <div className="login-brand">
          <div className="login-icon">
            <FlaskConical size={26} />
          </div>
          <div>
            <h1>LabAid</h1>
            <p className="subtitle">Laboratory Inventory Management</p>
          </div>
        </div>
        <form onSubmit={handleSubmit}>
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
          <div className="form-group">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <Link to="/forgot-password" className="forgot-password-link">Forgot password?</Link>
          </div>
          {error && <p className="error login-error">{error}</p>}
          <button type="submit" className="login-submit" disabled={loading}>
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
        <p className="login-footer">
          Laboratory inventory management &middot; <Link to="/terms">Terms of Use</Link>
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
    </div>
  );
}
