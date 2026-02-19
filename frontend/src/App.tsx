import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { SharedDataProvider } from "./context/SharedDataContext";
import { ToastProvider } from "./context/ToastContext";
import Layout from "./components/Layout";
import { lazy, Suspense, type ReactNode } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import "./App.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,     // 60s default — pages show cached data instantly
      gcTime: 5 * 60_000,    // 5min — keep unused data in memory
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});

export { queryClient };

// Eagerly-loaded pages (entry points users hit first — no loading flash)
import LoginPage from "./pages/LoginPage";
import SetupPage from "./pages/SetupPage";

// Eagerly-loaded: primary landing page after login — no chunk-load flash
import DashboardPage from "./pages/DashboardPage";

// Lazy-loaded pages — each becomes a separate chunk
const LabSetupWizardPage = lazy(() => import("./pages/LabSetupWizardPage"));
const ChangePasswordPage = lazy(() => import("./pages/ChangePasswordPage"));
const ForgotPasswordPage = lazy(() => import("./pages/ForgotPasswordPage"));
const SetPasswordPage = lazy(() => import("./pages/SetPasswordPage"));
const InventoryPage = lazy(() => import("./pages/InventoryPage"));
const scanSearchImport = () => import("./pages/ScanSearchPage");
const ScanSearchPage = lazy(scanSearchImport);

/** Preload the most-likely-next chunks after login so they're instant. */
export function preloadAppChunks() {
  scanSearchImport();
}
const StoragePage = lazy(() => import("./pages/StoragePage"));
const AuditPage = lazy(() => import("./pages/AuditPage"));
const UsersPage = lazy(() => import("./pages/UsersPage"));
const LabsPage = lazy(() => import("./pages/LabsPage"));
const FluorochromesPage = lazy(() => import("./pages/FluorochromesPage"));
const TicketsPage = lazy(() => import("./pages/TicketsPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const GlobalSearchPage = lazy(() => import("./pages/GlobalSearchPage"));
const ReportsPage = lazy(() => import("./pages/ReportsPage"));
const CocktailsPage = lazy(() => import("./pages/CocktailsPage"));
const TermsPage = lazy(() => import("./pages/TermsPage"));

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading, labSettings } = useAuth();
  const location = useLocation();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.must_change_password && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" />;
  }
  // Lab admin first-login wizard (only after password change is done)
  if (
    user.role === "lab_admin" &&
    !user.must_change_password &&
    labSettings.setup_complete !== true &&
    location.pathname !== "/lab-setup"
  ) {
    return <Navigate to="/lab-setup" />;
  }
  return <>{children}</>;
}
function AppRoutes() {
  return (
    <Suspense fallback={<div className="page-shell" />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/set-password" element={<SetPasswordPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route
          path="/change-password"
          element={
            <ProtectedRoute>
              <ChangePasswordPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lab-setup"
          element={
            <ProtectedRoute>
              <LabSetupWizardPage />
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
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/receive" element={<Navigate to="/scan-search" replace />} />
          <Route path="/scan" element={<Navigate to="/scan-search" replace />} />
          <Route path="/search" element={<Navigate to="/scan-search" replace />} />
          <Route path="/scan-search" element={<ScanSearchPage />} />
          <Route path="/storage" element={<StoragePage />} />
          <Route path="/cocktails" element={<CocktailsPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/labs" element={<LabsPage />} />
          <Route path="/fluorochromes" element={<FluorochromesPage />} />
          <Route path="/tickets" element={<TicketsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/global-search" element={<GlobalSearchPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <SharedDataProvider>
              <ToastProvider>
                <AppRoutes />
              </ToastProvider>
            </SharedDataProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
