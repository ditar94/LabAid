import { useMemo } from "react";
import type { Fluorochrome } from "../api/types";

export function useFluoroMap(fluorochromes: Fluorochrome[]): Map<string, string> {
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const f of fluorochromes) {
      map.set(f.name.toLowerCase(), f.color);
    }
    return map;
  }, [fluorochromes]);
}
