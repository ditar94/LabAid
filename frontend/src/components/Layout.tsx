import { useState, useMemo, useEffect } from "react";
import { Outlet, NavLink, Link, useNavigate } from "react-router-dom";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import {
  LayoutDashboard,
  ScanLine,
  Package,
  Warehouse,
  ClipboardList,
  Users,
  Building2,
  LifeBuoy,
  Palette,
  Search,
  LogOut,
  Menu,
  X,
  ShieldOff,
  Sun,
  Moon,
  Monitor,
  Info,
  AlertTriangle,
  XCircle,
} from "lucide-react";
import { useTheme } from "../hooks/useTheme";

export default function Layout() {
  const { user, logout, impersonatingLab, endImpersonation, labSettings } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { theme, cycleTheme } = useTheme();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const handleNavClick = () => {
    setSidebarOpen(false);
  };

  const handleExitImpersonation = async () => {
    await endImpersonation();
    navigate("/");
  };

  const isSuperAdmin = user?.role === "super_admin";
  const isImpersonating = isSuperAdmin && !!impersonatingLab;
  // When super_admin is impersonating, treat them like a lab_admin for nav purposes
  const isAdmin = isSuperAdmin || user?.role === "lab_admin";
  const isSupervisor = isAdmin || user?.role === "supervisor";
  // Lab-specific pages should only show if user has a lab context
  const hasLabContext = !isSuperAdmin || isImpersonating;
  const storageEnabled = labSettings.storage_enabled !== false;

  const accountBanner = useMemo(() => {
    if (!hasLabContext) return null;
    const billing = labSettings.billing_status;
    const active = labSettings.is_active;
    const billingUrl = labSettings.billing_url;
    if (active === false) {
      return { variant: "suspended", icon: XCircle, message: "Your lab is suspended. You have read-only access." };
    }
    if (billing === "cancelled") {
      return {
        variant: "cancelled",
        icon: XCircle,
        message: "Your account has been cancelled.",
        action: billingUrl ? { text: "Reactivate", url: billingUrl } : undefined,
      };
    }
    if (billing === "past_due") {
      return {
        variant: "past-due",
        icon: AlertTriangle,
        message: "Your payment is past due. Update your payment method to avoid interruption.",
        action: billingUrl ? { text: "Update payment", url: billingUrl } : undefined,
      };
    }
    if (billing === "trial") {
      let trialMsg = "Your lab is on a free trial.";
      if (labSettings.trial_ends_at) {
        const now = new Date();
        const ends = new Date(labSettings.trial_ends_at);
        const diffMs = ends.getTime() - now.getTime();
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        if (diffDays <= 0) {
          trialMsg = "Your free trial has expired.";
        } else if (diffDays === 1) {
          trialMsg = "Your free trial ends tomorrow.";
        } else {
          trialMsg = `Your free trial ends in ${diffDays} days.`;
        }
      }
      return { variant: "trial", icon: Info, message: trialMsg };
    }
    return null;
  }, [hasLabContext, labSettings.billing_status, labSettings.is_active, labSettings.trial_ends_at, labSettings.billing_url]);

  const [pendingRequestCount, setPendingRequestCount] = useState(0);

  useEffect(() => {
    if (!isSupervisor || !hasLabContext) {
      setPendingRequestCount(0);
      return;
    }
    const fetchCount = () => {
      api.get<{ count: number }>("/lot-requests/pending-count")
        .then((res) => setPendingRequestCount(res.data.count))
        .catch(() => {});
    };
    fetchCount();
    const interval = setInterval(fetchCount, 30_000);
    return () => clearInterval(interval);
  }, [isSupervisor, hasLabContext]);

  const initials = useMemo(() => {
    if (!user?.full_name) return "?";
    return user.full_name
      .split(" ")
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }, [user?.full_name]);

  return (
    <div className="app-layout">
      {!sidebarOpen && (
        <button
          className="hamburger-btn"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
      )}
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}
      <nav className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-header">
          <div className="sidebar-header-row">
            <h2>LabAid</h2>
            <button
              className="sidebar-close-btn"
              onClick={() => setSidebarOpen(false)}
              aria-label="Close menu"
            >
              <X size={18} />
            </button>
          </div>
          <div className="user-info">
            <div className="user-avatar" aria-hidden="true">{initials}</div>
            <div>
              <span className="user-name">{user?.full_name}</span>
              <span className="user-role">{user?.role.replaceAll("_", " ")}</span>
            </div>
          </div>
        </div>
        {isImpersonating && (
          <div className="impersonation-banner">
            <div className="impersonation-banner-info">
              <ShieldOff size={14} />
              <span className="impersonation-lab-name">{impersonatingLab.name}</span>
              <span className="impersonation-badge">Support Mode</span>
            </div>
            <button className="impersonation-exit-btn" onClick={handleExitImpersonation}>
              Exit
            </button>
          </div>
        )}
        <div className="nav-links">
          <NavLink to="/" onClick={handleNavClick}>
            <LayoutDashboard className="nav-icon" />
            Dashboard
            {pendingRequestCount > 0 && <span className="nav-badge">{pendingRequestCount}</span>}
          </NavLink>
          {hasLabContext && (
            <>
              <NavLink to="/scan-search" onClick={handleNavClick}>
                <ScanLine className="nav-icon" />
                Scan / Search
              </NavLink>
              <NavLink to="/inventory" onClick={handleNavClick}>
                <Package className="nav-icon" />
                Inventory
              </NavLink>
              {storageEnabled && (
                <NavLink to="/storage" onClick={handleNavClick}>
                  <Warehouse className="nav-icon" />
                  Storage
                </NavLink>
              )}
            </>
          )}

          <div className="nav-section-label">Review</div>
          <NavLink to="/audit" onClick={handleNavClick}>
            <ClipboardList className="nav-icon" />
            Audit Log
          </NavLink>

          {(isSupervisor || isSuperAdmin) && (
            <>
              <div className="nav-section-label">Admin</div>
              {isSupervisor && (
                <NavLink to="/users" onClick={handleNavClick}>
                  <Users className="nav-icon" />
                  Users
                </NavLink>
              )}
              {isSuperAdmin && (
                <NavLink to="/labs" onClick={handleNavClick}>
                  <Building2 className="nav-icon" />
                  Labs
                </NavLink>
              )}
              {isSuperAdmin && (
                <NavLink to="/global-search" onClick={handleNavClick}>
                  <Search className="nav-icon" />
                  Global Search
                </NavLink>
              )}
              {isSupervisor && (
                <NavLink to="/tickets" onClick={handleNavClick}>
                  <LifeBuoy className="nav-icon" />
                  Support
                </NavLink>
              )}
              {hasLabContext && isAdmin && (
                <NavLink to="/fluorochromes" onClick={handleNavClick}>
                  <Palette className="nav-icon" />
                  Fluorochromes
                </NavLink>
              )}
            </>
          )}
        </div>
        <button className="theme-toggle-btn" onClick={cycleTheme} title={`Theme: ${theme}`}>
          {theme === "light" && <Sun size={14} style={{ marginRight: 6, verticalAlign: -2 }} />}
          {theme === "dark" && <Moon size={14} style={{ marginRight: 6, verticalAlign: -2 }} />}
          {theme === "system" && <Monitor size={14} style={{ marginRight: 6, verticalAlign: -2 }} />}
          {theme === "system" ? "System" : theme === "light" ? "Light" : "Dark"}
        </button>
        <button className="logout-btn" onClick={handleLogout}>
          <LogOut size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
          Sign Out
        </button>
        <div className="sidebar-copyright">
          <div>&copy; {new Date().getFullYear()} LabAid</div>
          <div>v1.0 Beta</div>
          <Link to="/terms">Terms of Use</Link>
        </div>
      </nav>
      <main className="main-content">
        {accountBanner && (
          <div className={`account-banner account-banner--${accountBanner.variant}`} role="status">
            <accountBanner.icon size={16} />
            <span>{accountBanner.message}</span>
            {accountBanner.action && (
              <a
                href={accountBanner.action.url}
                target="_blank"
                rel="noopener noreferrer"
                className="account-banner-link"
              >
                {accountBanner.action.text}
              </a>
            )}
          </div>
        )}
        <Outlet />
      </main>
      <nav className="bottom-nav">
        <NavLink to="/" end className={({ isActive }) => `bottom-nav-item${isActive ? " active" : ""}`}>
          <LayoutDashboard className="nav-icon" />
          <span>Dashboard</span>
        </NavLink>
        {hasLabContext ? (
          <>
            <NavLink to="/scan-search" className={({ isActive }) => `bottom-nav-item${isActive ? " active" : ""}`}>
              <ScanLine className="nav-icon" />
              <span>Scan</span>
            </NavLink>
            <NavLink to="/inventory" className={({ isActive }) => `bottom-nav-item${isActive ? " active" : ""}`}>
              <Package className="nav-icon" />
              <span>Inventory</span>
            </NavLink>
            {storageEnabled && (
              <NavLink to="/storage" className={({ isActive }) => `bottom-nav-item${isActive ? " active" : ""}`}>
                <Warehouse className="nav-icon" />
                <span>Storage</span>
              </NavLink>
            )}
          </>
        ) : (
          <>
            <NavLink to="/labs" className={({ isActive }) => `bottom-nav-item${isActive ? " active" : ""}`}>
              <Building2 className="nav-icon" />
              <span>Labs</span>
            </NavLink>
            <NavLink to="/global-search" className={({ isActive }) => `bottom-nav-item${isActive ? " active" : ""}`}>
              <Search className="nav-icon" />
              <span>Search</span>
            </NavLink>
            <NavLink to="/tickets" className={({ isActive }) => `bottom-nav-item${isActive ? " active" : ""}`}>
              <LifeBuoy className="nav-icon" />
              <span>Support</span>
            </NavLink>
          </>
        )}
        <NavLink to="/audit" className={({ isActive }) => `bottom-nav-item${isActive ? " active" : ""}`}>
          <ClipboardList className="nav-icon" />
          <span>Audit</span>
        </NavLink>
      </nav>
    </div>
  );
}
