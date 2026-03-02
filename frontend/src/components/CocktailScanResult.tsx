import { useState } from "react";
import api from "../api/client";
import type { ScanLookupResult } from "../api/types";
import CocktailLotCard from "./CocktailLotCard";
import CocktailRecipeCard from "./CocktailRecipeCard";
import { useToast } from "../context/ToastContext";

interface Props {
  result: ScanLookupResult;
  canReceive: boolean;
  loading: boolean;
  onLookup: (barcode: string) => void;
  onError: (msg: string) => void;
}

export default function CocktailScanResult({ result, canReceive, loading, onLookup, onError }: Props) {
  const { addToast } = useToast();
  const [depleting, setDepleting] = useState(false);

  // Recipe-only (no active lot)
  if (!result.cocktail_lot && result.cocktail_recipe) {
    return (
      <div className="scan-result-wrapper">
        <CocktailRecipeCard
          recipe={result.cocktail_recipe}
          counts={{ active: 0, pendingQC: 0, expired: 0, total: 0 }}
          expanded={true}
        >
          {result.cocktail_recipe.components.length > 0 && (
            <div style={{ marginBottom: "0.75rem" }}>
              <strong style={{ fontSize: "0.9rem" }}>Components</strong>
              <div className="table-scroll" style={{ marginTop: "0.5rem" }}>
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: "2rem" }}>#</th>
                      <th>Antibody</th>
                      <th style={{ textAlign: "right" }}>Volume (uL)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.cocktail_recipe.components
                      .sort((a, b) => a.ordinal - b.ordinal)
                      .map((comp) => (
                        <tr key={comp.id}>
                          <td>{comp.ordinal}</td>
                          <td>
                            {comp.antibody_target || comp.antibody_fluorochrome
                              ? [comp.antibody_target, comp.antibody_fluorochrome].filter(Boolean).join(" - ")
                              : comp.free_text_name
                                ? <em>{comp.free_text_name}</em>
                                : "\u2014"}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            {comp.volume_ul != null ? comp.volume_ul : "\u2014"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="info">
            No active lots for this recipe. Prepare a new lot from the Cocktails page.
          </p>
        </CocktailRecipeCard>
      </div>
    );
  }

  // Cocktail lot result
  if (!result.cocktail_lot) return null;

  const cl = result.cocktail_lot;
  const clExpired = cl.status !== "depleted" && !cl.is_archived &&
    new Date(cl.expiration_date + "T00:00:00") < new Date(new Date().toDateString());

  return (
    <div className="scan-result-wrapper">
      <CocktailLotCard
        lot={cl}
        recipe={result.cocktail_recipe}
        isExpired={clExpired}
      >
        {cl.storage_unit_name && (
          <p style={{ fontSize: "0.85rem", marginBottom: "0.5rem" }}>
            Stored: <strong>{cl.storage_unit_name}</strong>
            {cl.storage_cell_label && <> / <strong>{cl.storage_cell_label}</strong></>}
          </p>
        )}

        {cl.created_by_name && (
          <p style={{ color: "var(--text-muted)", fontSize: "0.85em", marginBottom: "0.5rem" }}>
            Prepared by: {cl.created_by_name}
          </p>
        )}

        {result.cocktail_recipe && result.cocktail_recipe.components.length > 0 && (
          <details style={{ marginBottom: "0.75rem" }}>
            <summary style={{ cursor: "pointer", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
              Recipe Details ({result.cocktail_recipe.components.length} components)
            </summary>
            <div className="table-scroll" style={{ marginTop: "0.5rem" }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: "2rem" }}>#</th>
                    <th>Component</th>
                    <th style={{ textAlign: "right" }}>Volume (uL)</th>
                  </tr>
                </thead>
                <tbody>
                  {result.cocktail_recipe.components
                    .sort((a, b) => a.ordinal - b.ordinal)
                    .map((comp) => (
                      <tr key={comp.id}>
                        <td>{comp.ordinal}</td>
                        <td>
                          {comp.antibody_target || comp.antibody_fluorochrome
                            ? [comp.antibody_target, comp.antibody_fluorochrome].filter(Boolean).join(" - ")
                            : comp.free_text_name
                              ? <em>{comp.free_text_name}</em>
                              : "\u2014"}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {comp.volume_ul != null ? comp.volume_ul : "\u2014"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </details>
        )}

        {cl.sources && cl.sources.length > 0 && (
          <details style={{ marginBottom: "0.75rem" }}>
            <summary style={{ cursor: "pointer", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
              Source Lots ({cl.sources.length})
            </summary>
            <div className="table-scroll" style={{ marginTop: "0.5rem" }}>
              <table>
                <thead>
                  <tr>
                    <th>Antibody</th>
                    <th>Source Lot</th>
                  </tr>
                </thead>
                <tbody>
                  {cl.sources.map((s) => (
                    <tr key={s.id || s.component_id}>
                      <td>{[s.antibody_target, s.antibody_fluorochrome].filter(Boolean).join(" - ") || "Unknown"}</td>
                      <td>
                        {s.source_lot_number ? (
                          <button
                            className="btn-link"
                            style={{ fontSize: "inherit", padding: 0 }}
                            onClick={() => onLookup(s.source_lot_number!)}
                          >
                            {s.source_lot_number}
                          </button>
                        ) : "\u2014"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}

        {result.older_cocktail_lots && result.older_cocktail_lots.length > 0 && (
          <div style={{ marginBottom: "0.75rem", padding: "0.5rem 0.75rem", border: "1px solid var(--warning-border, #f0c040)", borderRadius: "var(--radius-sm)", background: "var(--warning-bg, #fffde7)" }}>
            <strong style={{ fontSize: "0.85rem" }}>Use First (FEFO)</strong>
            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "0.25rem" }}>
              Other active lots expire later than this one.
            </p>
            <div className="table-scroll" style={{ marginTop: "0.5rem" }}>
              <table style={{ fontSize: "0.8rem" }}>
                <thead>
                  <tr>
                    <th>Lot #</th>
                    <th>Expires</th>
                    <th>QC</th>
                    <th>Renewals</th>
                  </tr>
                </thead>
                <tbody>
                  {result.older_cocktail_lots.map((ol) => (
                    <tr
                      key={ol.id}
                      style={{ cursor: "pointer" }}
                      onClick={() => onLookup(ol.lot_number)}
                    >
                      <td><button className="btn-link" style={{ fontSize: "inherit", padding: 0 }}>{ol.lot_number}</button></td>
                      <td>{new Date(ol.expiration_date + "T00:00:00").toLocaleDateString()}</td>
                      <td>
                        <span className={`badge ${ol.qc_status === "approved" ? "badge-green" : ol.qc_status === "failed" ? "badge-red" : "badge-yellow"}`}>
                          {ol.qc_status}
                        </span>
                      </td>
                      <td>{ol.renewal_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {canReceive && cl.status === "active" && (
          <div className="action-btns">
            <button
              className="btn-danger"
              onClick={async () => {
                setDepleting(true);
                try {
                  await api.post(`/cocktails/lots/${cl.id}/deplete`);
                  addToast("Cocktail lot depleted", "success");
                  onLookup(cl.lot_number);
                } catch (err: any) {
                  onError(err.response?.data?.detail || "Failed to deplete cocktail lot");
                } finally {
                  setDepleting(false);
                }
              }}
              disabled={loading || depleting}
            >
              Mark as Depleted
            </button>
          </div>
        )}
      </CocktailLotCard>
    </div>
  );
}
