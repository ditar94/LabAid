import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="app-layout">
      <nav className="sidebar">
        <div className="sidebar-header">
          <h2>LabAid</h2>
          <span className="user-name">{user?.full_name}</span>
          <span className="user-role">{user?.role.replaceAll("_", " ")}</span>
        </div>
        <div className="nav-links">
          <NavLink to="/">Dashboard</NavLink>
          <NavLink to="/search">Search</NavLink>
          <NavLink to="/scan">Scan</NavLink>
          <NavLink to="/antibodies">Antibodies</NavLink>
          <NavLink to="/lots">Lots</NavLink>
          <NavLink to="/receive">Receive Inventory</NavLink>
          <NavLink to="/storage">Storage</NavLink>
          <NavLink to="/audit">Audit Log</NavLink>
          {(user?.role === "super_admin" || user?.role === "lab_admin" || user?.role === "supervisor") && (
            <NavLink to="/users">Users</NavLink>
          )}
          {user?.role === "super_admin" && (
            <NavLink to="/labs">Labs</NavLink>
          )}
          {(user?.role === "super_admin" || user?.role === "lab_admin") && (
            <NavLink to="/fluorochromes">Fluorochromes</NavLink>
          )}
        </div>
        <button className="logout-btn" onClick={handleLogout}>
          Sign Out
        </button>
      </nav>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
