import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client";
import type { GlobalSearchResult } from "../api/types";
import { Search, Building2, FlaskConical, TestTubes } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

export default function GlobalSearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const { startImpersonation } = useAuth();
  const { addToast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults(null);
      setSearched(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.get<GlobalSearchResult>("/search/global", {
          params: { q: query.trim() },
        });
        setResults(res.data);
        setSearched(true);
      } catch {
        setResults(null);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const handleEnterLab = async (labId: string, path = "/") => {
    try {
      await startImpersonation(labId);
      navigate(path);
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Cannot enter lab", "danger");
    }
  };

  const totalResults =
    results
      ? results.labs.length + results.antibodies.length + results.lots.length
      : 0;

  return (
    <div>
      <div className="page-header">
        <h1>Global Search</h1>
      </div>
      <p className="page-desc">
        Search across all labs for labs, antibodies, and lots.
      </p>

      <div className="scan-search-bar" style={{ maxWidth: 600, marginBottom: "var(--space-xl)" }}>
        <Search size={18} style={{ color: "var(--neutral-400)", flexShrink: 0 }} />
        <input
          type="text"
          placeholder="Search by lab name, antibody target, lot number, catalog #..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>

      {loading && (
        <div className="stagger-reveal">
          <div className="skeleton skeleton-row" />
          <div className="skeleton skeleton-row" />
          <div className="skeleton skeleton-row" />
        </div>
      )}

      {!loading && searched && totalResults === 0 && (
        <div className="empty-state">
          <Search size={40} strokeWidth={1.5} />
          <h3>No results found</h3>
          <p>Try a different search term.</p>
        </div>
      )}

      {!loading && results && results.labs.length > 0 && (
        <div style={{ marginBottom: "var(--space-xl)" }}>
          <h3 className="section-heading">
            <Building2 size={16} style={{ marginRight: 6, verticalAlign: -2 }} />
            Labs ({results.labs.length})
          </h3>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {results.labs.map((lab) => (
                <tr key={lab.id}>
                  <td>{lab.name}</td>
                  <td>
                    <span className={`badge ${lab.is_active ? "badge-success" : "badge-danger"}`}>
                      {lab.is_active ? "Active" : "Suspended"}
                    </span>
                  </td>
                  <td>
                    <button
                      className="btn-sm"
                      onClick={() => handleEnterLab(lab.id)}
                    >
                      Enter Lab
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && results && results.antibodies.length > 0 && (
        <div style={{ marginBottom: "var(--space-xl)" }}>
          <h3 className="section-heading">
            <FlaskConical size={16} style={{ marginRight: 6, verticalAlign: -2 }} />
            Antibodies ({results.antibodies.length})
          </h3>
          <table>
            <thead>
              <tr>
                <th>Target</th>
                <th>Fluorochrome</th>
                <th>Designation</th>
                <th>Clone</th>
                <th>Catalog #</th>
                <th>Lab</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {results.antibodies.map((ab) => (
                <tr key={ab.id}>
                  <td>
                    {ab.target}
                    {ab.components && ab.components.length > 0 && (
                      <span className="component-list">Contains: {ab.components.map(c => `${c.target}-${c.fluorochrome}`).join(", ")}</span>
                    )}
                  </td>
                  <td>{ab.fluorochrome}</td>
                  <td><span className={`badge badge-designation-${ab.designation}`}>{ab.designation.toUpperCase()}</span></td>
                  <td>{ab.clone || "—"}</td>
                  <td style={{ fontFamily: "var(--font-mono)" }}>{ab.catalog_number || "—"}</td>
                  <td>
                    <span className="badge badge-info">{ab.lab_name}</span>
                  </td>
                  <td>
                    <button
                      className="btn-sm"
                      onClick={() => handleEnterLab(ab.lab_id, "/inventory")}
                    >
                      View in Lab
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && results && results.lots.length > 0 && (
        <div style={{ marginBottom: "var(--space-xl)" }}>
          <h3 className="section-heading">
            <TestTubes size={16} style={{ marginRight: 6, verticalAlign: -2 }} />
            Lots ({results.lots.length})
          </h3>
          <table>
            <thead>
              <tr>
                <th>Lot #</th>
                <th>Antibody</th>
                <th>QC Status</th>
                <th>Lab</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {results.lots.map((lot) => (
                <tr key={lot.id}>
                  <td style={{ fontFamily: "var(--font-mono)" }}>{lot.lot_number}</td>
                  <td>
                    {lot.antibody_target && lot.antibody_fluorochrome
                      ? `${lot.antibody_target}-${lot.antibody_fluorochrome}`
                      : "—"}
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        lot.qc_status === "approved"
                          ? "badge-success"
                          : lot.qc_status === "failed"
                          ? "badge-danger"
                          : "badge-warning"
                      }`}
                    >
                      {lot.qc_status}
                    </span>
                  </td>
                  <td>
                    <span className="badge badge-info">{lot.lab_name}</span>
                  </td>
                  <td>
                    <button
                      className="btn-sm"
                      onClick={() => handleEnterLab(lot.lab_id, "/inventory")}
                    >
                      View in Lab
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
