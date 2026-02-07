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
  token: string | null;
  labSettings: LabSettings;
  impersonatingLab: ImpersonatingLab | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  startImpersonation: (labId: string) => Promise<void>;
  endImpersonation: () => Promise<void>;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(
    localStorage.getItem("token")
  );
  const [labSettings, setLabSettings] = useState<LabSettings>({});
  const [impersonatingLab, setImpersonatingLab] = useState<ImpersonatingLab | null>(() => {
    const stored = localStorage.getItem("impersonatingLab");
    return stored ? JSON.parse(stored) : null;
  });
  const [loading, setLoading] = useState(true);

  const fetchUser = async (t?: string) => {
    const headers = t ? { Authorization: `Bearer ${t}` } : undefined;
    const res = await api.get("/auth/me", { headers });
    setUser(res.data);
    // Fetch lab settings after user
    try {
      const settingsRes = await api.get("/labs/my-settings", { headers });
      setLabSettings(settingsRes.data || {});
    } catch {
      setLabSettings({});
    }
  };

  useEffect(() => {
    if (token) {
      fetchUser()
        .catch(() => {
          localStorage.removeItem("token");
          localStorage.removeItem("impersonatingLab");
          setToken(null);
          setImpersonatingLab(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [token]);

  const login = async (email: string, password: string) => {
    const res = await api.post("/auth/login", { email, password });
    const t = res.data.access_token;
    localStorage.setItem("token", t);
    localStorage.removeItem("impersonatingLab");
    setImpersonatingLab(null);
    setToken(t);
    await fetchUser(t);
  };

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("impersonatingLab");
    setToken(null);
    setUser(null);
    setLabSettings({});
    setImpersonatingLab(null);
  };

  const refreshUser = async () => {
    await fetchUser();
  };

  const startImpersonation = async (labId: string) => {
    const res = await api.post("/auth/impersonate", { lab_id: labId });
    const { token: newToken, lab_name } = res.data;
    localStorage.setItem("token", newToken);
    const labInfo = { id: labId, name: lab_name };
    localStorage.setItem("impersonatingLab", JSON.stringify(labInfo));
    setImpersonatingLab(labInfo);
    setToken(newToken);
    await fetchUser(newToken);
  };

  const endImpersonation = async () => {
    const res = await api.post("/auth/end-impersonate");
    const { token: newToken } = res.data;
    localStorage.setItem("token", newToken);
    localStorage.removeItem("impersonatingLab");
    setImpersonatingLab(null);
    setToken(newToken);
    await fetchUser(newToken);
  };

  return (
    <AuthContext.Provider value={{
      user, token, labSettings, impersonatingLab,
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
