import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Layout from "./components/Layout";
import LoginPage from "./pages/LoginPage";
import SetupPage from "./pages/SetupPage";
import ChangePasswordPage from "./pages/ChangePasswordPage";
import DashboardPage from "./pages/DashboardPage";
import InventoryPage from "./pages/InventoryPage";
import AntibodiesPage from "./pages/AntibodiesPage";
import LotsPage from "./pages/LotsPage";
import ReceivePage from "./pages/ReceivePage";
import ScanSearchPage from "./pages/ScanSearchPage";
import StoragePage from "./pages/StoragePage";
import AuditPage from "./pages/AuditPage";
import UsersPage from "./pages/UsersPage";
import LabsPage from "./pages/LabsPage";
import FluorochromesPage from "./pages/FluorochromesPage";
import TicketsPage from "./pages/TicketsPage";
import type { ReactNode } from "react";
import "./App.css";

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="loading">Loading...</div>;
  if (!user) return <Navigate to="/login" />;
  if (user.must_change_password && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" />;
  }
  return <>{children}</>;
}
function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route
        path="/change-password"
        element={
          <ProtectedRoute>
            <ChangePasswordPage />
          </ProtectedRoute>
        }
      />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/antibodies" element={<AntibodiesPage />} />
        <Route path="/lots" element={<LotsPage />} />
        <Route path="/receive" element={<ReceivePage />} />
        <Route path="/scan" element={<Navigate to="/scan-search" replace />} />
        <Route path="/search" element={<Navigate to="/scan-search" replace />} />
        <Route path="/scan-search" element={<ScanSearchPage />} />
        <Route path="/storage" element={<StoragePage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/labs" element={<LabsPage />} />
        <Route path="/fluorochromes" element={<FluorochromesPage />} />
        <Route path="/tickets" element={<TicketsPage />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
