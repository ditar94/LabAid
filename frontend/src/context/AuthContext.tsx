import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
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

function getCached<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const cachedUser = getCached<User>("cachedUser");
  const cachedSettings = getCached<LabSettings>("cachedLabSettings");

  const [user, setUser] = useState<User | null>(cachedUser);
  const [labSettings, setLabSettings] = useState<LabSettings>(cachedSettings || {});
  const [impersonatingLab, setImpersonatingLab] = useState<ImpersonatingLab | null>(() => {
    const stored = localStorage.getItem("impersonatingLab");
    return stored ? JSON.parse(stored) : null;
  });
  // Skip loading screen if we have cached data — render immediately
  const [loading, setLoading] = useState(!cachedUser);

  const fetchUser = async () => {
    const res = await api.get("/auth/me");
    setUser(res.data);
    localStorage.setItem("cachedUser", JSON.stringify(res.data));
    try {
      const settingsRes = await api.get("/labs/my-settings");
      setLabSettings(settingsRes.data || {});
      localStorage.setItem("cachedLabSettings", JSON.stringify(settingsRes.data || {}));
    } catch {
      setLabSettings({});
      localStorage.removeItem("cachedLabSettings");
    }
  };

  useEffect(() => {
    // Verify auth in background (or establish it on first visit)
    fetchUser()
      .catch(() => {
        localStorage.removeItem("impersonatingLab");
        localStorage.removeItem("cachedUser");
        localStorage.removeItem("cachedLabSettings");
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
    localStorage.removeItem("cachedUser");
    localStorage.removeItem("cachedLabSettings");
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
