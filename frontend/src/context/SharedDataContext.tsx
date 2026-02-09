import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import api from "../api/client";
import type { Lab, Fluorochrome, StorageUnit } from "../api/types";
import { useAuth } from "./AuthContext";

interface SharedDataContextType {
  /** All labs (super_admin) or empty array (other roles). */
  labs: Lab[];
  /** Fluorochromes for the current lab context. */
  fluorochromes: Fluorochrome[];
  /** Storage units for the current lab context. */
  storageUnits: StorageUnit[];
  /** The lab_id currently being used (derived from user or super_admin selection). */
  selectedLab: string;
  setSelectedLab: (id: string) => void;
  /** True during the initial load. */
  loading: boolean;
  /** Refetch labs list. Call after creating/suspending a lab. */
  refreshLabs: () => Promise<void>;
  /** Refetch fluorochromes. Call after creating/editing/deleting a fluorochrome. */
  refreshFluorochromes: () => Promise<void>;
  /** Refetch storage units. Call after creating/deleting a storage unit. */
  refreshStorageUnits: () => Promise<void>;
  /** Refetch all lab-scoped data (fluorochromes + storage units). */
  refreshLabData: () => Promise<void>;
}

const SharedDataContext = createContext<SharedDataContextType | null>(null);

export function SharedDataProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading, labSettings } = useAuth();
  const [labs, setLabs] = useState<Lab[]>([]);
  const [fluorochromes, setFluorochromes] = useState<Fluorochrome[]>([]);
  const [storageUnits, setStorageUnits] = useState<StorageUnit[]>([]);
  const [selectedLab, setSelectedLab] = useState("");
  const [loading, setLoading] = useState(true);

  // Fetch labs list (super_admin only)
  const refreshLabs = useCallback(async () => {
    if (user?.role !== "super_admin") return;
    const res = await api.get<Lab[]>("/labs/");
    setLabs(res.data);
  }, [user?.role]);

  // Fetch fluorochromes for selected lab
  const refreshFluorochromes = useCallback(async () => {
    if (!selectedLab || !user) return;
    const params: Record<string, string> = {};
    if (user.role === "super_admin") params.lab_id = selectedLab;
    const res = await api.get<Fluorochrome[]>("/fluorochromes/", { params });
    setFluorochromes(res.data);
  }, [selectedLab, user]);

  // Fetch storage units for selected lab
  const refreshStorageUnits = useCallback(async () => {
    if (!selectedLab || !user) return;
    if (labSettings.storage_enabled === false) {
      setStorageUnits([]);
      return;
    }
    const params: Record<string, string> = {};
    if (user.role === "super_admin") params.lab_id = selectedLab;
    const res = await api.get<StorageUnit[]>("/storage/units", { params });
    setStorageUnits(res.data);
  }, [selectedLab, user, labSettings.storage_enabled]);

  // Refresh both fluorochromes and storage units
  const refreshLabData = useCallback(async () => {
    await Promise.all([refreshFluorochromes(), refreshStorageUnits()]);
  }, [refreshFluorochromes, refreshStorageUnits]);

  // Wait for auth to finish, then set selectedLab from user context
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      // Not logged in — nothing to fetch, just stop loading
      setLoading(false);
      return;
    }
    // Reset loading while we fetch lab data for the newly-logged-in user
    setLoading(true);
    if (user.role === "super_admin") {
      (async () => {
        try {
          const res = await api.get<Lab[]>("/labs/");
          setLabs(res.data);
          if (res.data.length > 0 && !selectedLab) {
            setSelectedLab(res.data[0].id);
          }
        } catch { /* ignore */ }
        setLoading(false);
      })();
    } else {
      setSelectedLab(user.lab_id || "");
      setLoading(false);
    }
  }, [user, authLoading]);

  // When selectedLab changes, fetch lab-scoped data (only if logged in)
  useEffect(() => {
    if (!selectedLab || !user) return;
    refreshLabData();
  }, [selectedLab]);

  // Re-fetch storage units when storage_enabled setting changes
  useEffect(() => {
    if (!selectedLab || !user) return;
    refreshStorageUnits();
  }, [labSettings.storage_enabled]);

  return (
    <SharedDataContext.Provider
      value={{
        labs,
        fluorochromes,
        storageUnits,
        selectedLab,
        setSelectedLab,
        loading,
        refreshLabs,
        refreshFluorochromes,
        refreshStorageUnits,
        refreshLabData,
      }}
    >
      {children}
    </SharedDataContext.Provider>
  );
}

export function useSharedData() {
  const ctx = useContext(SharedDataContext);
  if (!ctx) throw new Error("useSharedData must be used within SharedDataProvider");
  return ctx;
}
