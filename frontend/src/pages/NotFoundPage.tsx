import { Link } from "react-router-dom";
import { FileQuestion } from "lucide-react";
import EmptyState from "../components/EmptyState";

export default function NotFoundPage() {
  return (
    <div className="login-container" style={{ minHeight: "100dvh" }}>
      <EmptyState
        icon={FileQuestion}
        title="Page not found"
        description="The page you're looking for doesn't exist or has been moved."
      />
      <Link to="/dashboard" className="btn-chip btn-chip-primary" style={{ marginTop: 16 }}>
        Go to Dashboard
      </Link>
    </div>
  );
}
