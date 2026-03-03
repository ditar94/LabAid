import { useState, useMemo, useCallback, useRef, useEffect, lazy, Suspense } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import RouteErrorBoundary from "./RouteErrorBoundary";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { Antibody, Lot, User } from "../api/types";
import { useAuth } from "../context/AuthContext";
import { useSharedData } from "../context/SharedDataContext";
import {
  LayoutDashboard,
  ScanLine,
  Package,
  Warehouse,
  FlaskConical,
  ClipboardList,
  FileSpreadsheet,
  Users,
  Building2,
  LifeBuoy,
  Settings,
  Palette,
  Search,
  KeyRound,
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
  ChevronUp,
  ChevronDown,
  MoreHorizontal,
  Play,
  CreditCard,
  BarChart3,
} from "lucide-react";
import { useTheme } from "../hooks/useTheme";
import { version } from "../../package.json";

const TermsModal = lazy(() => import("./TermsModal"));
const PaymentChoiceModal = lazy(() => import("./PaymentChoiceModal"));
const CURRENT_YEAR = new Date().getFullYear();

export default function Layout() {
  const { user, logout, impersonatingLab, endImpersonation, labSettings, labName } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const navLinksRef = useRef<HTMLDivElement>(null);
  const { theme, cycleTheme } = useTheme();

  // Lock page scroll when mobile sidebar is open
  useEffect(() => {
    if (sidebarOpen) {
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
      return () => {
        document.documentElement.style.overflow = "";
        document.body.style.overflow = "";
      };
    }
  }, [sidebarOpen]);

  // Check if nav links overflow and can scroll in either direction
  useEffect(() => {
    const el = navLinksRef.current;
    if (!el) return;
    const checkScroll = () => {
      const hasOverflow = el.scrollHeight > el.clientHeight;
      setCanScrollUp(hasOverflow && el.scrollTop > 10);
      setCanScrollDown(hasOverflow && el.scrollTop + el.clientHeight < el.scrollHeight - 10);
    };
    checkScroll();
    el.addEventListener("scroll", checkScroll);
    window.addEventListener("resize", checkScroll);
    return () => {
      el.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
    };
  }, [sidebarOpen]);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const handleNavClick = () => {
    setSidebarOpen(false);
  };

  const handleExitImpersonation = async () => {
    await endImpersonation();
    navigate("/dashboard");
  };

  const isSuperAdmin = user?.role === "super_admin";
  const isImpersonating = isSuperAdmin && !!impersonatingLab;
  // When super_admin is impersonating, treat them like a lab_admin for nav purposes
  const isAdmin = isSuperAdmin || user?.role === "lab_admin";
  const isSupervisor = isAdmin || user?.role === "supervisor";
  // Lab-specific pages should only show if user has a lab context
  const hasLabContext = !isSuperAdmin || isImpersonating;
  const storageEnabled = labSettings.storage_enabled !== false;
  const cocktailsEnabled = labSettings.cocktails_enabled === true;

  const accountBanner = useMemo(() => {
    if (!hasLabContext) return null;
    if (labSettings.is_demo) {
      return { variant: "trial", icon: Info, message: "This is a demo lab. Explore freely \u2014 all data resets automatically." };
    }
    const billing = labSettings.billing_status;
    const active = labSettings.is_active;
    if (active === false) {
      return { variant: "suspended", icon: XCircle, message: "Your lab is suspended. You have read-only access." };
    }
    if (billing === "cancelled") {
      const reason = labSettings.cancellation_reason;
      const reasonMessages: Record<string, string> = {
        payment_failed: "Your account was cancelled due to a failed payment.",
        customer_requested: "Your account was cancelled at your request.",
        invoice_uncollectible: "Your account was cancelled due to an unpaid invoice.",
        admin_manual: "Your account was cancelled by an administrator.",
      };
      return {
        variant: "cancelled",
        icon: XCircle,
        message: (reason && reasonMessages[reason]) || "Your account has been cancelled.",
        action: isAdmin ? { text: "Reactivate", type: "checkout" as const } : undefined,
      };
    }
    if (billing === "past_due") {
      return {
        variant: "past-due",
        icon: AlertTriangle,
        message: "Your payment is past due. Update your payment method to avoid interruption.",
        action: isAdmin ? { text: "Update payment", type: "portal" as const } : undefined,
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
      return {
        variant: "trial",
        icon: Info,
        message: trialMsg,
        action: isAdmin ? { text: "Subscribe", type: "checkout" as const } : undefined,
      };
    }
    return null;
  }, [hasLabContext, labSettings.is_demo, labSettings.billing_status, labSettings.is_active, labSettings.trial_ends_at, isAdmin]);

  const { selectedLab } = useSharedData();
  const queryClient = useQueryClient();
  const { data: pendingRequestCount = 0 } = useQuery<number>({
    queryKey: ["lot-requests-count", selectedLab],
    queryFn: () => api.get<{ count: number }>("/lot-requests/pending-count").then((r) => r.data.count),
    enabled: isSupervisor && hasLabContext,
    refetchInterval: 30_000,
  });

  // Prefetch primary data for a page on nav hover
  const prefetch = useCallback((queries: Array<{ queryKey: unknown[]; queryFn: () => Promise<unknown> }>) => {
    for (const q of queries) {
      queryClient.prefetchQuery({ queryKey: q.queryKey, queryFn: q.queryFn, staleTime: 30_000 });
    }
  }, [queryClient]);
  const prefetchDashboard = useCallback(() => {
    prefetch([
      { queryKey: ["antibodies", selectedLab], queryFn: () => api.get<Antibody[]>("/antibodies/", { params: { lab_id: selectedLab } }).then((r) => r.data) },
      { queryKey: ["lots", selectedLab], queryFn: () => api.get<Lot[]>("/lots/", { params: { lab_id: selectedLab } }).then((r) => r.data) },
    ]);
  }, [prefetch, selectedLab]);
  const prefetchUsers = useCallback(() => {
    prefetch([{ queryKey: ["users", selectedLab], queryFn: () => api.get<User[]>("/auth/users").then((r) => r.data) }]);
  }, [prefetch, selectedLab]);

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
              {!isSuperAdmin && labName && (
                <span className="user-lab-name">{labName}</span>
              )}
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
        <div className="nav-links" ref={navLinksRef}>
          <NavLink to="/dashboard" onClick={handleNavClick} onMouseEnter={prefetchDashboard}>
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
              <NavLink to="/inventory" onClick={handleNavClick} onMouseEnter={prefetchDashboard}>
                <Package className="nav-icon" />
                Inventory
              </NavLink>
              {storageEnabled && (
                <NavLink to="/storage" onClick={handleNavClick}>
                  <Warehouse className="nav-icon" />
                  Storage
                </NavLink>
              )}
              {cocktailsEnabled && (
                <NavLink to="/cocktails" onClick={handleNavClick}>
                  <FlaskConical className="nav-icon" />
                  Cocktails
                </NavLink>
              )}
            </>
          )}

          <div className="nav-section-label">Review</div>
          <NavLink to="/audit" onClick={handleNavClick}>
            <ClipboardList className="nav-icon" />
            Audit Log
          </NavLink>
          {hasLabContext && (
            <NavLink to="/reports" onClick={handleNavClick}>
              <FileSpreadsheet className="nav-icon" />
              Reports
            </NavLink>
          )}

          {(isSupervisor || isSuperAdmin) && (
            <>
              <div className="nav-section-label">Admin</div>
              {isSupervisor && (
                <NavLink to="/users" onClick={handleNavClick} onMouseEnter={prefetchUsers}>
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
                <NavLink to="/demos" onClick={handleNavClick}>
                  <Play className="nav-icon" />
                  Demos
                </NavLink>
              )}
              {isSuperAdmin && (
                <NavLink to="/global-search" onClick={handleNavClick}>
                  <Search className="nav-icon" />
                  Global Search
                </NavLink>
              )}
              {isSuperAdmin && (
                <NavLink to="/analytics" onClick={handleNavClick}>
                  <BarChart3 className="nav-icon" />
                  Analytics
                </NavLink>
              )}
              {isSupervisor && (
                <NavLink to="/tickets" onClick={handleNavClick}>
                  <LifeBuoy className="nav-icon" />
                  Support
                </NavLink>
              )}
              {hasLabContext && isSupervisor && (
                <NavLink to="/fluorochromes" onClick={handleNavClick}>
                  <Palette className="nav-icon" />
                  Fluorochromes
                </NavLink>
              )}
              {hasLabContext && isAdmin && !labSettings.is_demo && (
                <NavLink to="/billing" onClick={handleNavClick}>
                  <CreditCard className="nav-icon" />
                  {labSettings.billing_status === "active" ? "Billing" : "Subscribe"}
                </NavLink>
              )}
              {hasLabContext && isAdmin && (
                <NavLink to="/settings" onClick={handleNavClick}>
                  <Settings className="nav-icon" />
                  Settings
                </NavLink>
              )}
            </>
          )}
          {canScrollUp && (
            <div className="nav-scroll-indicator nav-scroll-indicator--top">
              <ChevronUp size={14} />
            </div>
          )}
          {canScrollDown && (
            <div className="nav-scroll-indicator nav-scroll-indicator--bottom">
              <ChevronDown size={14} />
            </div>
          )}
        </div>
        <div className="sidebar-account-bar">
          <button
            className="account-bar-btn"
            onClick={cycleTheme}
            title={`Theme: ${theme}`}
            aria-label={`Theme: ${theme}`}
          >
            {theme === "light" && <Sun size={20} />}
            {theme === "dark" && <Moon size={20} />}
            {theme === "system" && <Monitor size={20} />}
          </button>
          <div className="account-bar-menu">
            <button
              className="account-bar-btn"
              onClick={() => setAccountMenuOpen(!accountMenuOpen)}
              aria-expanded={accountMenuOpen}
              aria-haspopup="true"
              title="More options"
              aria-label="More options"
            >
              <MoreHorizontal size={20} />
            </button>
            {accountMenuOpen && (
              <>
                <div className="account-bar-menu-backdrop" onClick={() => setAccountMenuOpen(false)} />
                <div className="account-bar-menu-dropdown">
                  <button onClick={() => { setAccountMenuOpen(false); handleNavClick(); navigate("/change-password"); }}>
                    <KeyRound size={16} />
                    Change Password
                  </button>
                </div>
              </>
            )}
          </div>
          <button
            className="account-bar-btn account-bar-btn--logout"
            onClick={handleLogout}
            title="Sign Out"
            aria-label="Sign Out"
          >
            <LogOut size={20} />
          </button>
        </div>
        <div className="sidebar-copyright">
          <div>&copy; {CURRENT_YEAR} LabAid</div>
          <div>
            v{version}
            {import.meta.env.VITE_APP_ENV && import.meta.env.VITE_APP_ENV !== "production" && (
              <> {import.meta.env.VITE_APP_ENV}</>
            )}
            {import.meta.env.VITE_GIT_SHA && (
              <> &middot; {import.meta.env.VITE_GIT_SHA.slice(0, 7)}</>
            )}
          </div>
          <button type="button" className="link-button" onClick={() => setShowTerms(true)}>Terms of Use</button>
        </div>
      </nav>
      <main className="main-content">
        {accountBanner && (
          <div className={`account-banner account-banner--${accountBanner.variant}`} role="status">
            <accountBanner.icon size={16} />
            <span>{accountBanner.message}</span>
            {accountBanner.action && (
              <button
                className="account-banner-link"
                onClick={() => accountBanner.action!.type === "checkout" ? setShowPaymentModal(true) : navigate("/billing")}
              >
                {accountBanner.action.text}
              </button>
            )}
          </div>
        )}
        {labSettings.is_demo && (
          <div className="account-banner account-banner--demo-cta">
            <span>Seen enough? Start your lab's 7-day free trial today!</span>
            <button
              className="account-banner-cta"
              onClick={async () => { await logout(); window.location.href = "/signup"; }}
            >
              Start Free Trial
            </button>
          </div>
        )}
        <RouteErrorBoundary>
          <Outlet />
        </RouteErrorBoundary>
      </main>
      {showTerms && (
        <Suspense fallback={null}>
          <TermsModal onClose={() => setShowTerms(false)} />
        </Suspense>
      )}
      {showPaymentModal && (
        <Suspense fallback={null}>
          <PaymentChoiceModal onClose={() => setShowPaymentModal(false)} />
        </Suspense>
      )}
    </div>
  );
}
