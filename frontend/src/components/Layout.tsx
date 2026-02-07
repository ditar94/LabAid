import { useState, useMemo } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  LayoutDashboard,
  ScanLine,
  Package,
  PackagePlus,
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
} from "lucide-react";

export default function Layout() {
  const { user, logout, impersonatingLab, endImpersonation } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
              <NavLink to="/receive" onClick={handleNavClick}>
                <PackagePlus className="nav-icon" />
                Receive Inventory
              </NavLink>
              <NavLink to="/storage" onClick={handleNavClick}>
                <Warehouse className="nav-icon" />
                Storage
              </NavLink>
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
        <button className="logout-btn" onClick={handleLogout}>
          <LogOut size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
          Sign Out
        </button>
        <div className="sidebar-copyright">
          <div>&copy; {new Date().getFullYear()} LabAid</div>
          <div>v1.0 Beta</div>
        </div>
      </nav>
      <main className="main-content">
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
            <NavLink to="/storage" className={({ isActive }) => `bottom-nav-item${isActive ? " active" : ""}`}>
              <Warehouse className="nav-icon" />
              <span>Storage</span>
            </NavLink>
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
