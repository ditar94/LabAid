import type { Lot } from "../api/types";
import type { ActionMenuItem } from "../components/ActionMenu";

// ── Options — each page passes only the callbacks it supports ────────────
interface BuildLotActionsOptions {
  lot: Lot;
  /** InventoryPage only: edit lot metadata. */
  onEditLot?: (lot: Lot) => void;
  /** Deplete all remaining vials in the lot. */
  onDeplete?: (lot: Lot) => void;
  /** Open lot documents panel. */
  onOpenDocs?: (lot: Lot) => void;
  /** Archive (soft-delete) or unarchive the lot. */
  onArchive?: (lot: Lot) => void;
  /** Consolidate split-lot vials into one storage unit. */
  onConsolidate?: (lot: Lot) => void;
}

/**
 * Build the action menu items for a lot row.
 *
 * Shared between LotTable (desktop) and LotCardList (mobile).
 * Each page passes only the callbacks it supports — missing callbacks
 * simply omit that action from the menu.
 */
export function buildLotActions({
  lot,
  onEditLot,
  onDeplete,
  onOpenDocs,
  onArchive,
  onConsolidate,
}: BuildLotActionsOptions): ActionMenuItem[] {
  const items: ActionMenuItem[] = [];

  // Edit metadata (lot number, expiration, etc.)
  if (onEditLot) {
    items.push({ label: "Edit", icon: "\u270E", onClick: () => onEditLot(lot) });
  }

  // Deplete — only if there are active vials
  if (onDeplete && (lot.vial_counts?.total ?? 0) > 0) {
    items.push({ label: "Deplete", icon: "\u2298", variant: "danger", onClick: () => onDeplete(lot) });
  }

  // Documents — show count if any exist
  if (onOpenDocs) {
    items.push({
      label: `Docs${lot.documents?.length ? ` (${lot.documents.length})` : ""}`,
      icon: "\uD83D\uDCC4",
      onClick: () => onOpenDocs(lot),
    });
  }

  // Archive / Unarchive toggle
  if (onArchive) {
    items.push({
      label: lot.is_archived ? "Unarchive" : "Archive",
      icon: lot.is_archived ? "\u21A9" : "\u25A3",
      onClick: () => onArchive(lot),
    });
  }

  // Consolidate — only for split lots (vials across multiple storage units)
  if (lot.is_split && onConsolidate) {
    items.push({ label: "Consolidate", icon: "\u229E", onClick: () => onConsolidate(lot) });
  }

  return items;
}
