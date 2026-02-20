import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type {
  Antibody,
  CocktailLot,
  CocktailRecipe,
  CocktailRecipeWithLots,
} from "../api/types";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useSharedData } from "../context/SharedDataContext";
import EmptyState from "../components/EmptyState";
import { CocktailRecipeForm, type CocktailRecipeFormValues } from "../components/CocktailRecipeForm";
import { CocktailLotPreparationForm } from "../components/CocktailLotPreparationForm";
import { CocktailDocumentModal } from "../components/CocktailDocumentModal";
import { Beaker } from "lucide-react";

export default function CocktailsPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const { selectedLab } = useSharedData();
  const queryClient = useQueryClient();

  // Role helpers
  const canEdit = user?.role === "super_admin" || user?.role === "lab_admin" || user?.role === "supervisor";
  const canPrepare = canEdit || user?.role === "tech";
  const isReadOnly = user?.role === "read_only";

  // State
  const [expandedRecipeId, setExpandedRecipeId] = useState<string | null>(null);
  const [expandedLotId, setExpandedLotId] = useState<string | null>(null);
  const [showRecipeForm, setShowRecipeForm] = useState(false);
  const [editRecipe, setEditRecipe] = useState<CocktailRecipe | null>(null);
  const [prepareRecipe, setPrepareRecipe] = useState<CocktailRecipe | null>(null);
  const [recipeFormLoading, setRecipeFormLoading] = useState(false);
  const [prepareLoading, setPrepareLoading] = useState(false);
  const [docModalLotId, setDocModalLotId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [archivePrompt, setArchivePrompt] = useState<{ lotId: string; lotNumber: string } | null>(null);
  const [archiveNote, setArchiveNote] = useState("");
  const [archiveLoading, setArchiveLoading] = useState(false);

  // Antibodies for recipe form
  const [antibodies, setAntibodies] = useState<Antibody[]>([]);

  useEffect(() => {
    if (!selectedLab) return;
    api
      .get<Antibody[]>("/antibodies/", { params: { lab_id: selectedLab } })
      .then((r) => setAntibodies(r.data))
      .catch(() => {});
  }, [selectedLab]);

  // Data
  const { data: recipes = [], isLoading } = useQuery<CocktailRecipeWithLots[]>({
    queryKey: ["cocktail-recipes"],
    queryFn: () =>
      api
        .get<CocktailRecipeWithLots[]>("/cocktails/recipes", {
          params: { include_lots: "true" },
        })
        .then((r) => r.data),
    enabled: !!selectedLab,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["cocktail-recipes"] });

  // Collapse lot detail when switching recipe
  useEffect(() => {
    setExpandedLotId(null);
  }, [expandedRecipeId]);

  // ESC closes topmost modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (docModalLotId) { setDocModalLotId(null); return; }
      if (archivePrompt) { setArchivePrompt(null); return; }
      if (prepareRecipe) { setPrepareRecipe(null); return; }
      if (editRecipe) { setEditRecipe(null); return; }
      if (showRecipeForm) { setShowRecipeForm(false); return; }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [docModalLotId, archivePrompt, prepareRecipe, editRecipe, showRecipeForm]);

  // Sort recipes: active first, then alphabetically
  const sortedRecipes = useMemo(() => {
    return [...recipes].sort((a, b) => {
      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [recipes]);

  // ── Recipe handlers ────────────────────────────────────────────────

  const handleCreateRecipe = async (values: CocktailRecipeFormValues) => {
    setRecipeFormLoading(true);
    try {
      await api.post("/cocktails/recipes", {
        name: values.name.trim(),
        description: values.description.trim() || null,
        shelf_life_days: parseInt(values.shelf_life_days, 10),
        max_renewals: values.max_renewals ? parseInt(values.max_renewals, 10) : null,
        components: values.components.map((c, i) => ({
          antibody_id: c.antibody_id || null,
          free_text_name: c.free_text_name?.trim() || null,
          volume_ul: c.volume_ul ? parseFloat(c.volume_ul) : null,
          ordinal: i + 1,
        })),
      });
      setShowRecipeForm(false);
      addToast("Recipe created.", "success");
      invalidate();
    } catch (err: any) {
      throw err;
    } finally {
      setRecipeFormLoading(false);
    }
  };

  const handleEditRecipe = async (values: CocktailRecipeFormValues) => {
    if (!editRecipe) return;
    setRecipeFormLoading(true);
    try {
      await api.patch(`/cocktails/recipes/${editRecipe.id}`, {
        name: values.name.trim(),
        description: values.description.trim() || null,
        shelf_life_days: parseInt(values.shelf_life_days, 10),
        max_renewals: values.max_renewals ? parseInt(values.max_renewals, 10) : null,
        components: values.components.map((c, i) => ({
          antibody_id: c.antibody_id || null,
          free_text_name: c.free_text_name?.trim() || null,
          volume_ul: c.volume_ul ? parseFloat(c.volume_ul) : null,
          ordinal: i + 1,
        })),
      });
      setEditRecipe(null);
      addToast("Recipe updated.", "success");
      invalidate();
    } catch (err: any) {
      throw err;
    } finally {
      setRecipeFormLoading(false);
    }
  };

  const openEditRecipeForm = (recipe: CocktailRecipe) => {
    setEditRecipe(recipe);
  };

  const editRecipeInitialValues = useMemo((): CocktailRecipeFormValues | undefined => {
    if (!editRecipe) return undefined;
    return {
      name: editRecipe.name,
      description: editRecipe.description || "",
      shelf_life_days: String(editRecipe.shelf_life_days),
      max_renewals: editRecipe.max_renewals != null ? String(editRecipe.max_renewals) : "",
      components: editRecipe.components.length > 0
        ? editRecipe.components
            .sort((a, b) => a.ordinal - b.ordinal)
            .map((c) => ({
              antibody_id: c.antibody_id || "",
              volume_ul: c.volume_ul != null ? String(c.volume_ul) : "",
              free_text_name: c.free_text_name || "",
            }))
        : [{ antibody_id: "", volume_ul: "", free_text_name: "" }],
    };
  }, [editRecipe]);

  // ── Lot preparation ────────────────────────────────────────────────

  const handlePrepareLot = async (values: {
    recipe_id: string;
    lot_number: string;
    preparation_date: string;
    expiration_date: string;
    sources: { component_id: string; source_lot_id: string }[];
  }) => {
    setPrepareLoading(true);
    try {
      await api.post("/cocktails/lots", values);
      setPrepareRecipe(null);
      addToast("Cocktail lot prepared.", "success");
      invalidate();
    } catch (err: any) {
      throw err;
    } finally {
      setPrepareLoading(false);
    }
  };

  // ── Lot actions ────────────────────────────────────────────────────

  const handleQC = async (lotId: string, qcStatus: "approved" | "failed") => {
    setActionLoading(lotId);
    try {
      await api.patch(`/cocktails/lots/${lotId}/qc`, { qc_status: qcStatus });
      addToast(qcStatus === "approved" ? "Lot approved." : "Lot marked as failed.", "success");
      invalidate();
    } catch (err: any) {
      addToast(err.response?.data?.detail || "QC update failed.", "danger");
    } finally {
      setActionLoading(null);
    }
  };

  const handleRenew = async (lotId: string) => {
    setActionLoading(lotId);
    try {
      await api.post(`/cocktails/lots/${lotId}/renew`);
      addToast("Lot renewed.", "success");
      invalidate();
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Renewal failed.", "danger");
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeplete = async (lotId: string) => {
    setActionLoading(lotId);
    try {
      await api.post(`/cocktails/lots/${lotId}/deplete`);
      addToast("Lot depleted.", "success");
      invalidate();
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Deplete failed.", "danger");
    } finally {
      setActionLoading(null);
    }
  };

  const handleArchive = async (lotId: string, note?: string) => {
    setArchiveLoading(true);
    try {
      await api.patch(`/cocktails/lots/${lotId}/archive`, note ? { note } : undefined);
      addToast("Lot archived.", "success");
      setArchivePrompt(null);
      setArchiveNote("");
      invalidate();
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Archive failed.", "danger");
    } finally {
      setArchiveLoading(false);
    }
  };

  // ── Render helpers ─────────────────────────────────────────────────

  const qcBadge = (status: string) => {
    if (status === "approved") return <span className="badge badge-green">Approved</span>;
    if (status === "failed") return <span className="badge badge-red">Failed</span>;
    return <span className="badge badge-yellow">Pending QC</span>;
  };

  const statusBadge = (lot: CocktailLot) => {
    if (lot.is_archived) return <span className="badge badge-gray">Archived</span>;
    if (lot.status === "depleted") return <span className="badge badge-red">Depleted</span>;
    return <span className="badge badge-green">Active</span>;
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "\u2014";
    return new Date(dateStr + "T00:00:00").toLocaleDateString();
  };

  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return "\u2014";
    return new Date(dateStr).toLocaleString();
  };

  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  /** Compute FEFO badges for cocktail lots: among active non-archived lots sorted by expiration, first = Current, rest = New. */
  const computeLotBadgeMap = (lots: CocktailLot[]): Map<string, "current" | "new"> => {
    const eligible = lots
      .filter((l) => !l.is_archived && l.status !== "depleted")
      .sort((a, b) => {
        if (!a.expiration_date && !b.expiration_date) return 0;
        if (!a.expiration_date) return 1;
        if (!b.expiration_date) return -1;
        return new Date(a.expiration_date).getTime() - new Date(b.expiration_date).getTime();
      });
    const badgeMap = new Map<string, "current" | "new">();
    if (eligible.length >= 2) {
      for (const lot of eligible) {
        badgeMap.set(lot.id, lot === eligible[0] ? "current" : "new");
      }
    }
    return badgeMap;
  };

  // ── Lot detail panel ───────────────────────────────────────────────

  const renderLotDetail = (lot: CocktailLot) => {
    const isLotLoading = actionLoading === lot.id;
    const canRenew =
      canEdit &&
      lot.qc_status === "approved" &&
      lot.status === "active" &&
      !lot.is_archived &&
      (lot.renewal_count < (recipes.find((r) => r.id === lot.recipe_id)?.max_renewals ?? Infinity));

    return (
      <div style={{ padding: "0.75rem", borderTop: "1px solid var(--border)" }}>
        {/* Source traceability */}
        {lot.sources && lot.sources.length > 0 && (
          <div style={{ marginBottom: "0.75rem" }}>
            <strong>Source Lots:</strong>
            <table style={{ width: "100%", marginTop: "0.25rem", fontSize: "0.85rem" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Antibody</th>
                  <th style={{ textAlign: "left" }}>Lot #</th>
                </tr>
              </thead>
              <tbody>
                {lot.sources.map((src) => (
                  <tr key={src.id}>
                    <td>
                      {[src.antibody_target, src.antibody_fluorochrome]
                        .filter(Boolean)
                        .join(" - ") || "\u2014"}
                    </td>
                    <td>{src.source_lot_number || "\u2014"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Metadata */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", fontSize: "0.85rem", marginBottom: "0.75rem" }}>
          {lot.created_by_name && (
            <span>
              <strong>Prepared by:</strong> {lot.created_by_name}
            </span>
          )}
          {lot.storage_unit_name && (
            <span>
              <strong>Location:</strong> {lot.storage_unit_name}
              {lot.storage_cell_label ? ` / ${lot.storage_cell_label}` : ""}
            </span>
          )}
          {lot.last_renewed_at && (
            <span>
              <strong>Last renewed:</strong> {formatDateTime(lot.last_renewed_at)}
            </span>
          )}
          {lot.qc_approved_at && (
            <span>
              <strong>QC approved:</strong> {formatDateTime(lot.qc_approved_at)}
            </span>
          )}
          {lot.archive_note && (
            <span>
              <strong>Archive note:</strong> {lot.archive_note}
            </span>
          )}
        </div>

        {/* Actions */}
        {!isReadOnly && (
          <div className="action-btns" style={{ flexWrap: "wrap" }}>
            {/* QC approve - supervisor+ only */}
            {canEdit && lot.qc_status === "pending" && !lot.is_archived && (
              <button
                className="btn-sm btn-green"
                onClick={() => handleQC(lot.id, "approved")}
                disabled={isLotLoading}
              >
                Approve QC
              </button>
            )}

            {/* Renew - supervisor+ */}
            {canRenew && (
              <button
                className="btn-sm btn-secondary"
                onClick={() => handleRenew(lot.id)}
                disabled={isLotLoading}
              >
                Renew
              </button>
            )}

            {/* Deplete - tech+ */}
            {canPrepare && lot.status === "active" && !lot.is_archived && (
              <button
                className="btn-sm btn-danger"
                onClick={() => handleDeplete(lot.id)}
                disabled={isLotLoading}
              >
                Deplete
              </button>
            )}

            {/* Documents */}
            <button
              className="btn-sm btn-secondary"
              onClick={() => setDocModalLotId(lot.id)}
            >
              Documents{lot.has_qc_document ? " (QC)" : ""}
            </button>

            {/* Archive - supervisor+ */}
            {canEdit && !lot.is_archived && lot.status !== "depleted" && (
              <button
                className="btn-sm btn-secondary"
                onClick={() => {
                  setArchiveNote("");
                  setArchivePrompt({ lotId: lot.id, lotNumber: lot.lot_number });
                }}
                disabled={isLotLoading}
              >
                Archive
              </button>
            )}

            {/* Unarchive */}
            {canEdit && lot.is_archived && (
              <button
                className="btn-sm btn-secondary"
                onClick={() => handleArchive(lot.id)}
                disabled={isLotLoading}
              >
                Unarchive
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── Main render ────────────────────────────────────────────────────

  return (
    <div>
      <div className="page-header">
        <h1>Cocktails</h1>
        <div className="filters">
          {canEdit && (
            <button onClick={() => setShowRecipeForm(true)}>+ New Recipe</button>
          )}
        </div>
      </div>

      {isLoading && <p className="page-desc">Loading recipes...</p>}

      {!isLoading && sortedRecipes.length === 0 && (
        <EmptyState
          icon={Beaker}
          title="No cocktail recipes"
          description="Create a recipe to start tracking cocktail preparations."
        />
      )}

      {sortedRecipes.map((recipe) => {
        const isExpanded = expandedRecipeId === recipe.id;
        const componentLabel = recipe.components.length === 1
          ? "1 component"
          : `${recipe.components.length} components`;

        return (
          <div key={recipe.id} className="card" style={{ marginBottom: "0.75rem" }}>
            {/* Recipe header (collapsed view) */}
            <div
              className="card-header"
              style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}
              onClick={() => setExpandedRecipeId(isExpanded ? null : recipe.id)}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                <strong>{recipe.name}</strong>
                {!recipe.is_active && <span className="badge badge-gray">Inactive</span>}
                <span className="badge badge-gray">{componentLabel}</span>
                <span className="badge badge-green">
                  {recipe.active_lot_count} active lot{recipe.active_lot_count === 1 ? "" : "s"}
                </span>
                <span className="badge badge-yellow">
                  {recipe.shelf_life_days}d shelf life
                </span>
                {recipe.max_renewals != null && (
                  <span className="badge badge-gray">
                    max {recipe.max_renewals} renewal{recipe.max_renewals === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              <span style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>
                {isExpanded ? "Collapse" : "Expand"}
              </span>
            </div>

            {/* Expanded content */}
            {isExpanded && (
              <div className="card-body">
                {/* Recipe description */}
                {recipe.description && (
                  <p className="page-desc" style={{ marginBottom: "0.75rem" }}>
                    {recipe.description}
                  </p>
                )}

                {/* Action buttons for recipe */}
                <div className="action-btns" style={{ marginBottom: "0.75rem", flexWrap: "wrap" }}>
                  {canEdit && (
                    <button
                      className="btn-sm btn-secondary"
                      onClick={() => openEditRecipeForm(recipe)}
                    >
                      Edit Recipe
                    </button>
                  )}
                  {canPrepare && recipe.is_active && (
                    <button
                      className="btn-sm btn-green"
                      onClick={() => setPrepareRecipe(recipe)}
                    >
                      Prepare Lot
                    </button>
                  )}
                </div>

                {/* Component table */}
                <div style={{ marginBottom: "1rem" }}>
                  <strong style={{ fontSize: "0.9rem" }}>Components</strong>
                  <table style={{ width: "100%", marginTop: "0.25rem", fontSize: "0.85rem" }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left", width: "2rem" }}>#</th>
                        <th style={{ textAlign: "left" }}>Antibody</th>
                        <th style={{ textAlign: "right" }}>Volume (uL)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recipe.components
                        .sort((a, b) => a.ordinal - b.ordinal)
                        .map((comp) => (
                          <tr key={comp.id}>
                            <td>{comp.ordinal}</td>
                            <td>
                              {comp.antibody_target || comp.antibody_fluorochrome
                                ? [comp.antibody_target, comp.antibody_fluorochrome]
                                    .filter(Boolean)
                                    .join(" - ")
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

                {/* Lots */}
                <strong style={{ fontSize: "0.9rem" }}>
                  Lots ({recipe.lots.length})
                </strong>

                {recipe.lots.length === 0 ? (
                  <p className="page-desc" style={{ marginTop: "0.25rem" }}>
                    No lots prepared yet.
                  </p>
                ) : (() => {
                  const lotBadgeMap = computeLotBadgeMap(recipe.lots);
                  return isMobile ? (
                  /* Mobile: card layout */
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.5rem" }}>
                    {recipe.lots.map((lot) => {
                      const isLotExpanded = expandedLotId === lot.id;
                      return (
                        <div
                          key={lot.id}
                          style={{
                            border: "1px solid var(--border)",
                            borderLeft: isLotExpanded ? "3px solid var(--primary)" : "1px solid var(--border)",
                            borderRadius: "var(--radius-sm)",
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              alignItems: "center",
                              gap: "0.5rem",
                              padding: "0.5rem 0.75rem",
                              cursor: "pointer",
                              background: isLotExpanded ? "var(--bg-secondary)" : undefined,
                            }}
                            onClick={() => setExpandedLotId(isLotExpanded ? null : lot.id)}
                          >
                            <strong style={{ flex: 1 }}>
                              {lot.lot_number}
                              {lotBadgeMap.get(lot.id) === "current" && (
                                <span className="badge badge-blue" style={{ marginLeft: 6, fontSize: "0.7em" }}>Current</span>
                              )}
                              {lotBadgeMap.get(lot.id) === "new" && (
                                <span className="badge badge-yellow" style={{ marginLeft: 6, fontSize: "0.7em" }}>New</span>
                              )}
                            </strong>
                            {qcBadge(lot.qc_status)}
                            {statusBadge(lot)}
                          </div>
                          <div
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              gap: "0.75rem",
                              padding: "0 0.75rem 0.5rem",
                              fontSize: "0.85rem",
                              color: "var(--text-secondary)",
                            }}
                          >
                            <span>Prep: {formatDate(lot.preparation_date)}</span>
                            <span>Exp: {formatDate(lot.expiration_date)}</span>
                            {lot.renewal_count > 0 && (
                              <span>Renewals: {lot.renewal_count}</span>
                            )}
                          </div>
                          {isLotExpanded && renderLotDetail(lot)}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* Desktop: table layout */
                  <table style={{ width: "100%", marginTop: "0.5rem", fontSize: "0.85rem" }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left" }}>Lot #</th>
                        <th style={{ textAlign: "left" }}>Prepared</th>
                        <th style={{ textAlign: "left" }}>Expires</th>
                        <th style={{ textAlign: "left" }}>QC</th>
                        <th style={{ textAlign: "left" }}>Status</th>
                        <th style={{ textAlign: "right" }}>Renewals</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recipe.lots.map((lot) => {
                        const isLotExpanded = expandedLotId === lot.id;
                        return (
                          <Fragment key={lot.id}>
                            <tr
                              style={{
                                cursor: "pointer",
                                background: isLotExpanded ? "var(--bg-secondary)" : undefined,
                                fontWeight: isLotExpanded ? 600 : undefined,
                                borderLeft: isLotExpanded ? "3px solid var(--primary)" : "3px solid transparent",
                              }}
                              onClick={() =>
                                setExpandedLotId(isLotExpanded ? null : lot.id)
                              }
                            >
                              <td>
                                <strong>{lot.lot_number}</strong>
                                {lotBadgeMap.get(lot.id) === "current" && (
                                  <span className="badge badge-blue" style={{ marginLeft: 6, fontSize: "0.7em" }}>Current</span>
                                )}
                                {lotBadgeMap.get(lot.id) === "new" && (
                                  <span className="badge badge-yellow" style={{ marginLeft: 6, fontSize: "0.7em" }}>New</span>
                                )}
                              </td>
                              <td>{formatDate(lot.preparation_date)}</td>
                              <td>{formatDate(lot.expiration_date)}</td>
                              <td>{qcBadge(lot.qc_status)}</td>
                              <td>{statusBadge(lot)}</td>
                              <td style={{ textAlign: "right" }}>{lot.renewal_count}</td>
                            </tr>
                            {isLotExpanded && (
                              <tr>
                                <td colSpan={6} style={{ padding: 0 }}>
                                  {renderLotDetail(lot)}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                );
                })()}
              </div>
            )}
          </div>
        );
      })}

      {/* ── Modals ──────────────────────────────────────────────────── */}

      {showRecipeForm && (
        <CocktailRecipeForm
          onSubmit={handleCreateRecipe}
          onCancel={() => setShowRecipeForm(false)}
          antibodies={antibodies}
          loading={recipeFormLoading}
          title="New Recipe"
        />
      )}

      {editRecipe && editRecipeInitialValues && (
        <CocktailRecipeForm
          onSubmit={handleEditRecipe}
          onCancel={() => setEditRecipe(null)}
          antibodies={antibodies}
          initialValues={editRecipeInitialValues}
          loading={recipeFormLoading}
          title={`Edit Recipe: ${editRecipe.name}`}
        />
      )}

      {prepareRecipe && (
        <CocktailLotPreparationForm
          recipe={prepareRecipe}
          onSubmit={handlePrepareLot}
          onCancel={() => setPrepareRecipe(null)}
          loading={prepareLoading}
        />
      )}

      {docModalLotId && (() => {
        const matchedLot = recipes.flatMap((r) => r.lots).find((l) => l.id === docModalLotId);
        return (
          <CocktailDocumentModal
            cocktailLotId={docModalLotId}
            renewalCount={matchedLot?.renewal_count ?? 0}
            isOpen={true}
            onClose={() => setDocModalLotId(null)}
            onDocumentsChange={() => invalidate()}
          />
        );
      })()}

      {archivePrompt && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Archive cocktail lot">
          <div className="modal-content">
            <h2>Archive Lot {archivePrompt.lotNumber}</h2>
            <p className="page-desc">
              Add an optional note about why this lot is being archived.
            </p>
            <div className="form-group">
              <label>Archive Note (optional)</label>
              <textarea
                value={archiveNote}
                onChange={(e) => setArchiveNote(e.target.value)}
                rows={3}
                placeholder='e.g., "QC Failed"'
              />
            </div>
            <div className="action-btns" style={{ marginTop: "1rem" }}>
              <button
                className="btn-danger"
                onClick={() =>
                  handleArchive(archivePrompt.lotId, archiveNote.trim() || undefined)
                }
                disabled={archiveLoading}
              >
                {archiveLoading ? "Archiving..." : "Archive Lot"}
              </button>
              <button
                className="btn-secondary"
                onClick={() => setArchivePrompt(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
