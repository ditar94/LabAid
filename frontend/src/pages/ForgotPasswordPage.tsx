import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";
import { KeyRound } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api.post("/auth/forgot-password", { email });
      setSubmitted(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-orb login-orb-1" aria-hidden="true" />
      <div className="login-orb login-orb-2" aria-hidden="true" />
      <div className="login-orb login-orb-3" aria-hidden="true" />

      <div className="login-card">
        <div className="login-brand">
          <div className="login-icon">
            <KeyRound size={26} />
          </div>
          <div>
            <h1>Reset Password</h1>
            <p className="subtitle">Enter your email to receive a reset link</p>
          </div>
        </div>

        {submitted ? (
          <div style={{ textAlign: "center", padding: "8px 0 16px" }}>
            <p style={{ marginBottom: 16 }}>Check your email for a reset link.</p>
            <Link to="/login" className="login-submit" style={{ display: "block", textAlign: "center", textDecoration: "none" }}>
              Back to Sign In
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="forgot-email">Email</label>
              <input
                id="forgot-email"
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
              {loading ? "Sending..." : "Send Reset Link"}
            </button>
            <p className="login-footer">
              <Link to="/login">Back to Sign In</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
