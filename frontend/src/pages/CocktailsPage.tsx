import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import CocktailRecipeCard from "../components/CocktailRecipeCard";
import { CocktailRecipeForm, type CocktailRecipeFormValues } from "../components/CocktailRecipeForm";
import { CocktailLotPreparationForm } from "../components/CocktailLotPreparationForm";
import { CocktailDocumentModal } from "../components/CocktailDocumentModal";
import { Modal } from "../components/Modal";
import { FlaskConical, Calendar, RefreshCw, FileText, Archive, CheckCircle, Trash2 } from "lucide-react";
import { formatDateTime } from "../utils/format";

const CARD_COLLAPSE_MS = 100;

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
  const [closingId, setClosingId] = useState<string | null>(null);
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [expandedLotId, setExpandedLotId] = useState<string | null>(null);
  const [showRecipeForm, setShowRecipeForm] = useState(false);
  const [editRecipe, setEditRecipe] = useState<CocktailRecipe | null>(null);
  const [prepareRecipe, setPrepareRecipe] = useState<CocktailRecipe | null>(null);
  const [recipeFormLoading, setRecipeFormLoading] = useState(false);
  const [prepareLoading, setPrepareLoading] = useState(false);
  const [docModalLotId, setDocModalLotId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [qcConfirmLot, setQcConfirmLot] = useState<CocktailLot | null>(null);
  const [archivePrompt, setArchivePrompt] = useState<{ lotId: string; lotNumber: string } | null>(null);
  const [archiveNote, setArchiveNote] = useState("");
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [infoRecipe, setInfoRecipe] = useState<CocktailRecipe | null>(null);
  const [showInactiveLots, setShowInactiveLots] = useState(false);

  // Antibodies for recipe form (shared cache with InventoryPage)
  const { data: antibodies = [] } = useQuery({
    queryKey: ["antibodies", selectedLab],
    queryFn: () =>
      api.get<Antibody[]>("/antibodies/", { params: { lab_id: selectedLab } }).then((r) => r.data),
    enabled: !!selectedLab,
  });

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

  // Expand/collapse with animation
  const clearCollapseTimer = useCallback(() => {
    if (collapseTimerRef.current) {
      clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
  }, []);

  const toggleRecipe = useCallback((recipeId: string) => {
    if (expandedRecipeId === recipeId) {
      setClosingId(recipeId);
      clearCollapseTimer();
      collapseTimerRef.current = setTimeout(() => {
        setExpandedRecipeId(null);
        setClosingId(null);
      }, CARD_COLLAPSE_MS);
    } else {
      clearCollapseTimer();
      setClosingId(null);
      setExpandedRecipeId(recipeId);
    }
  }, [expandedRecipeId, clearCollapseTimer]);

  // Collapse lot detail when switching recipe
  useEffect(() => {
    setExpandedLotId(null);
  }, [expandedRecipeId]);

  // ESC closes topmost modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (infoRecipe) { setInfoRecipe(null); return; }
      if (docModalLotId) { setDocModalLotId(null); return; }
      if (archivePrompt) { setArchivePrompt(null); return; }
      if (prepareRecipe) { setPrepareRecipe(null); return; }
      if (editRecipe) { setEditRecipe(null); return; }
      if (showRecipeForm) { setShowRecipeForm(false); return; }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [infoRecipe, docModalLotId, archivePrompt, prepareRecipe, editRecipe, showRecipeForm]);

  // Sort recipes: active first, then alphabetically
  const sortedRecipes = useMemo(() => {
    return [...recipes].sort((a, b) => {
      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [recipes]);

  // ── Helpers ──────────────────────────────────────────────────────────

  const isCocktailLotInactive = (l: CocktailLot) =>
    l.is_archived || l.status === "depleted";

  const isExpired = (lot: CocktailLot) =>
    lot.status !== "depleted" &&
    !lot.is_archived &&
    new Date(lot.expiration_date + "T00:00:00") < new Date(new Date().toDateString());

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "\u2014";
    return new Date(dateStr + "T00:00:00").toLocaleDateString();
  };


  /** Compute FEFO badges: among active non-archived lots sorted by expiration, first = Current, rest = New. */
  const computeLotBadgeMap = (lots: CocktailLot[]): Map<string, "current" | "new"> => {
    const eligible = lots
      .filter((l) => !isCocktailLotInactive(l))
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

  /** Compute recipe counts for card display. */
  const computeRecipeCounts = (allLots: CocktailLot[]) => {
    const activeLots = allLots.filter((l) => !isCocktailLotInactive(l));
    const pendingQC = activeLots.filter((l) => l.qc_status === "pending").length;
    const expired = activeLots.filter((l) => isExpired(l)).length;
    return {
      active: activeLots.length,
      pendingQC,
      expired,
      total: allLots.length,
    };
  };

  // ── Render helpers ──────────────────────────────────────────────────

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

  const expiredBadge = (lot: CocktailLot) => {
    if (isExpired(lot)) return <span className="badge badge-red">Expired</span>;
    return null;
  };

  // ── Recipe handlers ────────────────────────────────────────────────

  const handleCreateRecipe = async (values: CocktailRecipeFormValues) => {
    setRecipeFormLoading(true);
    try {
      await api.post("/cocktails/recipes", {
        name: values.name.trim(),
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
      addToast("Cocktail created.", "success");
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
        shelf_life_days: parseInt(values.shelf_life_days, 10),
        max_renewals: values.max_renewals ? parseInt(values.max_renewals, 10) : null,
        components: values.components.map((c, i) => ({
          id: c.id || null,
          antibody_id: c.antibody_id || null,
          free_text_name: c.free_text_name?.trim() || null,
          volume_ul: c.volume_ul ? parseFloat(c.volume_ul) : null,
          ordinal: i + 1,
        })),
      });
      setEditRecipe(null);
      addToast("Cocktail updated.", "success");
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
      shelf_life_days: String(editRecipe.shelf_life_days),
      max_renewals: editRecipe.max_renewals != null ? String(editRecipe.max_renewals) : "",
      components: editRecipe.components.length > 0
        ? editRecipe.components
            .sort((a, b) => a.ordinal - b.ordinal)
            .map((c) => ({
              id: c.id,
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
    test_count?: number;
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
      <div className="cocktail-lot-detail">
        {/* Source traceability */}
        {lot.sources && lot.sources.length > 0 && (
          <div className="cocktail-lot-sources">
            <h4>Source Lots</h4>
            <div className="cocktail-source-list">
              {lot.sources.map((src) => (
                <div key={src.id} className="cocktail-source-item">
                  <span className="cocktail-source-ab">
                    {[src.antibody_target, src.antibody_fluorochrome]
                      .filter(Boolean)
                      .join(" - ") || "\u2014"}
                  </span>
                  <span className="cocktail-source-lot">{src.source_lot_number || "\u2014"}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Metadata */}
        <div className="cocktail-lot-meta">
          {lot.created_by_name && (
            <div className="cocktail-meta-item">
              <span className="cocktail-meta-label">Prepared by</span>
              <span className="cocktail-meta-value">{lot.created_by_name}</span>
            </div>
          )}
          {lot.test_count != null && (
            <div className="cocktail-meta-item">
              <span className="cocktail-meta-label">Tests</span>
              <span className="cocktail-meta-value">{lot.test_count}</span>
            </div>
          )}
          {lot.storage_unit_name && (
            <div className="cocktail-meta-item">
              <span className="cocktail-meta-label">Location</span>
              <span className="cocktail-meta-value">
                {lot.storage_unit_name}
                {lot.storage_cell_label ? ` / ${lot.storage_cell_label}` : ""}
              </span>
            </div>
          )}
          {lot.last_renewed_at && (
            <div className="cocktail-meta-item">
              <span className="cocktail-meta-label">Last renewed</span>
              <span className="cocktail-meta-value">{formatDateTime(lot.last_renewed_at)}</span>
            </div>
          )}
          {lot.qc_approved_at && (
            <div className="cocktail-meta-item">
              <span className="cocktail-meta-label">QC approved</span>
              <span className="cocktail-meta-value">{formatDateTime(lot.qc_approved_at)}</span>
            </div>
          )}
          {lot.archive_note && (
            <div className="cocktail-meta-item full-width">
              <span className="cocktail-meta-label">Archive note</span>
              <span className="cocktail-meta-value">{lot.archive_note}</span>
            </div>
          )}
        </div>

        {/* Actions */}
        {!isReadOnly && (
          <div className="cocktail-lot-actions">
            {canEdit && lot.qc_status === "pending" && !lot.is_archived && (
              <button
                className="btn-chip btn-chip-success"
                onClick={() => setQcConfirmLot(lot)}
                disabled={isLotLoading}
              >
                <CheckCircle size={14} />
                <span>Approve QC</span>
              </button>
            )}
            {canRenew && (
              <button
                className="btn-chip btn-chip-primary"
                onClick={() => handleRenew(lot.id)}
                disabled={isLotLoading}
              >
                <RefreshCw size={14} />
                <span>Renew</span>
              </button>
            )}
            {canPrepare && lot.status === "active" && !lot.is_archived && (
              <button
                className="btn-chip btn-chip-danger"
                onClick={() => handleDeplete(lot.id)}
                disabled={isLotLoading}
              >
                <Trash2 size={14} />
                <span>Deplete</span>
              </button>
            )}
            <button
              className="btn-chip btn-chip-secondary"
              onClick={() => setDocModalLotId(lot.id)}
            >
              <FileText size={14} />
              <span>Documents{lot.has_qc_document ? " (QC)" : ""}</span>
            </button>
            {canEdit && !lot.is_archived && lot.status !== "depleted" && (
              <button
                className="btn-chip btn-chip-outlined"
                onClick={() => {
                  setArchiveNote("");
                  setArchivePrompt({ lotId: lot.id, lotNumber: lot.lot_number });
                }}
                disabled={isLotLoading}
              >
                <Archive size={14} />
                <span>Archive</span>
              </button>
            )}
            {canEdit && lot.is_archived && (
              <button
                className="btn-chip btn-chip-outlined"
                onClick={() => handleArchive(lot.id)}
                disabled={isLotLoading}
              >
                <Archive size={14} />
                <span>Unarchive</span>
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── Lot list renderer ──────────────────────────────────────────────

  const renderLots = (lotsToRender: CocktailLot[], lotBadgeMap: Map<string, "current" | "new">) => {
    if (lotsToRender.length === 0) {
      return <p className="cocktail-no-lots">No lots.</p>;
    }

    return (
      <div className="cocktail-lots-list">
        {lotsToRender.map((lot) => {
          const isLotExpanded = expandedLotId === lot.id;
          return (
            <div
              key={lot.id}
              className={`cocktail-lot-item${isLotExpanded ? " expanded" : ""}`}
            >
              <div
                className="cocktail-lot-header"
                onClick={() => setExpandedLotId(isLotExpanded ? null : lot.id)}
              >
                <div className="cocktail-lot-primary">
                  <span className="cocktail-lot-number">{lot.lot_number}</span>
                  {lotBadgeMap.get(lot.id) === "current" && (
                    <span className="badge badge-blue">Current</span>
                  )}
                  {lotBadgeMap.get(lot.id) === "new" && (
                    <span className="badge badge-yellow">New</span>
                  )}
                </div>
                <div className="cocktail-lot-badges">
                  {qcBadge(lot.qc_status)}
                  {statusBadge(lot)}
                  {expiredBadge(lot)}
                </div>
              </div>
              <div className="cocktail-lot-info">
                <span><Calendar size={12} /> Prep: {formatDate(lot.preparation_date)}</span>
                <span>Exp: {formatDate(lot.expiration_date)}</span>
                {lot.renewal_count > 0 && <span>Renewals: {lot.renewal_count}</span>}
                {lot.test_count != null && <span>Tests: {lot.test_count}</span>}
              </div>
              {isLotExpanded && renderLotDetail(lot)}
            </div>
          );
        })}
      </div>
    );
  };

  // ── Expanded content for recipe card ──────────────────────────────

  const renderRecipeExpandedContent = (recipe: CocktailRecipeWithLots) => {
    const allLots = recipe.lots;
    const activeLots = allLots.filter((l) => !isCocktailLotInactive(l));
    const inactiveLots = allLots.filter((l) => isCocktailLotInactive(l));
    const lotBadgeMap = computeLotBadgeMap(allLots);

    return (
      <div className="cocktail-recipe-expanded">
        {/* Action buttons for recipe */}
        <div className="cocktail-recipe-actions">
          {canEdit && (
            <button
              className="btn-chip btn-chip-secondary"
              onClick={() => openEditRecipeForm(recipe)}
            >
              Edit Cocktail
            </button>
          )}
          {canPrepare && recipe.is_active && (
            <button
              className="btn-chip btn-chip-success"
              onClick={() => setPrepareRecipe(recipe)}
            >
              <FlaskConical size={14} />
              <span>Prepare Lot</span>
            </button>
          )}
        </div>

        {/* Active lots */}
        <div className="cocktail-lots-section">
          <h4>Active Lots ({activeLots.length})</h4>
          {activeLots.length === 0 ? (
            <p className="cocktail-no-lots">No active lots.</p>
          ) : (
            renderLots(activeLots, lotBadgeMap)
          )}
        </div>

        {/* Inactive lots toggle */}
        {inactiveLots.length > 0 && (
          <div className="cocktail-inactive-section">
            <label className="cocktail-inactive-toggle">
              <input
                type="checkbox"
                checked={showInactiveLots}
                onChange={() => setShowInactiveLots(!showInactiveLots)}
              />
              <span>Show inactive ({inactiveLots.length})</span>
            </label>
            {showInactiveLots && renderLots(inactiveLots, lotBadgeMap)}
          </div>
        )}
      </div>
    );
  };

  // ── Main render ────────────────────────────────────────────────────

  return (
    <div className="cocktails-page">
      <div className="page-header">
        <h1>Cocktails</h1>
        <div className="filters">
          {canEdit && (
            <button className="btn-chip btn-chip-primary" onClick={() => setShowRecipeForm(true)}>
              + New
            </button>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="inventory-grid">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card" style={{ padding: "var(--space-md)" }}>
              <span className="shimmer shimmer-text" style={{ width: "60%" }} />
              <span className="shimmer shimmer-text" style={{ width: "40%", marginTop: "var(--space-sm)" }} />
              <span className="shimmer shimmer-text" style={{ width: "80%", marginTop: "var(--space-sm)" }} />
            </div>
          ))}
        </div>
      )}

      {!isLoading && sortedRecipes.length === 0 && (
        <EmptyState
          icon={FlaskConical}
          title="No cocktails"
          description="Create a cocktail to start tracking preparations."
        />
      )}

      {/* Recipe cards in inventory-grid layout */}
      <div className="inventory-grid stagger-reveal">
        {sortedRecipes.map((recipe) => {
          const isExpanded = expandedRecipeId === recipe.id;
          const isCollapsing = closingId === recipe.id;
          const counts = computeRecipeCounts(recipe.lots);

          return (
            <div
              key={recipe.id}
              className="inventory-card-motion"
              style={isExpanded || isCollapsing ? { gridColumn: "1 / -1" } : undefined}
            >
              <CocktailRecipeCard
                recipe={recipe}
                counts={counts}
                expanded={isExpanded}
                collapsing={isCollapsing}
                onClick={() => toggleRecipe(recipe.id)}
                onInfo={() => setInfoRecipe(recipe)}
              >
                {renderRecipeExpandedContent(recipe)}
              </CocktailRecipeCard>
            </div>
          );
        })}
      </div>

      {/* ── Modals ──────────────────────────────────────────────────── */}

      {/* Component info modal */}
      {infoRecipe && (
        <Modal onClose={() => setInfoRecipe(null)} ariaLabel="Cocktail details">
          <div className="cocktail-info-modal">
            <div className="cocktail-info-header">
              <div className="cocktail-info-icon">
                <FlaskConical size={20} />
              </div>
              <h2>{infoRecipe.name}</h2>
            </div>

            <div className="cocktail-info-meta">
              <div className="cocktail-info-stat">
                <span className="label">Shelf life</span>
                <span className="value">{infoRecipe.shelf_life_days} days</span>
              </div>
              <div className="cocktail-info-stat">
                <span className="label">Max renewals</span>
                <span className="value">{infoRecipe.max_renewals != null ? infoRecipe.max_renewals : "Unlimited"}</span>
              </div>
            </div>

            <div className="cocktail-info-components">
              <h3>Components</h3>
              <div className="cocktail-info-component-list">
                {infoRecipe.components
                  .sort((a, b) => a.ordinal - b.ordinal)
                  .map((comp) => (
                    <div key={comp.id} className="cocktail-info-component">
                      <span className="ordinal">{comp.ordinal}</span>
                      <span className="name">
                        {comp.antibody_target || comp.antibody_fluorochrome
                          ? [comp.antibody_target, comp.antibody_fluorochrome]
                              .filter(Boolean)
                              .join(" - ")
                          : comp.free_text_name
                            ? <em>{comp.free_text_name}</em>
                            : "\u2014"}
                      </span>
                      <span className="volume">
                        {comp.volume_ul != null ? `${comp.volume_ul} μL` : "\u2014"}
                      </span>
                    </div>
                  ))}
              </div>
            </div>

            <div className="cocktail-info-actions">
              <button className="btn-secondary" onClick={() => setInfoRecipe(null)}>
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showRecipeForm && (
        <CocktailRecipeForm
          onSubmit={handleCreateRecipe}
          onCancel={() => setShowRecipeForm(false)}
          antibodies={antibodies}
          loading={recipeFormLoading}
          title="New Cocktail"
        />
      )}

      {editRecipe && editRecipeInitialValues && (
        <CocktailRecipeForm
          onSubmit={handleEditRecipe}
          onCancel={() => setEditRecipe(null)}
          antibodies={antibodies}
          initialValues={editRecipeInitialValues}
          loading={recipeFormLoading}
          title="Edit Cocktail"
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
        <Modal onClose={() => setArchivePrompt(null)} ariaLabel="Archive cocktail lot">
          <div className="cocktail-archive-modal">
            <h2>Archive Lot {archivePrompt.lotNumber}</h2>
            <p>Add an optional note about why this lot is being archived.</p>
            <div className="cocktail-archive-field">
              <label>Archive Note (optional)</label>
              <textarea
                value={archiveNote}
                onChange={(e) => setArchiveNote(e.target.value)}
                rows={3}
                placeholder='e.g., "QC Failed"'
              />
            </div>
            <div className="action-btns">
              <button
                className="btn-secondary"
                onClick={() => setArchivePrompt(null)}
              >
                Cancel
              </button>
              <button
                className="btn-danger"
                onClick={() =>
                  handleArchive(archivePrompt.lotId, archiveNote.trim() || undefined)
                }
                disabled={archiveLoading}
              >
                {archiveLoading ? "Archiving..." : "Archive Lot"}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {qcConfirmLot && (
        <Modal onClose={() => setQcConfirmLot(null)} ariaLabel="Confirm QC approval">
          <div className="modal-content">
            <h2>Approve QC for this cocktail lot?</h2>
            <p className="page-desc">
              This will mark the lot as QC approved. This action is recorded in the audit log.
            </p>
            <div className="action-btns" style={{ marginTop: "var(--space-lg)" }}>
              <button
                className="btn-chip btn-chip-success"
                onClick={() => { handleQC(qcConfirmLot.id, "approved"); setQcConfirmLot(null); }}
              >
                Approve
              </button>
              <button className="btn-secondary" onClick={() => setQcConfirmLot(null)}>Cancel</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
