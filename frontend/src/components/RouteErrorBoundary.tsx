import { Component, type ReactNode } from "react";
import { Link } from "react-router-dom";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export default class RouteErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error("Route error:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "var(--space-xl)", textAlign: "center" }}>
          <h2>Something went wrong</h2>
          <p className="page-desc">An unexpected error occurred on this page.</p>
          <Link to="/dashboard" className="btn-chip btn-chip-primary" onClick={() => this.setState({ hasError: false })}>
            Go to Dashboard
          </Link>
        </div>
      );
    }
    return this.props.children;
  }
}
