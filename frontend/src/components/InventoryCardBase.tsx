// ── InventoryCardBase — Shared visual shell for inventory cards ─────────────
// Provides the reusable card structure: corner arrows, expand/collapse labels,
// hover/shadow transitions, and expanded content slot. Used by AntibodyCard,
// CocktailRecipeCard, CocktailLotCard, and future card types.

import type { ReactNode } from "react";

interface InventoryCardBaseProps {
  /** If true, card is in expanded state (shows expandedContent, full-width). */
  expanded?: boolean;
  /** If true, card is transitioning from expanded to collapsed. */
  collapsing?: boolean;
  /** If true, card has a selected visual state (for search pages). */
  selected?: boolean;
  /** Click handler for the card. */
  onClick?: () => void;
  /** Main card content (header, meta, counts). */
  children: ReactNode;
  /** Content rendered inside the card when expanded. */
  expandedContent?: ReactNode;
  /** Inline styles for the outer div (e.g., grid positioning). */
  style?: React.CSSProperties;
  /** Additional CSS classes. */
  className?: string;
  /** data-* attribute for scroll targeting or identification. */
  dataId?: string;
  /** Name for the data-* attribute (defaults to "id"). */
  dataIdName?: string;
  /** If true, hide the expand/collapse labels (for always-expanded cards). */
  hideExpandLabels?: boolean;
}

/**
 * Shared visual shell for inventory-style cards.
 *
 * Renders the card wrapper with:
 *   - Corner decoration arrows (CSS-styled)
 *   - Expand/collapse labels (toggled by CSS based on .expanded)
 *   - Expanded content slot with click isolation
 *   - Hover effects and shadow transitions (via CSS)
 *
 * Content and behavior are provided by composing components.
 */
export default function InventoryCardBase({
  expanded = false,
  collapsing = false,
  selected = false,
  onClick,
  children,
  expandedContent,
  style,
  className = "",
  dataId,
  dataIdName = "id",
  hideExpandLabels = false,
}: InventoryCardBaseProps) {
  const dataAttr = dataId ? { [`data-${dataIdName}`]: dataId } : {};

  return (
    <div
      className={`inventory-card${expanded ? " expanded" : ""}${collapsing ? " collapsing" : ""}${selected ? " selected" : ""} ${className}`.trim()}
      {...dataAttr}
      style={style}
      onClick={onClick}
    >
      {/* Corner decoration arrows (CSS-styled) */}
      <span className="corner-arrow corner-tl" />
      <span className="corner-arrow corner-tr" />
      <span className="corner-arrow corner-bl" />
      <span className="corner-arrow corner-br" />

      {/* Card content (header, meta, counts) provided by composing component */}
      {children}

      {/* Expand/collapse label indicators (CSS toggles visibility based on .expanded) */}
      {!hideExpandLabels && (
        <>
          <div className="expand-label">Expand</div>
          <div className="collapse-label">Collapse</div>
        </>
      )}

      {/* Expanded content: lot tables, drilldowns, forms (provided by composing component) */}
      {(expanded || collapsing) && expandedContent && (
        <div className="inventory-expanded" onClick={(e) => e.stopPropagation()}>
          <div className="inventory-expanded-inner">
            {expandedContent}
          </div>
        </div>
      )}
    </div>
  );
}
