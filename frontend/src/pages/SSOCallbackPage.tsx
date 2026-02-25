import { useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const ERROR_MESSAGES: Record<string, string> = {
  token_exchange_failed: "Authentication failed. Please try again.",
  no_id_token: "Authentication failed. Please try again.",
  token_validation_failed: "Could not verify your identity. Please try again.",
  missing_claims: "Your identity provider did not return required information.",
  user_not_found: "No account found for your email. Ask your lab admin to create your account first.",
  user_inactive: "Your account has been deactivated. Contact your lab admin.",
  lab_inactive: "Your lab is currently suspended. Contact support.",
};

export default function SSOCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const error = params.get("error");

  useEffect(() => {
    if (!error) {
      sessionStorage.removeItem("sso_email");
      refreshUser().then(() => navigate("/", { replace: true }));
    }
  }, [error, refreshUser, navigate]);

  if (error) {
    return (
      <div className="page-shell" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ maxWidth: 400, textAlign: "center" }}>
          <h2>Sign-in failed</h2>
          <p className="text-muted">{ERROR_MESSAGES[error] || "An unexpected error occurred."}</p>
          <a href="/login" className="btn-primary" style={{ display: "inline-block", marginTop: 16 }}>
            Back to login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p className="text-muted">Signing in...</p>
    </div>
  );
}
