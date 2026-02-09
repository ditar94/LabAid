// ── AntibodyCard — Reusable antibody display card ──────────────────────────
// Renders a single antibody as a card matching the InventoryPage design.
// Used by InventoryPage (expandable), SearchPage (selectable), and
// ScanSearchPage search mode (selectable). Each page provides its own
// expanded content via children and configures behavior via props.
//
// Layout:
//   Header  → fluoro circle, name, subtitle, designation badge, active toggle
//   Meta    → lot count, inventory alert badges
//   Submeta → vendor, catalog #
//   Counts  → sealed, opened, depleted, total
//   Labels  → expand / collapse (toggled by CSS based on .expanded)
//   Content → children rendered when expanded (lot tables, drilldowns, etc.)

import type { ReactNode } from "react";
import type { Antibody } from "../api/types";
import CopyButton from "./CopyButton";

/** Default fallback color for fluorochrome circles when no color is set. */
const DEFAULT_FLUORO_COLOR = "#9ca3af";

/** Props for a single inventory badge (Low Stock, Needs QC, Expiring, etc.). */
export interface AntibodyBadge {
  label: string;
  color: "red" | "yellow" | string;
}

interface AntibodyCardProps {
  /** The antibody data to display. */
  antibody: Antibody;
  /** Aggregate vial counts for this antibody across active lots. */
  counts: { lots: number; sealed: number; opened: number; depleted: number; total: number };
  /** Inventory alert badges (Low Stock, Needs QC, Expiring, etc.). */
  badges?: AntibodyBadge[];
  /** Resolved color for this antibody's fluorochrome (or IVD color). */
  fluoroColor?: string;
  /** If true, hide opened/depleted columns (lab's sealed_counts_only setting). */
  sealedOnly?: boolean;
  /** If true, card is in expanded state (shows children, full-width). */
  expanded?: boolean;
  /** If true, card is transitioning from expanded to collapsed. */
  collapsing?: boolean;
  /** If true, card has a selected visual state (for search pages). */
  selected?: boolean;
  /** Click handler for the card. */
  onClick?: () => void;
  /** Content rendered inside the card when expanded (lot tables, drilldowns, etc.). */
  children?: ReactNode;
  /** Inline styles for the outer div (e.g., grid positioning). */
  style?: React.CSSProperties;
  /** data-antibody-id attribute for scroll targeting. */
  dataAntibodyId?: string;

  // ── InventoryPage-specific props ──────────────────────────────────

  /** Show the active/inactive toggle switch. */
  showActiveToggle?: boolean;
  /** Callback when user clicks the active toggle. */
  onToggleActive?: () => void;
  /** Allow editing the fluorochrome color via color picker overlay. */
  canEditColor?: boolean;
  /** Callback when user changes the fluorochrome color. */
  onColorChange?: (newColor: string) => void;
}

/**
 * Reusable antibody display card.
 *
 * Renders the antibody's visual identity: color circle, name, designation
 * badge, vendor/catalog info, vial counts, and inventory alert badges.
 * Supports three interaction modes:
 *   - Expandable (InventoryPage): click toggles expanded state with children
 *   - Selectable (SearchPage): click highlights the card
 *   - Read-only: no click handler
 */
export default function AntibodyCard({
  antibody,
  counts,
  badges,
  fluoroColor,
  sealedOnly = false,
  expanded = false,
  collapsing = false,
  selected = false,
  onClick,
  children,
  style,
  dataAntibodyId,
  showActiveToggle = false,
  onToggleActive,
  canEditColor = false,
  onColorChange,
}: AntibodyCardProps) {
  // Resolve the display color: fluorochrome color → IVD color → default gray
  const displayColor = fluoroColor || antibody.color || DEFAULT_FLUORO_COLOR;

  // Build the display label: product name → "target-fluorochrome" → "Unnamed"
  const primaryLabel =
    antibody.name ||
    [antibody.target, antibody.fluorochrome].filter(Boolean).join("-") ||
    "Unnamed";

  // Subtitle: show "target - fluorochrome" when name is set and both fields exist
  const showSubtitle = antibody.name && antibody.target && antibody.fluorochrome;

  return (
    <div
      className={`inventory-card${expanded ? " expanded" : ""}${collapsing ? " collapsing" : ""}${selected ? " selected" : ""}`}
      data-antibody-id={dataAntibodyId}
      style={style}
      onClick={onClick}
    >
      {/* Corner decoration arrows (CSS-styled) */}
      <span className="corner-arrow corner-tl" />
      <span className="corner-arrow corner-tr" />
      <span className="corner-arrow corner-bl" />
      <span className="corner-arrow corner-br" />

      {/* ── Card Header: color circle, name, designation badge, active toggle ── */}
      <div className="inventory-card-header">
        <div className="inventory-title">
          {/* Fluorochrome / IVD color circle with optional color picker */}
          <div
            className={`fluoro-circle${canEditColor && antibody.fluorochrome ? " editable" : ""}`}
            style={{ backgroundColor: displayColor }}
            title={canEditColor && antibody.fluorochrome ? "Click to change color" : undefined}
          >
            {canEditColor && antibody.fluorochrome && (
              <>
                <span className="fluoro-circle-icon">&#x270E;</span>
                <input
                  type="color"
                  className="fluoro-circle-input"
                  value={fluoroColor || DEFAULT_FLUORO_COLOR}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    e.stopPropagation();
                    onColorChange?.(e.target.value);
                  }}
                />
              </>
            )}
          </div>

          {/* Antibody name + optional subtitle */}
          <span>
            {primaryLabel}
            {showSubtitle && (
              <span className="inventory-subtitle">
                {antibody.target}-{antibody.fluorochrome}
              </span>
            )}
          </span>

          {/* Designation badge (IVD / RUO / ASR) */}
          <span
            className={`badge badge-designation-${antibody.designation}`}
            style={{ fontSize: "0.7em", marginLeft: 6 }}
          >
            {antibody.designation.toUpperCase()}
          </span>
        </div>

        {/* Active/inactive toggle switch (InventoryPage only) */}
        {showActiveToggle && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <div
              className="active-switch"
              onClick={(e) => {
                e.stopPropagation();
                onToggleActive?.();
              }}
              title="Set this antibody as inactive"
            >
              <span className="active-switch-label on">Active</span>
              <div className="active-switch-track on">
                <div className="active-switch-thumb" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Meta row: lot count + inventory alert badges ── */}
      <div className="inventory-meta">
        <span>
          {counts.lots} lot{counts.lots === 1 ? "" : "s"}
        </span>
        {badges?.map((b, i) => (
          <span
            key={i}
            className={`badge badge-${b.color}`}
            style={{ fontSize: "0.75em" }}
          >
            {b.label}
          </span>
        ))}
      </div>

      {/* ── Submeta row: vendor + catalog number ── */}
      <div className="inventory-submeta">
        <span>Vendor: {antibody.vendor || "\u2014"}</span>
        <span>Catalog #: {antibody.catalog_number ? <>{antibody.catalog_number} <CopyButton value={antibody.catalog_number} /></> : "\u2014"}</span>
      </div>

      {/* ── Vial count columns ── */}
      <div className="inventory-counts">
        <div>
          <div className="count-label">Sealed</div>
          <div className="count-value">{counts.sealed}</div>
        </div>
        {!sealedOnly && (
          <div>
            <div className="count-label">Opened</div>
            <div className="count-value">{counts.opened}</div>
          </div>
        )}
        {!sealedOnly && (
          <div>
            <div className="count-label">Depleted</div>
            <div className="count-value">{counts.depleted}</div>
          </div>
        )}
        <div>
          <div className="count-label">Total</div>
          <div className="count-value">{counts.total}</div>
        </div>
      </div>

      {/* Expand/collapse label indicators (CSS toggles visibility based on .expanded) */}
      <div className="expand-label">Expand</div>
      <div className="collapse-label">Collapse</div>

      {/* ── Expanded content: lot tables, drilldowns, forms (provided by page) ── */}
      {(expanded || collapsing) && children && (
        <div className="inventory-expanded" onClick={(e) => e.stopPropagation()}>
          <div className="inventory-expanded-inner">
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
