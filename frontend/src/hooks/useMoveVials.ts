import { useState, useMemo, useCallback, useRef } from "react";
import api from "../api/client";
import type {
  StorageGrid,
  StorageCell,
  VialMoveResult,
} from "../api/types";

export type DestMode = "auto" | "start" | "pick";

export interface UseMoveVialsOptions {
  selectedVialCount: number;
  onSuccess: (count: number) => void;
  onError: (message: string) => void;
}

export interface UseMoveVialsReturn {
  targetUnitId: string;
  targetGrid: StorageGrid | null;
  destMode: DestMode;
  destStartCellId: string | null;
  destPickedCellIds: Set<string>;
  loading: boolean;
  movedVialIds: Set<string>;
  previewCellIds: Set<string>;
  insufficientCells: boolean;
  handleTargetUnitChange: (unitId: string) => void;
  handleTargetCellClick: (cell: StorageCell) => void;
  executeMove: (vialIds: string[]) => Promise<void>;
  resetDestination: () => void;
  clearMode: () => void;
}

export function useMoveVials({
  selectedVialCount,
  onSuccess,
  onError,
}: UseMoveVialsOptions): UseMoveVialsReturn {
  const [targetUnitId, setTargetUnitId] = useState("");
  const [targetGrid, setTargetGrid] = useState<StorageGrid | null>(null);
  const [destMode, setDestMode] = useState<DestMode>("auto");
  const [destStartCellId, setDestStartCellId] = useState<string | null>(null);
  const [destPickedCellIds, setDestPickedCellIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [movedVialIds, setMovedVialIds] = useState<Set<string>>(new Set());

  // Refs to allow stable callbacks to read current state
  const destModeRef = useRef(destMode);
  destModeRef.current = destMode;
  const destStartCellIdRef = useRef(destStartCellId);
  destStartCellIdRef.current = destStartCellId;
  const destPickedCellIdsRef = useRef(destPickedCellIds);
  destPickedCellIdsRef.current = destPickedCellIds;
  const targetUnitIdRef = useRef(targetUnitId);
  targetUnitIdRef.current = targetUnitId;

  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const clearMode = useCallback(() => {
    setDestMode("auto");
    setDestStartCellId(null);
    setDestPickedCellIds(new Set());
  }, []);

  const resetDestination = useCallback(() => {
    setTargetUnitId("");
    setTargetGrid(null);
    setMovedVialIds(new Set());
    clearMode();
  }, [clearMode]);

  const handleTargetUnitChange = useCallback(async (unitId: string) => {
    setTargetUnitId(unitId);
    setDestMode("auto");
    setDestStartCellId(null);
    setDestPickedCellIds(new Set());
    setMovedVialIds(new Set());
    setTargetGrid(null);
    if (!unitId) return;
    try {
      const res = await api.get<StorageGrid>(`/storage/units/${unitId}/grid`);
      setTargetGrid(res.data);
    } catch { /* skip */ }
  }, []);

  const handleTargetCellClick = useCallback((cell: StorageCell) => {
    if (cell.vial_id) return;
    const mode = destModeRef.current;
    if (mode === "auto") {
      setDestMode("start");
      setDestStartCellId(cell.id);
    } else if (mode === "start") {
      const startId = destStartCellIdRef.current;
      if (startId === cell.id) {
        setDestMode("auto");
        setDestStartCellId(null);
      } else {
        setDestMode("pick");
        setDestPickedCellIds(new Set([startId!, cell.id]));
        setDestStartCellId(null);
      }
    } else {
      setDestPickedCellIds((prev) => {
        const next = new Set(prev);
        if (next.has(cell.id)) next.delete(cell.id);
        else next.add(cell.id);
        return next;
      });
    }
  }, []);

  const previewCellIds = useMemo(() => {
    if (destMode !== "start" || !targetGrid || !destStartCellId || selectedVialCount === 0) {
      return new Set<string>();
    }
    const emptyCells = targetGrid.cells
      .filter((c) => !c.vial_id)
      .sort((a, b) => a.row - b.row || a.col - b.col);
    const startIdx = emptyCells.findIndex((c) => c.id === destStartCellId);
    if (startIdx < 0) return new Set<string>();
    const preview = emptyCells.slice(startIdx, startIdx + selectedVialCount);
    return new Set(preview.map((c) => c.id));
  }, [targetGrid, destStartCellId, selectedVialCount, destMode]);

  const insufficientCells = useMemo(() => {
    if (destMode === "start") {
      if (!destStartCellId || !targetGrid) return false;
      return previewCellIds.size < selectedVialCount;
    }
    if (destMode === "pick") {
      return destPickedCellIds.size !== selectedVialCount;
    }
    return false;
  }, [previewCellIds, selectedVialCount, destStartCellId, targetGrid, destMode, destPickedCellIds]);

  const executeMove = useCallback(async (vialIds: string[]) => {
    const unitId = targetUnitIdRef.current;
    if (vialIds.length === 0 || !unitId) return;
    setLoading(true);
    try {
      const mode = destModeRef.current;
      const startId = destStartCellIdRef.current;
      const pickedIds = destPickedCellIdsRef.current;
      const movePayload: Record<string, unknown> = {
        vial_ids: vialIds,
        target_unit_id: unitId,
      };
      if (mode === "start" && startId) {
        movePayload.start_cell_id = startId;
      } else if (mode === "pick" && pickedIds.size > 0) {
        movePayload.target_cell_ids = Array.from(pickedIds);
      }
      const res = await api.post<VialMoveResult>("/vials/move", movePayload);
      // Clear selection mode but keep destination grid visible
      clearMode();
      // Track which vials were moved so they can be highlighted
      setMovedVialIds(new Set(res.data.vials.map((v) => v.id)));
      // Re-fetch destination grid to show where vials landed
      try {
        const gridRes = await api.get<StorageGrid>(`/storage/units/${unitId}/grid`);
        setTargetGrid(gridRes.data);
      } catch { /* grid refresh failed, not critical */ }
      onSuccessRef.current(res.data.moved_count);
    } catch (err: any) {
      onErrorRef.current(err.response?.data?.detail || "Failed to move vials");
    } finally {
      setLoading(false);
    }
  }, [clearMode]);

  return {
    targetUnitId,
    targetGrid,
    destMode,
    destStartCellId,
    destPickedCellIds,
    loading,
    movedVialIds,
    previewCellIds,
    insufficientCells,
    handleTargetUnitChange,
    handleTargetCellClick,
    executeMove,
    resetDestination,
    clearMode,
  };
}
