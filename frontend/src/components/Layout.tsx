import { useState } from "react";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
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
  LogOut,
} from "lucide-react";

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const handleNavClick = () => {
    setSidebarOpen(false);
  };

  const isAdmin = user?.role === "super_admin" || user?.role === "lab_admin";
  const isSupervisor = isAdmin || user?.role === "supervisor";

  return (
    <div className="app-layout">
      {!sidebarOpen && (
        <button
          className="hamburger-btn"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open menu"
        >
          ☰
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
              ✕
            </button>
          </div>
          <span className="user-name">{user?.full_name}</span>
          <span className="user-role">{user?.role.replaceAll("_", " ")}</span>
        </div>
        <div className="nav-links">
          <NavLink to="/" onClick={handleNavClick}>
            <LayoutDashboard className="nav-icon" />
            Dashboard
          </NavLink>
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

          <div className="nav-section-label">Review</div>
          <NavLink to="/audit" onClick={handleNavClick}>
            <ClipboardList className="nav-icon" />
            Audit Log
          </NavLink>

          {(isSupervisor || user?.role === "super_admin") && (
            <>
              <div className="nav-section-label">Admin</div>
              {isSupervisor && (
                <NavLink to="/users" onClick={handleNavClick}>
                  <Users className="nav-icon" />
                  Users
                </NavLink>
              )}
              {user?.role === "super_admin" && (
                <NavLink to="/labs" onClick={handleNavClick}>
                  <Building2 className="nav-icon" />
                  Labs
                </NavLink>
              )}
              {isSupervisor && (
                <NavLink to="/tickets" onClick={handleNavClick}>
                  <LifeBuoy className="nav-icon" />
                  Support
                </NavLink>
              )}
              {isAdmin && (
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
    </div>
  );
}
