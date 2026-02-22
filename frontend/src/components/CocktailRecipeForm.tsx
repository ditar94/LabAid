import { useState, useRef, useMemo, type FormEvent } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
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
import { GripVertical } from "lucide-react";
import type { Antibody } from "../api/types";

export interface CocktailRecipeFormValues {
  name: string;
  shelf_life_days: string;
  max_renewals: string;
  components: ComponentRow[];
}

export interface ComponentRow {
  id?: string;  // present for existing components (preserves FK refs on update)
  antibody_id: string;
  volume_ul: string;
  free_text_name: string;
}

// Internal row with stable key for drag-and-drop
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

// ── Sortable Row Component ─────────────────────────────────────────────────
interface SortableRowProps {
  row: ComponentRowWithKey;
  index: number;
  availableAntibodies: Antibody[];
  onFieldChange: (field: keyof ComponentRow, value: string) => void;
  onToggleCustomMode: () => void;
  onRemove: () => void;
  canRemove: boolean;
  antibodyLabel: (ab: Antibody) => string;
}

function SortableRow({
  row,
  index,
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
    opacity: isDragging ? 0.8 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`component-row ${isDragging ? "component-row-dragging" : ""}`}
    >
      {/* Drag handle */}
      <button
        type="button"
        className="drag-handle"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
      >
        <GripVertical size={16} />
      </button>

      {/* Row number */}
      <span className="component-row-number">{index + 1}</span>

      {/* Antibody select or custom input */}
      {row._customMode ? (
        <input
          type="text"
          placeholder="Custom component name..."
          value={row.free_text_name}
          onChange={(e) => onFieldChange("free_text_name", e.target.value)}
          style={{ flex: 2 }}
          required
        />
      ) : (
        <select
          value={row.antibody_id}
          onChange={(e) => onFieldChange("antibody_id", e.target.value)}
          style={{ flex: 2 }}
          required
        >
          <option value="">Select antibody...</option>
          {availableAntibodies.map((ab) => (
            <option key={ab.id} value={ab.id}>
              {antibodyLabel(ab)}
            </option>
          ))}
        </select>
      )}

      {/* Toggle custom/antibody mode */}
      <button
        type="button"
        className={`btn-sm ${row._customMode ? "btn-green" : "btn-secondary"}`}
        onClick={onToggleCustomMode}
        title={row._customMode ? "Switch to antibody selection" : "Switch to custom text"}
        style={{ padding: "0.15rem 0.4rem", fontSize: "0.75rem", whiteSpace: "nowrap" }}
      >
        {row._customMode ? "Ab" : "Custom"}
      </button>

      {/* Volume input */}
      <input
        type="number"
        min="0"
        step="0.1"
        placeholder="uL"
        value={row.volume_ul}
        onChange={(e) => onFieldChange("volume_ul", e.target.value)}
        style={{ flex: 0.7, minWidth: "4rem" }}
      />

      {/* Remove button */}
      <button
        type="button"
        className="btn-sm btn-danger"
        onClick={onRemove}
        disabled={!canRemove}
        aria-label="Remove component"
        style={{ padding: "0 0.4rem" }}
      >
        X
      </button>
    </div>
  );
}

// ── Main Form Component ────────────────────────────────────────────────────
export function CocktailRecipeForm({
  onSubmit,
  onCancel,
  initialValues,
  antibodies,
  loading = false,
  title = "New Cocktail",
}: Props) {
  // Generate stable keys for rows
  const keyCounterRef = useRef(0);
  const generateKey = () => ++keyCounterRef.current;

  // Initialize rows with keys and custom mode
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

  // Collect all selected antibody IDs to filter from other dropdowns
  const selectedAntibodyIds = useMemo(() => {
    const ids = new Set<string>();
    rows.forEach((r) => {
      if (r.antibody_id) ids.add(r.antibody_id);
    });
    return ids;
  }, [rows]);

  // Drag-and-drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // 5px movement before drag starts
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
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
      if (row._customMode) {
        // Switching from custom to antibody: clear free_text_name
        updated[index] = { ...row, _customMode: false, free_text_name: "" };
      } else {
        // Switching from antibody to custom: clear antibody_id
        updated[index] = { ...row, _customMode: true, antibody_id: "" };
      }
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
      setError("Cocktail name is required.");
      return;
    }
    if (!shelfLifeDays || parseInt(shelfLifeDays, 10) < 1) {
      setError("Shelf life must be at least 1 day.");
      return;
    }
    const hasEmptyComponent = rows.some((r) => !r.antibody_id && !r.free_text_name.trim());
    if (hasEmptyComponent) {
      setError("All components must have an antibody selected or a custom name entered.");
      return;
    }

    // Build form values without internal keys
    const formValues: CocktailRecipeFormValues = {
      name: name.trim(),
      shelf_life_days: shelfLifeDays,
      max_renewals: maxRenewals,
      components: rows.map((r) => ({
        id: r.id,
        antibody_id: r.antibody_id,
        volume_ul: r.volume_ul,
        free_text_name: r.free_text_name,
      })),
    };

    try {
      await onSubmit(formValues);
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || "Failed to save cocktail.");
    }
  };

  const antibodyLabel = (ab: Antibody) => {
    if (ab.name) return ab.name;
    return [ab.target, ab.fluorochrome].filter(Boolean).join(" - ") || "Unnamed";
  };

  const getAvailableAntibodies = (currentAntibodyId: string) => {
    return antibodies.filter(
      (ab) => ab.is_active && ab.designation !== "ivd" && (!selectedAntibodyIds.has(ab.id) || ab.id === currentAntibodyId)
    );
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-content">
        <h2>{title}</h2>
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
        >
          <div className="form-group">
            <label>Cocktail Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. T-Cell Panel"
              required
            />
          </div>

          <div style={{ display: "flex", gap: "0.75rem" }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Shelf Life (days)</label>
              <input
                type="number"
                min="1"
                value={shelfLifeDays}
                onChange={(e) => setShelfLifeDays(e.target.value)}
                required
              />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Max Renewals (optional)</label>
              <input
                type="number"
                min="0"
                value={maxRenewals}
                onChange={(e) => setMaxRenewals(e.target.value)}
                placeholder="Unlimited"
              />
            </div>
          </div>

          <div className="form-group">
            <label>Components</label>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={rows.map((r) => r._key)}
                strategy={verticalListSortingStrategy}
              >
                <div className="component-list">
                  {rows.map((row, i) => (
                    <SortableRow
                      key={row._key}
                      row={row}
                      index={i}
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
            <button
              type="button"
              className="btn-sm btn-secondary"
              onClick={addComponent}
              style={{ marginTop: "0.5rem" }}
            >
              + Add Component
            </button>
          </div>

          {error && <p className="error">{error}</p>}

          <div className="action-btns" style={{ marginTop: "0.5rem" }}>
            <button type="submit" disabled={loading}>
              {loading ? "Saving..." : initialValues ? "Save Changes" : "Create Cocktail"}
            </button>
            <button type="button" className="btn-secondary" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
