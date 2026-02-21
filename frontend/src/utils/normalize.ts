/**
 * Normalization utilities for cross-lab matching.
 *
 * These functions mirror the backend's normalize_for_matching() to enable
 * client-side antibody matching with shared catalog data.
 */

import type { Antibody } from "../api/types";

/**
 * Normalize a string for matching across labs.
 *
 * Transformations:
 * - Unicode normalization (handles copy-paste from PDFs)
 * - Remove spaces, hyphens, underscores, periods
 * - Convert to UPPERCASE
 *
 * Examples:
 *   "CD-45"       → "CD45"
 *   "CD 45"       → "CD45"
 *   "APC-R700"    → "APCR700"
 *   "PerCP-Cy5.5" → "PERCPCY55"
 */
export function normalizeForMatching(value: string | null | undefined): string {
  if (!value) return "";

  // Unicode normalization (matches Python's unicodedata.normalize('NFKD'))
  const normalized = value.normalize("NFKD");

  // Remove spaces, hyphens, underscores, periods; uppercase
  return normalized.toUpperCase().replace(/[\s\-_\.]+/g, "");
}

/**
 * Find an antibody that matches the given normalized target and fluorochrome.
 *
 * Used to auto-select an existing antibody when scanning a barcode that
 * has matching data in the shared vendor catalog.
 *
 * @param antibodies - List of antibodies to search
 * @param targetNormalized - Normalized target from shared catalog
 * @param fluoroNormalized - Normalized fluorochrome from shared catalog
 * @returns Matching antibody or null
 */
export function findMatchingAntibody(
  antibodies: Antibody[],
  targetNormalized: string | undefined,
  fluoroNormalized: string | undefined,
): Antibody | null {
  if (!targetNormalized || !fluoroNormalized) {
    return null;
  }

  return (
    antibodies.find((ab) => {
      const abTargetNorm = normalizeForMatching(ab.target);
      const abFluoroNorm = normalizeForMatching(ab.fluorochrome);
      return abTargetNorm === targetNormalized && abFluoroNorm === fluoroNormalized;
    }) || null
  );
}

/**
 * Check if two antibodies have equivalent target/fluorochrome values.
 *
 * Useful for detecting potential duplicates when creating new antibodies.
 */
export function areAntibodiesEquivalent(
  a: { target?: string | null; fluorochrome?: string | null },
  b: { target?: string | null; fluorochrome?: string | null },
): boolean {
  return (
    normalizeForMatching(a.target) === normalizeForMatching(b.target) &&
    normalizeForMatching(a.fluorochrome) === normalizeForMatching(b.fluorochrome)
  );
}
