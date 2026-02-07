import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { SharedDataProvider } from "./context/SharedDataContext";
import { ToastProvider } from "./context/ToastContext";
import Layout from "./components/Layout";
import { lazy, Suspense, type ReactNode } from "react";
import "./App.css";

// Lazy-loaded pages — each becomes a separate chunk
const LoginPage = lazy(() => import("./pages/LoginPage"));
const SetupPage = lazy(() => import("./pages/SetupPage"));
const ChangePasswordPage = lazy(() => import("./pages/ChangePasswordPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const InventoryPage = lazy(() => import("./pages/InventoryPage"));
const ScanSearchPage = lazy(() => import("./pages/ScanSearchPage"));
const StoragePage = lazy(() => import("./pages/StoragePage"));
const AuditPage = lazy(() => import("./pages/AuditPage"));
const UsersPage = lazy(() => import("./pages/UsersPage"));
const LabsPage = lazy(() => import("./pages/LabsPage"));
const FluorochromesPage = lazy(() => import("./pages/FluorochromesPage"));
const TicketsPage = lazy(() => import("./pages/TicketsPage"));
const GlobalSearchPage = lazy(() => import("./pages/GlobalSearchPage"));

function PageLoader() {
  return <div className="loading">Loading...</div>;
}

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
    <Suspense fallback={<PageLoader />}>
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
          <Route path="/receive" element={<Navigate to="/scan-search" replace />} />
          <Route path="/scan" element={<Navigate to="/scan-search" replace />} />
          <Route path="/search" element={<Navigate to="/scan-search" replace />} />
          <Route path="/scan-search" element={<ScanSearchPage />} />
          <Route path="/storage" element={<StoragePage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/labs" element={<LabsPage />} />
          <Route path="/fluorochromes" element={<FluorochromesPage />} />
          <Route path="/tickets" element={<TicketsPage />} />
          <Route path="/global-search" element={<GlobalSearchPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SharedDataProvider>
          <ToastProvider>
            <AppRoutes />
          </ToastProvider>
        </SharedDataProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
