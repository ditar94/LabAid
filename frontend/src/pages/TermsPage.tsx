import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import TermsContent from "../components/TermsContent";

export default function TermsPage() {
  const { user } = useAuth();

  return (
    <div className="login-container">
      <div className="login-orb login-orb-1" aria-hidden="true" />
      <div className="login-orb login-orb-2" aria-hidden="true" />
      <div className="login-orb login-orb-3" aria-hidden="true" />

      <div className="login-card login-card--terms">
        <Link to={user ? "/" : "/login"} className="terms-back-link">
          <ArrowLeft size={16} />
          {user ? "Back" : "Back to Login"}
        </Link>

        <h1>Terms of Use</h1>
        <p className="terms-effective">Effective Date: February 8, 2026</p>

        <div className="terms-content">
          <TermsContent />
        </div>
      </div>
    </div>
  );
}
