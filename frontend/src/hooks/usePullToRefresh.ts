import { useRef, useEffect, useCallback, useState } from "react";

const THRESHOLD = 80; // px of pull distance required to trigger refresh
const MAX_PULL = 120; // max pull distance (capped)

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void> | void;
  disabled?: boolean;
}

export function usePullToRefresh({ onRefresh, disabled = false }: UsePullToRefreshOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pulling, setPulling] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startYRef = useRef(0);
  const pullingRef = useRef(false);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (disabled || refreshing) return;
    const container = containerRef.current;
    if (!container) return;

    // Only activate when scrolled to the very top
    const scrollTop = container.scrollTop ?? window.scrollY;
    if (scrollTop > 5) return;

    startYRef.current = e.touches[0].clientY;
    pullingRef.current = false;
  }, [disabled, refreshing]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (disabled || refreshing || startYRef.current === 0) return;

    const currentY = e.touches[0].clientY;
    const diff = currentY - startYRef.current;

    if (diff > 10) {
      // User is pulling down
      if (!pullingRef.current) {
        pullingRef.current = true;
        setPulling(true);
      }
      const distance = Math.min(diff * 0.5, MAX_PULL); // Rubber-band resistance
      setPullDistance(distance);
    }
  }, [disabled, refreshing]);

  const handleTouchEnd = useCallback(async () => {
    if (!pullingRef.current) return;

    if (pullDistance >= THRESHOLD && !refreshing) {
      setRefreshing(true);
      setPullDistance(THRESHOLD * 0.6); // Snap to spinner position
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
      }
    }

    setPulling(false);
    setPullDistance(0);
    pullingRef.current = false;
    startYRef.current = 0;
  }, [pullDistance, refreshing, onRefresh]);

  useEffect(() => {
    const el = containerRef.current?.closest(".main-content") ?? window;
    el.addEventListener("touchstart", handleTouchStart as EventListener, { passive: true });
    el.addEventListener("touchmove", handleTouchMove as EventListener, { passive: true });
    el.addEventListener("touchend", handleTouchEnd as EventListener);
    return () => {
      el.removeEventListener("touchstart", handleTouchStart as EventListener);
      el.removeEventListener("touchmove", handleTouchMove as EventListener);
      el.removeEventListener("touchend", handleTouchEnd as EventListener);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  const progress = Math.min(pullDistance / THRESHOLD, 1);
  const isPastThreshold = pullDistance >= THRESHOLD;

  return {
    containerRef,
    pulling,
    refreshing,
    pullDistance,
    progress,
    isPastThreshold,
  };
}
