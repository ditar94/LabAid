import { useState, useCallback } from "react";
import api from "../api/client";
import type { StorageCell } from "../api/types";

// ── Options for configuring the hook per page ────────────────────────────
interface UseVialActionsOptions {
  /** Called after a successful open or deplete to refresh page data (grids, lists, etc.). */
  onRefresh?: () => void | Promise<void>;
  /** Called with a user-facing success message after open/deplete. */
  onSuccess?: (message: string) => void;
  /** Called with a user-facing error message on failure. */
  onError?: (message: string) => void;
}

// ── Return type — consumed by pages and OpenVialDialog ───────────────────
export interface UseVialActionsReturn {
  /** The cell currently targeted for open/deplete (drives dialog visibility). */
  openTarget: StorageCell | null;
  /** True while an API call is in flight. */
  openLoading: boolean;
  /** Set or clear the target cell (null hides the dialog). */
  setOpenTarget: (cell: StorageCell | null) => void;
  /** Open the targeted vial. `force` bypasses QC warnings. */
  handleOpenVial: (force: boolean) => Promise<void>;
  /** Deplete the targeted vial. */
  handleDepleteVial: () => Promise<void>;
  /** Grid cell click handler — only sets target for sealed/opened vials. */
  handleCellClick: (cell: StorageCell) => void;
}

/**
 * Shared hook for open/deplete vial actions.
 *
 * Replaces 4 near-identical implementations across StoragePage, SearchPage,
 * InventoryPage, and ScanSearchPage. Each page configures its own callbacks:
 *   - onRefresh: reload grids / data after mutation
 *   - onSuccess: show toast or message
 *   - onError:   show error toast or message
 */
export function useVialActions({
  onRefresh,
  onSuccess,
  onError,
}: UseVialActionsOptions = {}): UseVialActionsReturn {
  // The cell the user tapped — shown in OpenVialDialog
  const [openTarget, setOpenTarget] = useState<StorageCell | null>(null);
  // Loading spinner while API call is in flight
  const [openLoading, setOpenLoading] = useState(false);

  // ── Open a sealed vial (POST /vials/:id/open) ─────────────────────────
  const handleOpenVial = useCallback(
    async (force: boolean) => {
      if (!openTarget?.vial) return;
      setOpenLoading(true);
      try {
        await api.post(`/vials/${openTarget.vial.id}/open?force=${force}`, {
          cell_id: openTarget.id,
        });
        onSuccess?.(`Vial opened from cell ${openTarget.label}. Status updated.`);
        setOpenTarget(null);
        await onRefresh?.();
      } catch (err: any) {
        onError?.(err.response?.data?.detail || "Failed to open vial");
        setOpenTarget(null);
      } finally {
        setOpenLoading(false);
      }
    },
    [openTarget, onRefresh, onSuccess, onError]
  );

  // ── Deplete an opened vial (POST /vials/:id/deplete) ──────────────────
  const handleDepleteVial = useCallback(
    async () => {
      if (!openTarget?.vial) return;
      setOpenLoading(true);
      try {
        await api.post(`/vials/${openTarget.vial.id}/deplete`);
        onSuccess?.(`Vial depleted from cell ${openTarget.label}. Status updated.`);
        setOpenTarget(null);
        await onRefresh?.();
      } catch (err: any) {
        onError?.(err.response?.data?.detail || "Failed to deplete vial");
        setOpenTarget(null);
      } finally {
        setOpenLoading(false);
      }
    },
    [openTarget, onRefresh, onSuccess, onError]
  );

  // ── Convenience click handler for grid cells ──────────────────────────
  // Only targets sealed or opened vials — ignores depleted/empty cells.
  const handleCellClick = useCallback((cell: StorageCell) => {
    if (!cell.vial || (cell.vial.status !== "sealed" && cell.vial.status !== "opened")) return;
    setOpenTarget(cell);
  }, []);

  return {
    openTarget,
    openLoading,
    setOpenTarget,
    handleOpenVial,
    handleDepleteVial,
    handleCellClick,
  };
}
