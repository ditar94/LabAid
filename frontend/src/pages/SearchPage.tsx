import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client";
import type {
  AntibodySearchResult,
  StorageGrid as StorageGridType,
  StorageCell,
} from "../api/types";
import StorageGrid from "../components/StorageGrid";
import OpenVialDialog from "../components/OpenVialDialog";
import BarcodeScannerButton from "../components/BarcodeScannerButton";
import { useAuth } from "../context/AuthContext";
import { useSharedData } from "../context/SharedDataContext";

export default function SearchPage() {
  const { user } = useAuth();
  const { fluorochromes } = useSharedData();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AntibodySearchResult[]>([]);
  const [selectedResult, setSelectedResult] =
    useState<AntibodySearchResult | null>(null);
  const [grids, setGrids] = useState<Map<string, StorageGridType>>(new Map());
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [openTarget, setOpenTarget] = useState<StorageCell | null>(null);
  const [openLoading, setOpenLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const canOpen =
    user?.role === "super_admin" ||
    user?.role === "lab_admin" ||
    user?.role === "supervisor" ||
    user?.role === "tech";

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSearch = async (override?: string) => {
    const q = (override ?? query).trim();
    if (!q) return;
    setLoading(true);
    setSelectedResult(null);
    setGrids(new Map());
    setSearched(true);
    try {
      const res = await api.get("/antibodies/search", {
        params: { q },
      });
      setResults(res.data);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSearch();
    }
  };

  const handleSelect = async (result: AntibodySearchResult) => {
    setSelectedResult(result);

    if (result.storage_locations.length === 0) {
      setGrids(new Map());
      return;
    }

    const newGrids = new Map<string, StorageGridType>();
    await Promise.all(
      result.storage_locations.map(async (loc) => {
        try {
          const res = await api.get(`/storage/units/${loc.unit_id}/grid`);
          newGrids.set(loc.unit_id, res.data);
        } catch {
          // Skip units that fail to load
        }
      })
    );
    setGrids(newGrids);
  };

  const handleGridCellClick = (cell: StorageCell) => {
    if (!cell.vial || (cell.vial.status !== "sealed" && cell.vial.status !== "opened")) return;
    setOpenTarget(cell);
  };

  const handleOpenVial = async (force: boolean) => {
    if (!openTarget?.vial) return;
    setOpenLoading(true);
    try {
      await api.post(`/vials/${openTarget.vial.id}/open?force=${force}`, {
        cell_id: openTarget.id,
      });
      setMessage(`Vial opened from cell ${openTarget.label}. Status updated.`);
      setOpenTarget(null);
      // Refresh grids
      if (selectedResult) await handleSelect(selectedResult);
    } catch (err: any) {
      setMessage(null);
      setOpenTarget(null);
    } finally {
      setOpenLoading(false);
    }
  };

  const handleDepleteVial = async () => {
    if (!openTarget?.vial) return;
    setOpenLoading(true);
    try {
      await api.post(`/vials/${openTarget.vial.id}/deplete`);
      setMessage(`Vial depleted from cell ${openTarget.label}. Status updated.`);
      setOpenTarget(null);
      if (selectedResult) await handleSelect(selectedResult);
    } catch (err: any) {
      setMessage(null);
      setOpenTarget(null);
    } finally {
      setOpenLoading(false);
    }
  };

  return (
    <div>
      <h1>Antibody Search</h1>
      <p className="page-desc">
        Search by target, fluorochrome, clone, catalog number, or product name
        to find antibodies and locate them in storage.
      </p>

      <div className="scan-input-container">
        <input
          ref={inputRef}
          className="scan-input"
          placeholder="Search antibodies..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        <BarcodeScannerButton
          onDetected={(value) => {
            setQuery(value);
            handleSearch(value);
          }}
          disabled={loading}
        />
        <button onClick={() => handleSearch()} disabled={loading}>
          {loading ? "Searching..." : "Search"}
        </button>
      </div>

      {message && <p className="success">{message}</p>}

      {searched && !loading && results.length === 0 && (
        <p className="empty">No antibodies found matching "{query}"</p>
      )}

      {results.length > 0 && (
        <table className="search-results-table">
          <thead>
            <tr>
              <th>Product Name</th>
              <th>Target</th>
              <th>Fluorochrome</th>
              <th>Clone</th>
              <th>Catalog #</th>
              <th>Sealed</th>
              <th>Opened</th>
              <th>Depleted</th>
              <th>Lots</th>
              <th>Locations</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr
                key={r.antibody.id}
                className={`clickable-row ${
                  selectedResult?.antibody.id === r.antibody.id ? "active" : ""
                }`}
                onClick={() => handleSelect(r)}
              >
                <td>{r.antibody.name || "—"}</td>
                <td>{r.antibody.target || "—"}</td>
                <td>{r.antibody.fluorochrome || "—"}</td>
                <td>{r.antibody.clone || "—"}</td>
                <td>{r.antibody.catalog_number || "—"}</td>
                <td>{r.total_vial_counts.sealed}</td>
                <td>{r.total_vial_counts.opened}</td>
                <td>{r.total_vial_counts.depleted}</td>
                <td>{r.lots.length}</td>
                <td>{r.storage_locations.length > 0 ? r.storage_locations.map((l) => l.unit_name).join(", ") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selectedResult && (
        <div className="locator-panel">
          <h2>
            {selectedResult.antibody.name || [selectedResult.antibody.target, selectedResult.antibody.fluorochrome].filter(Boolean).join(" - ") || "Unnamed"}
          </h2>

          {selectedResult.lots.length > 0 && (
            <div className="lot-summaries">
              {selectedResult.lots.map((lot) => (
                <div key={lot.id} className="lot-summary-item">
                  <span className="lot-summary-number">
                    Lot {lot.lot_number}
                  </span>
                  <span
                    className={`badge ${
                      lot.qc_status === "approved"
                        ? "badge-green"
                        : lot.qc_status === "failed"
                        ? "badge-red"
                        : "badge-yellow"
                    }`}
                  >
                    {lot.qc_status}
                  </span>
                  <span className="lot-summary-counts">
                    {lot.vial_counts.sealed} sealed, {lot.vial_counts.opened}{" "}
                    opened
                  </span>
                  {lot.expiration_date && (
                    <span className="lot-summary-exp">
                      Exp: {lot.expiration_date}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {selectedResult.storage_locations.length === 0 ? (
            <p className="empty">
              No vials currently in storage for this antibody.
            </p>
          ) : (
            selectedResult.storage_locations.map((loc) => {
              const grid = grids.get(loc.unit_id);
              if (!grid) return null;

              const highlightIds = new Set(loc.vial_ids);

              return (
                <div key={loc.unit_id} className="grid-container">
                  <h3>
                    {loc.unit_name}
                    {loc.temperature ? ` (${loc.temperature})` : ""}
                  </h3>
                  <StorageGrid
                    rows={grid.unit.rows}
                    cols={grid.unit.cols}
                    cells={grid.cells}
                    highlightVialIds={highlightIds}
                    onCellClick={canOpen ? handleGridCellClick : undefined}
                    clickMode={canOpen ? "occupied" : "highlighted"}
                    fluorochromes={fluorochromes}
                  />
                  <div className="grid-legend">
                    <span className="legend-item"><span className="legend-box sealed" /> Sealed</span>
                    <span className="legend-item"><span className="legend-box opened" /> Opened</span>
                    <span className="legend-item"><span className="legend-box" /> Empty</span>
                    <span className="legend-item"><span className="legend-box highlighted-legend" /> Current antibody</span>
                    {canOpen && <span className="legend-item">Click a vial to open or deplete it</span>}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {openTarget && (
        <OpenVialDialog
          cell={openTarget}
          loading={openLoading}
          onConfirm={handleOpenVial}
          onDeplete={handleDepleteVial}
          onViewLot={() => {
            const abId = openTarget.vial?.antibody_id;
            setOpenTarget(null);
            if (abId) navigate(`/inventory?antibodyId=${abId}`);
          }}
          onCancel={() => setOpenTarget(null)}
        />
      )}
    </div>
  );
}
