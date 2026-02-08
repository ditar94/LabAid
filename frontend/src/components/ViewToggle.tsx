import type { ViewMode } from "../hooks/useViewPreference";

interface ViewToggleProps {
  /** The currently active view mode. */
  view: ViewMode;
  /** Callback when the user switches modes. */
  onChange: (v: ViewMode) => void;
}

/**
 * Card / List view toggle buttons for antibody displays.
 *
 * Renders two icon buttons in a segmented control style.
 * Used in InventoryPage, SearchPage, and ScanSearchPage filter bars.
 */
export default function ViewToggle({ view, onChange }: ViewToggleProps) {
  return (
    <div className="view-toggle" role="radiogroup" aria-label="View mode">
      {/* Grid icon — 4 squares */}
      <button
        className={`view-toggle-btn${view === "card" ? " active" : ""}`}
        onClick={() => onChange("card")}
        aria-pressed={view === "card"}
        title="Card view"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
          <rect x="9" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
          <rect x="1" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
          <rect x="9" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>

      {/* List icon — 3 horizontal bars */}
      <button
        className={`view-toggle-btn${view === "list" ? " active" : ""}`}
        onClick={() => onChange("list")}
        aria-pressed={view === "list"}
        title="List view"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="1" y="1.5" width="14" height="3" rx="1" stroke="currentColor" strokeWidth="1.5" />
          <rect x="1" y="6.5" width="14" height="3" rx="1" stroke="currentColor" strokeWidth="1.5" />
          <rect x="1" y="11.5" width="14" height="3" rx="1" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
    </div>
  );
}
