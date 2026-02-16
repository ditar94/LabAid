import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  const { user, loading: authLoading, labSettings, impersonatingLab } = useAuth();
  const queryClient = useQueryClient();
  const [selectedLab, setSelectedLab] = useState("");

  const isSuperAdmin = user?.role === "super_admin";
  const needsLabParam = isSuperAdmin && !impersonatingLab;

  // Labs query (super_admin only, not impersonating)
  const { data: labs = [], isSuccess: labsLoaded } = useQuery<Lab[]>({
    queryKey: ["labs"],
    queryFn: () => api.get<Lab[]>("/labs/").then((r) => r.data),
    enabled: !authLoading && !!user && isSuperAdmin && !impersonatingLab,
  });

  // Auto-select first lab for super admin; lock to user.lab_id for others
  useEffect(() => {
    if (authLoading || !user) return;
    if (isSuperAdmin && !impersonatingLab) {
      if (labs.length > 0 && !selectedLab) {
        setSelectedLab(labs[0].id);
      }
    } else {
      setSelectedLab(user.lab_id || "");
    }
  }, [user, authLoading, impersonatingLab, isSuperAdmin, labs, selectedLab]);

  // Fluorochromes — same queryKey as FluorochromesPage for shared cache
  const labParams = needsLabParam && selectedLab ? { lab_id: selectedLab } : {};
  const { data: fluorochromes = [] } = useQuery<Fluorochrome[]>({
    queryKey: ["fluorochromes", selectedLab],
    queryFn: () =>
      api.get<Fluorochrome[]>("/fluorochromes/", { params: labParams }).then((r) => r.data),
    enabled: !!selectedLab && !!user,
  });

  // Storage units
  const storageDisabled = labSettings.storage_enabled === false;
  const { data: storageUnits = [] } = useQuery<StorageUnit[]>({
    queryKey: ["storage-units", selectedLab, storageDisabled],
    queryFn: () => {
      if (storageDisabled) return Promise.resolve([]);
      const params: Record<string, string> = {};
      if (needsLabParam) params.lab_id = selectedLab;
      return api.get<StorageUnit[]>("/storage/units", { params }).then((r) => r.data);
    },
    enabled: !!selectedLab && !!user,
  });

  // Refresh callbacks — thin wrappers around query invalidation
  const refreshLabs = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["labs"] });
  }, [queryClient]);

  const refreshFluorochromes = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["fluorochromes"] });
  }, [queryClient]);

  const refreshStorageUnits = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["storage-units"] });
  }, [queryClient]);

  const refreshLabData = useCallback(async () => {
    await Promise.all([refreshFluorochromes(), refreshStorageUnits()]);
  }, [refreshFluorochromes, refreshStorageUnits]);

  // Loading = auth pending, or super admin waiting for labs list to set initial selectedLab
  const loading =
    authLoading ||
    (!!user && isSuperAdmin && !impersonatingLab && !labsLoaded);

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
