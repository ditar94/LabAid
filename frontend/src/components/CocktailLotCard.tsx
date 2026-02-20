// ── CocktailLotCard — Cocktail lot scan result card ─────────────────────────
// Renders a scanned cocktail lot with distinctive Lab Chemistry aesthetic.
// Used by ScanSearchPage when scanning a cocktail lot barcode.
//
// Layout:
//   Header  → flask icon with bubbles, recipe name, gradient cocktail badge, status badges
//   Meta    → lot number, preparation date, expiration date
//   Counts  → renewals, test count (if tracked) with violet gradient
//   Content → children rendered below (sources, FEFO warning, deplete button)

import type { ReactNode } from "react";
import { FlaskConical } from "lucide-react";
import type { CocktailLot, CocktailRecipe } from "../api/types";
import InventoryCardBase from "./InventoryCardBase";

/** Format date string (YYYY-MM-DD) to locale date string. */
const formatDate = (dateStr: string | null): string => {
  if (!dateStr) return "\u2014";
  return new Date(dateStr + "T00:00:00").toLocaleDateString();
};

interface CocktailLotCardProps {
  /** The cocktail lot data to display. */
  lot: CocktailLot;
  /** The recipe this lot was prepared from (optional for display). */
  recipe?: CocktailRecipe;
  /** If true, lot is past its expiration date. */
  isExpired?: boolean;
  /** Content rendered below the card (sources table, FEFO warning, actions). */
  children?: ReactNode;
  /** Inline styles for the outer div. */
  style?: React.CSSProperties;
}

/**
 * Cocktail lot scan result card with Lab Chemistry aesthetic.
 *
 * Features:
 *   - Gradient flask icon with bubble animation
 *   - Shimmer effect on "Cocktail" badge
 *   - Violet-tinted counts grid with gradient text
 *   - Always expanded (scan results show all info immediately)
 */
export default function CocktailLotCard({
  lot,
  recipe,
  isExpired = false,
  children,
  style,
}: CocktailLotCardProps) {
  return (
    <InventoryCardBase
      expanded={true}
      style={style}
      className="cocktail-card cocktail-lot-card"
      expandedContent={
        children ? (
          <div className="cocktail-expanded-content">{children}</div>
        ) : undefined
      }
      hideExpandLabels={true}
    >
      {/* ── Card Header: flask icon, name, badges ── */}
      <div className="inventory-card-header">
        <div className="inventory-title">
          {/* Cocktail flask icon with gradient and bubbles */}
          <div className="cocktail-flask">
            <FlaskConical size={14} color="#fff" strokeWidth={2.5} />
          </div>

          {/* Recipe name */}
          <span>{recipe?.name || "Cocktail"}</span>

          {/* Cocktail type badge with shimmer */}
          <span className="cocktail-type-badge">Cocktail</span>

          {/* QC status badge */}
          <span
            className={`badge ${lot.qc_status === "approved" ? "badge-green" : lot.qc_status === "failed" ? "badge-red" : "badge-yellow"}`}
            style={{ fontSize: "0.7em", marginLeft: 4 }}
          >
            {lot.qc_status === "approved"
              ? "Approved"
              : lot.qc_status === "failed"
                ? "Failed"
                : "Pending QC"}
          </span>

          {/* Depleted badge */}
          {lot.status === "depleted" && (
            <span className="badge badge-red" style={{ fontSize: "0.7em", marginLeft: 4 }}>
              Depleted
            </span>
          )}

          {/* Archived badge */}
          {lot.is_archived && (
            <span className="badge badge-gray" style={{ fontSize: "0.7em", marginLeft: 4 }}>
              Archived
            </span>
          )}

          {/* Expired badge */}
          {isExpired && (
            <span className="badge badge-red" style={{ fontSize: "0.7em", marginLeft: 4 }}>
              Expired
            </span>
          )}
        </div>
      </div>

      {/* ── Meta row: lot number, preparation date, expiration date ── */}
      <div className="inventory-meta">
        <span>
          Lot: <strong>{lot.lot_number}</strong>
        </span>
        <span>
          Prepared: <strong>{formatDate(lot.preparation_date)}</strong>
        </span>
        <span>
          Expires: <strong>{formatDate(lot.expiration_date)}</strong>
        </span>
      </div>

      {/* ── Lot count columns (violet gradient) ── */}
      <div className="cocktail-counts">
        <div>
          <div className="count-label">Renewals</div>
          <div className="count-value">{lot.renewal_count}</div>
        </div>
        {lot.test_count != null && (
          <div>
            <div className="count-label">Tests</div>
            <div className="count-value">{lot.test_count}</div>
          </div>
        )}
      </div>
    </InventoryCardBase>
  );
}
