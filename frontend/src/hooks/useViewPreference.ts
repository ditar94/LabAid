import { useState, useCallback } from "react";
import { useAuth } from "../context/AuthContext";

/** The two supported display modes for antibody lists. */
export type ViewMode = "card" | "list";

const isMobile = () => window.matchMedia("(max-width: 768px)").matches;

/**
 * Persists the user's card/list view preference in localStorage.
 *
 * Keyed by user ID so each user keeps their own preference on a shared device.
 * The `key` param lets different contexts (e.g. "inventory" vs "search") share
 * or diverge — by default they share "antibody_view" so toggling in one page
 * affects all pages.
 *
 * On mobile (<=768px), always returns "card" — list view is disabled.
 *
 * Usage:
 *   const [view, setView] = useViewPreference();
 *   <ViewToggle view={view} onChange={setView} />
 */
export function useViewPreference(key: string = "antibody_view", defaultView: ViewMode = "card") {
  const { user } = useAuth();

  // Build localStorage key scoped to the current user
  const storageKey = `labaid_view_${user?.id ?? "anon"}_${key}`;

  // Lazy initializer reads persisted preference on first render
  const [view, setViewState] = useState<ViewMode>(() => {
    if (isMobile()) return "card";
    const stored = localStorage.getItem(storageKey);
    if (stored === "card" || stored === "list") return stored;
    return defaultView;
  });

  // Persist to localStorage whenever the user toggles
  const setView = useCallback(
    (v: ViewMode) => {
      if (isMobile()) return;
      setViewState(v);
      localStorage.setItem(storageKey, v);
    },
    [storageKey]
  );

  return [view, setView] as const;
}
