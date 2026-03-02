import { useState, useRef, useMemo, useCallback, type FormEvent } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Trash2, List, PenLine } from "lucide-react";
import type { Antibody } from "../api/types";
import { Modal } from "./Modal";

export interface CocktailRecipeFormValues {
  name: string;
  shelf_life_days: string;
  max_renewals: string;
  components: ComponentRow[];
}

export interface ComponentRow {
  id?: string;
  antibody_id: string;
  volume_ul: string;
  free_text_name: string;
}

interface ComponentRowWithKey extends ComponentRow {
  _key: number;
  _customMode: boolean;
}

export const EMPTY_RECIPE_FORM: CocktailRecipeFormValues = {
  name: "",
  shelf_life_days: "30",
  max_renewals: "",
  components: [{ antibody_id: "", volume_ul: "", free_text_name: "" }],
};

interface Props {
  onSubmit: (values: CocktailRecipeFormValues) => Promise<void>;
  onCancel: () => void;
  initialValues?: CocktailRecipeFormValues;
  antibodies: Antibody[];
  loading?: boolean;
  title?: string;
}

// ── Sortable Row ──────────────────────────────────────────────────────────
interface SortableRowProps {
  row: ComponentRowWithKey;
  availableAntibodies: Antibody[];
  onFieldChange: (field: keyof ComponentRow, value: string) => void;
  onToggleCustomMode: () => void;
  onRemove: () => void;
  canRemove: boolean;
  antibodyLabel: (ab: Antibody) => string;
}

function SortableRow({
  row,
  availableAntibodies,
  onFieldChange,
  onToggleCustomMode,
  onRemove,
  canRemove,
  antibodyLabel,
}: SortableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row._key });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : 1,
    zIndex: isDragging ? 100 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`cf-row${isDragging ? " dragging" : ""}`}
    >
      <button
        type="button"
        className="cf-icon-btn cf-drag"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
      >
        <GripVertical size={14} />
      </button>

      {row._customMode ? (
        <input
          type="text"
          placeholder="Custom reagent..."
          value={row.free_text_name}
          onChange={(e) => onFieldChange("free_text_name", e.target.value)}
          className="cf-input"
          autoComplete="one-time-code"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-lpignore="true"
          data-1p-ignore="true"
          data-form-type="other"
        />
      ) : (
        <select
          value={row.antibody_id}
          onChange={(e) => onFieldChange("antibody_id", e.target.value)}
          className="cf-select"
        >
          <option value="">Select antibody...</option>
          {availableAntibodies.map((ab) => (
            <option key={ab.id} value={ab.id}>
              {antibodyLabel(ab)}
            </option>
          ))}
        </select>
      )}

      <button
        type="button"
        className={`cf-icon-btn cf-mode${row._customMode ? " active" : ""}`}
        onClick={onToggleCustomMode}
        title={row._customMode ? "Switch to antibody list" : "Switch to free text"}
      >
        {row._customMode ? <List size={13} /> : <PenLine size={13} />}
      </button>

      <input
        type="text"
        inputMode="decimal"
        pattern="[0-9]*\.?[0-9]*"
        placeholder="μL"
        value={row.volume_ul}
        onChange={(e) => onFieldChange("volume_ul", e.target.value)}
        className="cf-vol"
        autoComplete="one-time-code"
        data-lpignore="true"
      />

      <button
        type="button"
        className="cf-icon-btn cf-remove"
        onClick={onRemove}
        disabled={!canRemove}
        aria-label="Remove component"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

// ── Main Form ──────────────────────────────────────────────────────────────
export function CocktailRecipeForm({
  onSubmit,
  onCancel,
  initialValues,
  antibodies,
  loading = false,
  title = "New Cocktail",
}: Props) {
  const keyCounterRef = useRef(0);
  const generateKey = () => ++keyCounterRef.current;

  const [rows, setRows] = useState<ComponentRowWithKey[]>(() => {
    const initial = initialValues?.components || EMPTY_RECIPE_FORM.components;
    return initial.map((c) => ({
      ...c,
      _key: generateKey(),
      _customMode: !!c.free_text_name,
    }));
  });

  const [name, setName] = useState(initialValues?.name || "");
  const [shelfLifeDays, setShelfLifeDays] = useState(initialValues?.shelf_life_days || "30");
  const [maxRenewals, setMaxRenewals] = useState(initialValues?.max_renewals || "");
  const [error, setError] = useState<string | null>(null);

  const selectedAntibodyIds = useMemo(() => {
    const ids = new Set<string>();
    rows.forEach((r) => {
      if (r.antibody_id) ids.add(r.antibody_id);
    });
    return ids;
  }, [rows]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setRows((items) => {
        const oldIndex = items.findIndex((r) => r._key === active.id);
        const newIndex = items.findIndex((r) => r._key === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const handleFieldChange = (index: number, field: keyof ComponentRow, value: string) => {
    setRows((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const toggleCustomMode = (index: number) => {
    setRows((prev) => {
      const updated = [...prev];
      const row = updated[index];
      updated[index] = row._customMode
        ? { ...row, _customMode: false, free_text_name: "" }
        : { ...row, _customMode: true, antibody_id: "" };
      return updated;
    });
  };

  const addComponent = () => {
    setRows((prev) => [
      ...prev,
      { antibody_id: "", volume_ul: "", free_text_name: "", _key: generateKey(), _customMode: false },
    ]);
  };

  const removeComponent = (index: number) => {
    if (rows.length <= 1) return;
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!shelfLifeDays || parseInt(shelfLifeDays, 10) < 1) {
      setError("Shelf life must be at least 1 day.");
      return;
    }
    const hasEmpty = rows.some((r) => !r.antibody_id && !r.free_text_name.trim());
    if (hasEmpty) {
      setError("All components need an antibody or custom name.");
      return;
    }

    try {
      await onSubmit({
        name: name.trim(),
        shelf_life_days: shelfLifeDays,
        max_renewals: maxRenewals,
        components: rows.map((r) => ({
          id: r.id,
          antibody_id: r.antibody_id,
          volume_ul: r.volume_ul,
          free_text_name: r.free_text_name,
        })),
      });
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || "Failed to save.");
    }
  };

  const antibodyLabel = (ab: Antibody) =>
    ab.name || [ab.target, ab.fluorochrome].filter(Boolean).join("-") || "Unnamed";

  const getAvailableAntibodies = useCallback((currentId: string) =>
    antibodies.filter(
      (ab) => ab.is_active && ab.designation !== "ivd" && (!selectedAntibodyIds.has(ab.id) || ab.id === currentId)
    ), [antibodies, selectedAntibodyIds]);

  return (
    <Modal onClose={onCancel} ariaLabel={title}>
      <div className="modal-content cf-modal">
        <h2>{title}</h2>

        <form onSubmit={handleSubmit} autoComplete="off" data-form-type="other" data-lpignore="true">
          <div className="form-group">
            <label htmlFor="cf-recipe-name">Recipe Name</label>
            <input
              id="cf-recipe-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. T-Cell Panel"
              required
              autoComplete="one-time-code"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
            />
          </div>

          <div className="cf-meta">
            <div className="form-group">
              <label htmlFor="cf-shelf-life">Shelf Life</label>
              <input
                id="cf-shelf-life"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={shelfLifeDays}
                onChange={(e) => setShelfLifeDays(e.target.value)}
                required
                placeholder="days"
                autoComplete="one-time-code"
                data-lpignore="true"
              />
            </div>
            <div className="form-group">
              <label htmlFor="cf-max-renewals">Max Renewals</label>
              <input
                id="cf-max-renewals"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={maxRenewals}
                onChange={(e) => setMaxRenewals(e.target.value)}
                placeholder="∞"
                autoComplete="one-time-code"
                data-lpignore="true"
              />
            </div>
          </div>

          <div className="cf-section">
            <label>Components ({rows.length})</label>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={rows.map((r) => r._key)} strategy={verticalListSortingStrategy}>
                <div className="cf-list">
                  {rows.map((row, i) => (
                    <SortableRow
                      key={row._key}
                      row={row}
                      availableAntibodies={getAvailableAntibodies(row.antibody_id)}
                      onFieldChange={(field, value) => handleFieldChange(i, field, value)}
                      onToggleCustomMode={() => toggleCustomMode(i)}
                      onRemove={() => removeComponent(i)}
                      canRemove={rows.length > 1}
                      antibodyLabel={antibodyLabel}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
            <button type="button" className="cf-icon-btn cf-add" onClick={addComponent}>
              <Plus size={14} /> Component
            </button>
          </div>

          {error && <p className="error">{error}</p>}

          <div className="action-btns" style={{ justifyContent: "center", marginTop: "var(--space-md)" }}>
            <button type="button" className="btn-secondary" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" disabled={loading}>
              {loading ? "Saving..." : initialValues ? "Save" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
