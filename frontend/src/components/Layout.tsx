import { useState } from "react";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

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

  return (
    <div className="app-layout">
      <button
        className="hamburger-btn"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-label="Toggle menu"
      >
        {sidebarOpen ? "\u2715" : "\u2630"}
      </button>
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}
      <nav className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-header">
          <h2>LabAid</h2>
          <span className="user-name">{user?.full_name}</span>
          <span className="user-role">{user?.role.replaceAll("_", " ")}</span>
        </div>
        <div className="nav-links">
          <NavLink to="/" onClick={handleNavClick}>Dashboard</NavLink>
          <NavLink to="/scan-search" onClick={handleNavClick}>Scan / Search</NavLink>
          <NavLink to="/inventory" onClick={handleNavClick}>Inventory</NavLink>
          <NavLink to="/receive" onClick={handleNavClick}>Receive Inventory</NavLink>
          <NavLink to="/storage" onClick={handleNavClick}>Storage</NavLink>
          <NavLink to="/audit" onClick={handleNavClick}>Audit Log</NavLink>
          {(user?.role === "super_admin" || user?.role === "lab_admin" || user?.role === "supervisor") && (
            <NavLink to="/users" onClick={handleNavClick}>Users</NavLink>
          )}
          {user?.role === "super_admin" && (
            <NavLink to="/labs" onClick={handleNavClick}>Labs</NavLink>
          )}
          {(user?.role === "super_admin" || user?.role === "lab_admin" || user?.role === "supervisor") && (
            <NavLink to="/tickets" onClick={handleNavClick}>Support</NavLink>
          )}
          {(user?.role === "super_admin" || user?.role === "lab_admin") && (
            <NavLink to="/fluorochromes" onClick={handleNavClick}>Fluorochromes</NavLink>
          )}
        </div>
        <button className="logout-btn" onClick={handleLogout}>
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
