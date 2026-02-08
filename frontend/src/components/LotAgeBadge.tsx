// ── Lot Age Badge — shows "Current" or "New" based on FEFO ordering ─────
// "Current" = the lot that should be used next (oldest expiration).
// "New" = a newer lot that arrived more recently.
// Used by: LotTable, LotCardList, ScanSearchPage scan mode.

interface LotAgeBadgeProps {
  /** "current" for the active FEFO lot, "new" for newer lots, null/undefined to hide. */
  age: "current" | "new" | undefined | null;
}

/** Small inline badge indicating lot age relative to FEFO ordering. */
export default function LotAgeBadge({ age }: LotAgeBadgeProps) {
  if (!age) return null;

  // Current lot = green badge (use this one first)
  if (age === "current") {
    return (
      <span className="badge badge-green" style={{ marginLeft: 6, fontSize: "0.7em" }}>
        Current
      </span>
    );
  }

  // New lot = gray badge (arrived recently, use after current)
  return (
    <span
      className="badge"
      style={{ marginLeft: 6, fontSize: "0.7em", background: "#6b7280", color: "#fff" }}
    >
      New
    </span>
  );
}
