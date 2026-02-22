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
import { FlaskConical, Info } from "lucide-react";
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
      {/* ── Card Header: flask icon, name, cocktail badge, inactive badge, info button ── */}
      <div className="inventory-card-header">
        <div className="inventory-title">
          {/* Cocktail flask icon with gradient and bubbles */}
          <div className="cocktail-flask">
            <FlaskConical size={14} color="#fff" strokeWidth={2.5} />
          </div>

          {/* Recipe name */}
          <span>{recipe.name}</span>

          {/* Cocktail type badge with shimmer */}
          <span className="cocktail-type-badge">Cocktail</span>

          {/* Inactive badge (if recipe is deactivated) */}
          {!recipe.is_active && (
            <span className="badge badge-gray" style={{ fontSize: "0.7em", marginLeft: 4 }}>
              Inactive
            </span>
          )}
        </div>

        {/* Info button to view cocktail details (components, shelf life, etc.) */}
        {onInfo && (
          <button
            className="btn-sm btn-secondary"
            onClick={(e) => {
              e.stopPropagation();
              onInfo(e);
            }}
            title="View cocktail details"
            style={{ padding: "0.1rem 0.3rem", lineHeight: 1 }}
          >
            <Info size={14} />
          </button>
        )}
      </div>

      {/* ── Meta row: component count, shelf life, max renewals ── */}
      <div className="inventory-meta cocktail-meta">
        <span>
          {recipe.components.length} component{recipe.components.length !== 1 ? "s" : ""}
        </span>
        <span className="badge cocktail-shelf-badge" style={{ fontSize: "0.75em" }}>
          {recipe.shelf_life_days}d shelf life
        </span>
        {recipe.max_renewals != null && (
          <span className="badge cocktail-renewal-badge" style={{ fontSize: "0.75em" }}>
            max {recipe.max_renewals} renewal{recipe.max_renewals !== 1 ? "s" : ""}
          </span>
        )}
      </div>

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
