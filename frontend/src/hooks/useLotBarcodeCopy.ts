// ── Lot Barcode Copy — shared expand/copy state for lot barcodes ─────────
// Used by LotTable (desktop) and LotCardList (mobile) to handle:
//   1. Expanding truncated barcode text on tap
//   2. Copying the full barcode to clipboard with feedback

import { useState } from "react";

/** Shared state for lot barcode expand/copy UI. */
export function useLotBarcodeCopy() {
  // Which lot's barcode is currently expanded (shown full-length)
  const [expandedBarcode, setExpandedBarcode] = useState<string | null>(null);
  // Which lot just had its barcode copied (shows checkmark for 1.5s)
  const [copiedId, setCopiedId] = useState<string | null>(null);

  /** Copy a barcode to the clipboard and show brief feedback. */
  const handleCopy = async (lotId: string, barcode: string) => {
    try {
      await navigator.clipboard.writeText(barcode);
      setCopiedId(lotId);
      // Reset the "copied" indicator after 1.5 seconds
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      /* clipboard API not available (e.g. insecure context) */
    }
  };

  return { expandedBarcode, setExpandedBarcode, copiedId, handleCopy };
}
