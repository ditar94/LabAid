import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { User, LabSettings } from "../api/types";

interface ImpersonatingLab {
  id: string;
  name: string;
}

interface AuthContextType {
  user: User | null;
  labSettings: LabSettings;
  impersonatingLab: ImpersonatingLab | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  startImpersonation: (labId: string) => Promise<void>;
  endImpersonation: () => Promise<void>;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [labSettings, setLabSettings] = useState<LabSettings>({});
  const [impersonatingLab, setImpersonatingLab] = useState<ImpersonatingLab | null>(() => {
    try {
      const stored = localStorage.getItem("impersonatingLab");
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  const fetchUser = async () => {
    const res = await api.get("/bootstrap");
    const { user: u, lab_settings, fluorochromes, storage_units, labs } = res.data;
    setUser(u);
    setLabSettings(lab_settings || {});

    // Seed TanStack Query cache so SharedDataContext and pages show data instantly
    const labId = u.lab_id || "";
    if (fluorochromes) {
      queryClient.setQueryData(["fluorochromes", labId], fluorochromes);
    }
    const storageDisabled = lab_settings?.storage_enabled === false;
    if (storage_units) {
      queryClient.setQueryData(["storage-units", labId, storageDisabled], storage_units);
    }
    if (labs) {
      queryClient.setQueryData(["labs"], labs);
    }
  };

  useEffect(() => {
    fetchUser()
      .catch(() => {
        localStorage.removeItem("impersonatingLab");
        setImpersonatingLab(null);
        setUser(null);
        setLabSettings({});
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    await api.post("/auth/login", { email, password });
    localStorage.removeItem("impersonatingLab");
    setImpersonatingLab(null);
    await fetchUser();
  };

  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // Even if the call fails, clear local state
    }
    localStorage.removeItem("impersonatingLab");
    setUser(null);
    setLabSettings({});
    setImpersonatingLab(null);
  };

  const refreshUser = async () => {
    await fetchUser();
  };

  const startImpersonation = async (labId: string) => {
    const res = await api.post("/auth/impersonate", { lab_id: labId });
    const { lab_name } = res.data;
    const labInfo = { id: labId, name: lab_name };
    localStorage.setItem("impersonatingLab", JSON.stringify(labInfo));
    setImpersonatingLab(labInfo);
    await fetchUser();
  };

  const endImpersonation = async () => {
    await api.post("/auth/end-impersonate");
    localStorage.removeItem("impersonatingLab");
    setImpersonatingLab(null);
    await fetchUser();
  };

  return (
    <AuthContext.Provider value={{
      user, labSettings, impersonatingLab,
      login, logout, refreshUser, startImpersonation, endImpersonation, loading,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
