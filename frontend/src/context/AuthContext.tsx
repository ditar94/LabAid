import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import api from "../api/client";
import type { User, LabSettings } from "../api/types";

interface AuthContextType {
  user: User | null;
  token: string | null;
  labSettings: LabSettings;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(
    localStorage.getItem("token")
  );
  const [labSettings, setLabSettings] = useState<LabSettings>({});
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
          setToken(null);
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
    setToken(t);
    await fetchUser(t);
  };

  const logout = () => {
    localStorage.removeItem("token");
    setToken(null);
    setUser(null);
    setLabSettings({});
  };

  const refreshUser = async () => {
    await fetchUser();
  };

  return (
    <AuthContext.Provider value={{ user, token, labSettings, login, logout, refreshUser, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
