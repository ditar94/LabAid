import type { LotFilter, StockControl } from "./types";

interface LotPanelProps {
  lotFilter: LotFilter;
  stockControl?: StockControl;
  unstoredCount: number;
  loading: boolean;
  hasGrids: boolean;
}

export default function LotPanel({
  lotFilter,
  stockControl,
  unstoredCount,
  loading,
  hasGrids,
}: LotPanelProps) {
  return (
    <>
      <h4>Storage for Lot {lotFilter.lotNumber}</h4>
      {loading && <p className="info">&nbsp;</p>}
      {!hasGrids && !loading && (
        <p className="empty">No vials in storage for this lot.</p>
      )}

      {stockControl && unstoredCount > 0 && !loading && (
        <div className="lot-drilldown-stock">
          <span>{unstoredCount} unstored vial{unstoredCount !== 1 ? "s" : ""}.</span>
          {stockControl.hasVendorBarcode ? (
            <>
              <select value={stockControl.stockUnitId} onChange={(e) => stockControl.onStockUnitChange(e.target.value)}>
                <option value="">Select storage unit</option>
                {stockControl.storageUnits.filter((u) => !u.is_temporary).map((u) => (
                  <option key={u.id} value={u.id}>{u.name} ({u.rows}x{u.cols})</option>
                ))}
              </select>
              <button disabled={!stockControl.stockUnitId || stockControl.stockLoading} onClick={stockControl.onStock}>
                {stockControl.stockLoading ? "Stocking..." : "Stock 1 Vial"}
              </button>
            </>
          ) : (
            <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
              Set vendor barcode to enable stocking.
            </span>
          )}
        </div>
      )}
    </>
  );
}
