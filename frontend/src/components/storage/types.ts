import type { ReactNode } from "react";
import type {
  StorageCell,
  StorageUnit,
  Fluorochrome,
  StorageGrid as StorageGridData,
} from "../../api/types";

// ── Public types (exported via barrel) ────────────────────────────────────

export interface LotFilter {
  lotId: string;
  lotNumber: string;
}

export interface StockControl {
  activeVialCount: number;
  storedVialCount?: number;
  hasVendorBarcode: boolean;
  storageUnits: StorageUnit[];
  stockUnitId: string;
  onStockUnitChange: (unitId: string) => void;
  onStock: () => void;
  stockLoading: boolean;
}

/** Imperative handle for programmatic move mode control (e.g. deep-link consolidation). */
export interface StorageViewHandle {
  enterMoveMode: (preselectedVialIds?: Set<string>) => void;
  exitMoveMode: () => void;
}

export type PopoutAction = {
  label: string;
  onClick: () => void;
  variant?: "primary" | "danger" | "default";
};

// ── Internal types ────────────────────────────────────────────────────────

export type WorkspaceMode = "browse" | "lot" | "scan" | "move";

/** Derived workflow metadata — computed from props, never set directly. */
export interface WorkspaceContext {
  /** Mode to return to when exiting a workflow (always the current prop-derived base). */
  baseMode: WorkspaceMode;
  /** Lot ID being filtered, if any. */
  lotId: string | null;
  /** Whether only highlighted vials are interactive (lot or scan mode). */
  highlightOnly: boolean;
  /** Whether the legend should be hidden. */
  hideLegend: boolean;
  /** Whether the workspace is acting as a cell picker (onCellSelect provided). */
  isCellPicker: boolean;
}

/** User selections within the current workflow. */
export interface WorkspaceSelection {
  /** Source: vial IDs selected to move. */
  sourceVialIds: Set<string>;
}

/**
 * StorageView context semantics — three mutually exclusive modes:
 *
 * 1. **Lot mode** (`lotFilter` present):
 *    - Highlights lot vials, dims others, hides per-grid legend.
 *    - Forces `highlightOnly: true` internally (prop ignored).
 *    - Move mode preselects lot vials on entry.
 *    - Do NOT also pass `highlightVialIds` — it is shadowed by the
 *      internally-computed lot highlight set.
 *
 * 2. **Scan / highlight mode** (`highlightVialIds` + `highlightOnly`, no `lotFilter`):
 *    - Highlights the given vial IDs, dims others.
 *    - Move mode starts with empty selection (visual-only highlights).
 *
 * 3. **Browse mode** (neither `lotFilter` nor `highlightOnly`):
 *    - All vials rendered equally, no dimming.
 *    - Move mode starts with empty selection.
 */
export interface StorageViewProps {
  grids: StorageGridData[];
  fluorochromes: Fluorochrome[];
  onRefresh?: () => void | Promise<void>;
  /**
   * Vial IDs to visually highlight. Ignored when `lotFilter` is set
   * (lot highlights are derived from grid cells matching the lot ID).
   */
  highlightVialIds?: Set<string>;
  legendExtra?: ReactNode;
  hideLegend?: boolean;
  /**
   * When true, only highlighted vials are interactive (clickable).
   * Forced to true internally when `lotFilter` is set — do not pass both.
   */
  highlightOnly?: boolean;
  /**
   * Scopes the view to a single lot. Enables lot mode: computes highlight
   * IDs from grid cells, forces `highlightOnly`, hides legend, and
   * preselects lot vials when entering move mode.
   */
  lotFilter?: LotFilter;
  stockControl?: StockControl;
  onMoveChange?: (isMoving: boolean) => void;
  loading?: boolean;
  className?: string;
  extraPopoutActions?: (cell: StorageCell) => PopoutAction[];
  headerActions?: (ctx: { enterMoveMode: () => void }) => ReactNode;
  moveHeaderExtra?: (ctx: {
    selectAll: () => void;
    addVialIds: (ids: string[]) => void;
  }) => ReactNode;
  highlightNextCellId?: string | null;
  readOnly?: boolean;
  excludeUnitIds?: string[];
  /** Cell picker mode (e.g. ScanSearchPage store_open intent). */
  onCellSelect?: (cell: StorageCell) => void;
  selectedCellId?: string | null;
}
