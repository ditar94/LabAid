// ── CocktailRecipeCard — Cocktail recipe display card ───────────────────────
// Renders a cocktail recipe as a card with distinctive Lab Chemistry aesthetic.
// Used by CocktailsPage (expandable with lot tables) and ScanSearchPage
// (recipe-only result when no active lot exists).
//
// Layout:
//   Header  → flask icon with bubbles, recipe name, gradient cocktail badge, info button
//   Meta    → component count, shelf life badge, max renewals badge
//   Counts  → active, pending, expired, total lots (violet gradient)
//   Content → children rendered when expanded (lot tables, actions, etc.)

import type { ReactNode, MouseEvent } from "react";
import { Info } from "lucide-react";
import type { CocktailRecipe } from "../api/types";
import InventoryCardBase from "./InventoryCardBase";

interface CocktailRecipeCardProps {
  /** The recipe data to display. */
  recipe: CocktailRecipe;
  /** Aggregate lot counts for this recipe. */
  counts: { active: number; pendingQC: number; expired: number; total: number };
  /** If true, card is in expanded state (shows children, full-width). */
  expanded?: boolean;
  /** If true, card is transitioning from expanded to collapsed. */
  collapsing?: boolean;
  /** Click handler for the card (for expand/collapse). */
  onClick?: () => void;
  /** Callback when user clicks the info button. */
  onInfo?: (e: MouseEvent) => void;
  /** Content rendered inside the card when expanded (lot tables, actions, etc.). */
  children?: ReactNode;
  /** Inline styles for the outer div (e.g., grid positioning). */
  style?: React.CSSProperties;
}

/**
 * Cocktail recipe display card with Lab Chemistry aesthetic.
 *
 * Features:
 *   - Gradient flask icon with bubble animation on hover
 *   - Shimmer effect on "Cocktail" badge
 *   - Violet-tinted counts grid with gradient text
 *   - Subtle gradient background on hover/expanded
 */
export default function CocktailRecipeCard({
  recipe,
  counts,
  expanded = false,
  collapsing = false,
  onClick,
  onInfo,
  children,
  style,
}: CocktailRecipeCardProps) {
  return (
    <InventoryCardBase
      expanded={expanded}
      collapsing={collapsing}
      onClick={onClick}
      style={style}
      className="cocktail-card"
      expandedContent={
        children ? (
          <div className="cocktail-expanded-content">{children}</div>
        ) : undefined
      }
    >
      {/* Info button — positioned absolutely in top-right corner */}
      {onInfo && (
        <button
          className="cocktail-info-btn"
          onClick={(e) => {
            e.stopPropagation();
            onInfo(e);
          }}
          title="View cocktail details"
        >
          <Info size={14} />
        </button>
      )}

      {/* ── Card Header: name, shelf life badge, inactive badge ── */}
      <div className="inventory-card-header">
        <div className="inventory-title">
          <span>{recipe.name}</span>

          <span className="badge cocktail-shelf-badge" style={{ fontSize: "0.7em" }}>
            {recipe.shelf_life_days}d
          </span>

          {/* Inactive badge (if recipe is deactivated) */}
          {!recipe.is_active && (
            <span className="badge badge-gray" style={{ fontSize: "0.7em", marginLeft: 4 }}>
              Inactive
            </span>
          )}
        </div>
      </div>

      {/* ── Meta row: max renewals ── */}
      {recipe.max_renewals != null && (
        <div className="inventory-meta cocktail-meta">
          <span className="badge cocktail-renewal-badge" style={{ fontSize: "0.75em" }}>
            max {recipe.max_renewals} renewal{recipe.max_renewals !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {/* ── Lot count columns (violet gradient) ── */}
      <div className="cocktail-counts">
        <div>
          <div className="count-label">Active</div>
          <div className="count-value">{counts.active}</div>
        </div>
        <div>
          <div className="count-label">Pending</div>
          <div className="count-value">{counts.pendingQC}</div>
        </div>
        <div>
          <div className="count-label">Expired</div>
          <div className="count-value">{counts.expired}</div>
        </div>
        <div>
          <div className="count-label">Total</div>
          <div className="count-value">{counts.total}</div>
        </div>
      </div>
    </InventoryCardBase>
  );
}
