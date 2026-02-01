import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../api/client";
import type { Antibody, Fluorochrome, Lab, Lot, StorageUnit, VialCounts } from "../api/types";
import { useAuth } from "../context/AuthContext";
import BarcodeScannerButton from "../components/BarcodeScannerButton";

const NEW_FLUORO_VALUE = "__new__";
const DEFAULT_FLUORO_COLOR = "#9ca3af";

type InventoryRow = {
  antibody: Antibody;
  lots: number;
  sealed: number;
  opened: number;
  depleted: number;
  total: number;
  lowStock: boolean;
};

export default function InventoryPage() {
  const { user, labSettings } = useAuth();
  const [searchParams] = useSearchParams();
  const requestedAntibodyId = searchParams.get("antibodyId");
  const requestedLabId = searchParams.get("labId");
  const sealedOnly = labSettings.sealed_counts_only ?? false;
  const [labs, setLabs] = useState<Lab[]>([]);
  const [selectedLab, setSelectedLab] = useState<string>("");
  const [antibodies, setAntibodies] = useState<Antibody[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [fluorochromes, setFluorochromes] = useState<Fluorochrome[]>([]);
  const [storageUnits, setStorageUnits] = useState<StorageUnit[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAbForm, setShowAbForm] = useState(false);
  const [showLotForm, setShowLotForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gridColumns, setGridColumns] = useState(1);
  const gridRef = useRef<HTMLDivElement>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    lotId: string;
    lotNumber: string;
    openedCount: number;
    sealedCount: number;
    totalCount: number;
  } | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [archivePrompt, setArchivePrompt] = useState<{ lotId: string; lotNumber: string } | null>(null);
  const [archiveNote, setArchiveNote] = useState("");
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [autoExpandedId, setAutoExpandedId] = useState<string | null>(null);
  const [archiveAbPrompt, setArchiveAbPrompt] = useState<{ id: string; target: string; fluorochrome: string } | null>(null);
  const [archiveAbNote, setArchiveAbNote] = useState("");
  const [archiveAbLoading, setArchiveAbLoading] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const [abForm, setAbForm] = useState({
    target: "",
    fluorochrome_choice: "",
    new_fluorochrome: "",
    new_fluoro_color: DEFAULT_FLUORO_COLOR,
    clone: "",
    vendor: "",
    catalog_number: "",
    stability_days: "",
    low_stock_threshold: "",
  });

  const [lotForm, setLotForm] = useState({
    lot_number: "",
    vendor_barcode: "",
    expiration_date: "",
    quantity: "1",
    storage_unit_id: "",
  });

  const canEdit =
    user?.role === "super_admin" ||
    user?.role === "lab_admin" ||
    user?.role === "supervisor";
  const canQC = canEdit;

  useEffect(() => {
    if (user?.role === "super_admin") {
      api.get("/labs").then((r) => {
        setLabs(r.data);
        if (r.data.length > 0) {
          const desired =
            requestedLabId && r.data.some((lab) => lab.id === requestedLabId)
              ? requestedLabId
              : r.data[0].id;
          setSelectedLab(desired);
        }
      });
    } else if (user) {
      setSelectedLab(user.lab_id);
    }
  }, [user, requestedLabId]);

  const loadData = async () => {
    if (!selectedLab) return;
    const params: Record<string, string> = { lab_id: selectedLab };
    const abParams: Record<string, string> = { ...params };
    if (showInactive) abParams.include_inactive = "true";
    const lotParams: Record<string, string> = { ...params };
    if (showArchived) lotParams.include_archived = "true";
    const [abRes, lotRes, fluoroRes, storageRes] = await Promise.all([
      api.get<Antibody[]>("/antibodies/", { params: abParams }),
      api.get<Lot[]>("/lots/", { params: lotParams }),
      api.get<Fluorochrome[]>("/fluorochromes/", { params }),
      api.get<StorageUnit[]>("/storage/units", { params }),
    ]);
    setAntibodies(abRes.data);
    setLots(lotRes.data);
    setFluorochromes(fluoroRes.data);
    setStorageUnits(storageRes.data);
  };

  useEffect(() => {
    if (selectedLab) {
      loadData();
    }
  }, [selectedLab, showArchived, showInactive]);

  useEffect(() => {
    if (!requestedAntibodyId) return;
    if (autoExpandedId === requestedAntibodyId) return;
    const exists = antibodies.some((ab) => ab.id === requestedAntibodyId);
    if (!exists) return;
    setExpandedId(requestedAntibodyId);
    setAutoExpandedId(requestedAntibodyId);
    requestAnimationFrame(() => {
      const el = document.querySelector(
        `[data-antibody-id="${requestedAntibodyId}"]`
      );
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }, [requestedAntibodyId, autoExpandedId, antibodies]);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const minCardWidth = 240;
    const updateColumns = () => {
      const styles = window.getComputedStyle(grid);
      const gap = parseFloat(styles.columnGap || styles.gap || "0") || 0;
      const width = grid.clientWidth || 1;
      const cols = Math.max(1, Math.floor((width + gap) / (minCardWidth + gap)));
      setGridColumns(cols);
    };
    updateColumns();
    const observer = new ResizeObserver(updateColumns);
    observer.observe(grid);
    window.addEventListener("resize", updateColumns);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateColumns);
    };
  }, []);

  const fluorochromeByName = useMemo(() => {
    const map = new Map<string, Fluorochrome>();
    for (const f of fluorochromes) {
      map.set(f.name.toLowerCase(), f);
    }
    return map;
  }, [fluorochromes]);

  const activeLots = useMemo(() => lots.filter((l) => !l.is_archived), [lots]);

  const allInventoryRows: InventoryRow[] = useMemo(() => {
    const counts = new Map<
      string,
      { lots: number; sealed: number; opened: number; depleted: number; total: number }
    >();
    for (const lot of activeLots) {
      const c: VialCounts = lot.vial_counts || {
        sealed: 0,
        opened: 0,
        depleted: 0,
        total: 0,
        opened_for_qc: 0,
      };
      const entry = counts.get(lot.antibody_id) || {
        lots: 0,
        sealed: 0,
        opened: 0,
        depleted: 0,
        total: 0,
      };
      entry.lots += 1;
      entry.sealed += c.sealed;
      entry.opened += c.opened;
      entry.depleted += c.depleted;
      entry.total += c.total;
      counts.set(lot.antibody_id, entry);
    }
    return antibodies
      .map((ab) => {
        const c = counts.get(ab.id) || {
          lots: 0,
          sealed: 0,
          opened: 0,
          depleted: 0,
          total: 0,
        };
        return {
          antibody: ab,
          ...c,
          lowStock:
            !ab.is_testing &&
            ab.low_stock_threshold !== null &&
            c.sealed <= ab.low_stock_threshold,
        };
      })
      .sort((a, b) =>
        `${a.antibody.target}-${a.antibody.fluorochrome}`.localeCompare(
          `${b.antibody.target}-${b.antibody.fluorochrome}`
        )
      );
  }, [antibodies, activeLots]);

  const inventoryRows = useMemo(
    () => allInventoryRows.filter((r) => r.antibody.is_active),
    [allInventoryRows]
  );
  const inactiveRows = useMemo(
    () => allInventoryRows.filter((r) => !r.antibody.is_active),
    [allInventoryRows]
  );

  const lotsByAntibody = useMemo(() => {
    const map = new Map<string, Lot[]>();
    for (const lot of lots) {
      const list = map.get(lot.antibody_id) || [];
      list.push(lot);
      map.set(lot.antibody_id, list);
    }
    return map;
  }, [lots]);

  const lotAgeBadgeMap = useMemo(() => {
    const map = new Map<string, "current" | "new">();
    for (const [, abLots] of lotsByAntibody) {
      const nonArchived = abLots.filter((l) => !l.is_archived);
      if (nonArchived.length < 2) continue;
      const oldest = nonArchived.find((l) => (l.vial_counts?.sealed ?? 0) > 0);
      for (const lot of nonArchived) {
        if (lot === oldest) {
          map.set(lot.id, "current");
        } else {
          map.set(lot.id, "new");
        }
      }
    }
    return map;
  }, [lotsByAntibody]);

  useEffect(() => {
    setShowLotForm(false);
    setLotForm({
      lot_number: "",
      vendor_barcode: "",
      expiration_date: "",
      quantity: "1",
      storage_unit_id: "",
    });
  }, [expandedId]);

  const resetMessages = () => {
    setMessage(null);
    setError(null);
  };

  const handleCreateAntibody = async (e: FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    resetMessages();
    setLoading(true);
    try {
      let fluoroName = abForm.fluorochrome_choice;
      const params: Record<string, string> = {};
      if (user?.role === "super_admin" && selectedLab) {
        params.lab_id = selectedLab;
      }

      if (fluoroName === NEW_FLUORO_VALUE) {
        const name = abForm.new_fluorochrome.trim();
        if (!name) {
          setError("Please enter a fluorochrome name.");
          setLoading(false);
          return;
        }
        const existing = fluorochromeByName.get(name.toLowerCase());
        if (!existing) {
          await api.post(
            "/fluorochromes/",
            { name, color: abForm.new_fluoro_color },
            { params }
          );
        } else if (existing.color !== abForm.new_fluoro_color) {
          await api.patch(`/fluorochromes/${existing.id}`, {
            color: abForm.new_fluoro_color,
          });
        }
        fluoroName = name;
      }

      if (!fluoroName) {
        setError("Please select a fluorochrome.");
        setLoading(false);
        return;
      }

      await api.post(
        "/antibodies/",
        {
          target: abForm.target,
          fluorochrome: fluoroName,
          clone: abForm.clone || null,
          vendor: abForm.vendor || null,
          catalog_number: abForm.catalog_number || null,
          stability_days: abForm.stability_days
            ? parseInt(abForm.stability_days, 10)
            : null,
          low_stock_threshold: abForm.low_stock_threshold
            ? parseInt(abForm.low_stock_threshold, 10)
            : null,
        },
        { params }
      );

      setAbForm({
        target: "",
        fluorochrome_choice: "",
        new_fluorochrome: "",
        new_fluoro_color: DEFAULT_FLUORO_COLOR,
        clone: "",
        vendor: "",
        catalog_number: "",
        stability_days: "",
        low_stock_threshold: "",
      });
      setShowAbForm(false);
      setMessage("Antibody created.");
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to create antibody");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateFluoroColor = async (fluoroName: string, color: string) => {
    if (!canEdit) return;
    resetMessages();
    const existing = fluorochromeByName.get(fluoroName.toLowerCase());
    try {
      if (existing) {
        await api.patch(`/fluorochromes/${existing.id}`, { color });
      } else {
        const params: Record<string, string> = {};
        if (user?.role === "super_admin" && selectedLab) {
          params.lab_id = selectedLab;
        }
        await api.post("/fluorochromes/", { name: fluoroName, color }, { params });
      }
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to update color");
    }
  };

  const handleCreateLot = async (e: FormEvent) => {
    e.preventDefault();
    const targetAntibody = antibodies.find((a) => a.id === expandedId) || null;
    if (!canEdit || !targetAntibody) return;
    resetMessages();
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (user?.role === "super_admin" && selectedLab) {
        params.lab_id = selectedLab;
      }
      const lotRes = await api.post(
        "/lots/",
        {
          antibody_id: targetAntibody.id,
          lot_number: lotForm.lot_number,
          vendor_barcode: lotForm.vendor_barcode || null,
          expiration_date: lotForm.expiration_date || null,
        },
        { params }
      );
      const qtyRaw = lotForm.quantity.trim();
      let qty = 0;
      if (qtyRaw) {
        qty = parseInt(qtyRaw, 10);
        if (!Number.isFinite(qty) || qty < 1) {
          setError("Please enter a valid vial quantity.");
          setLoading(false);
          return;
        }
      }
      if (qty > 0) {
        await api.post("/vials/receive", {
          lot_id: lotRes.data.id,
          quantity: qty,
          storage_unit_id: lotForm.storage_unit_id || null,
        });
      }
      setLotForm({
        lot_number: "",
        vendor_barcode: "",
        expiration_date: "",
        quantity: "1",
        storage_unit_id: "",
      });
      setShowLotForm(false);
      setMessage("Lot created.");
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to create lot");
    } finally {
      setLoading(false);
    }
  };

  const updateQC = async (lotId: string, status: "approved") => {
    try {
      await api.patch(`/lots/${lotId}/qc`, { qc_status: status });
      await loadData();
    } catch {
      // keep UI stable on failure
    }
  };

  const handleArchive = async (lotId: string, note?: string) => {
    setArchiveLoading(true);
    try {
      const body = note ? { note } : undefined;
      await api.patch(`/lots/${lotId}/archive`, body);
      await loadData();
      setArchivePrompt(null);
      setArchiveNote("");
    } catch {
      // keep UI stable on failure
    } finally {
      setArchiveLoading(false);
    }
  };

  const handleArchiveAntibody = async (antibodyId: string, note?: string) => {
    setArchiveAbLoading(true);
    try {
      const body = note ? { note } : undefined;
      await api.patch(`/antibodies/${antibodyId}/archive`, body);
      await loadData();
      setArchiveAbPrompt(null);
      setArchiveAbNote("");
    } catch {
      // keep UI stable on failure
    } finally {
      setArchiveAbLoading(false);
    }
  };

  const handleConfirmDeplete = async (type: "opened" | "lot") => {
    if (!confirmAction) return;
    setConfirmLoading(true);
    try {
      if (type === "opened") {
        await api.post(`/lots/${confirmAction.lotId}/deplete-all`);
      } else {
        await api.post(`/lots/${confirmAction.lotId}/deplete-all-lot`);
      }
      setConfirmAction(null);
      await loadData();
    } catch {
      // keep UI stable on failure
    } finally {
      setConfirmLoading(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Inventory</h1>
        <div className="filters">
          {user?.role === "super_admin" && (
            <select
              value={selectedLab}
              onChange={(e) => setSelectedLab(e.target.value)}
            >
              {labs.map((lab) => (
                <option key={lab.id} value={lab.id}>
                  {lab.name}
                </option>
              ))}
            </select>
          )}
          {canEdit && (
            <button onClick={() => setShowAbForm(!showAbForm)}>
              {showAbForm ? "Cancel" : "+ New Antibody"}
            </button>
          )}
        </div>
      </div>

      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}

      {showAbForm && (
        <form className="inline-form" onSubmit={handleCreateAntibody}>
          <input
            placeholder="Target (e.g., CD3)"
            value={abForm.target}
            onChange={(e) => setAbForm({ ...abForm, target: e.target.value })}
            required
          />
          <select
            value={abForm.fluorochrome_choice}
            onChange={(e) =>
              setAbForm({ ...abForm, fluorochrome_choice: e.target.value })
            }
            required
          >
            <option value="">Select Fluorochrome</option>
            <option value={NEW_FLUORO_VALUE}>+ New Fluorochrome</option>
            {fluorochromes.map((f) => (
              <option key={f.id} value={f.name}>
                {f.name}
              </option>
            ))}
          </select>
          {abForm.fluorochrome_choice === NEW_FLUORO_VALUE && (
            <>
              <input
                placeholder="New Fluorochrome"
                value={abForm.new_fluorochrome}
                onChange={(e) =>
                  setAbForm({ ...abForm, new_fluorochrome: e.target.value })
                }
                required
              />
              <input
                type="color"
                value={abForm.new_fluoro_color}
                onChange={(e) =>
                  setAbForm({ ...abForm, new_fluoro_color: e.target.value })
                }
                required
              />
            </>
          )}
          <input
            placeholder="Clone"
            value={abForm.clone}
            onChange={(e) => setAbForm({ ...abForm, clone: e.target.value })}
          />
          <input
            placeholder="Vendor"
            value={abForm.vendor}
            onChange={(e) => setAbForm({ ...abForm, vendor: e.target.value })}
          />
          <input
            placeholder="Catalog #"
            value={abForm.catalog_number}
            onChange={(e) =>
              setAbForm({ ...abForm, catalog_number: e.target.value })
            }
          />
          <input
            type="number"
            placeholder="Stability (days)"
            min={1}
            value={abForm.stability_days}
            onChange={(e) =>
              setAbForm({ ...abForm, stability_days: e.target.value })
            }
          />
          <input
            type="number"
            placeholder="Low stock threshold"
            min={1}
            value={abForm.low_stock_threshold}
            onChange={(e) =>
              setAbForm({ ...abForm, low_stock_threshold: e.target.value })
            }
          />
          <button type="submit" disabled={loading}>
            {loading ? "Creating..." : "Create Antibody"}
          </button>
        </form>
      )}

      <div className="inventory-grid" ref={gridRef}>
        {inventoryRows.map((row, index) => {
          const fluoro = fluorochromeByName.get(
            row.antibody.fluorochrome.toLowerCase()
          );
          const expanded = expandedId === row.antibody.id;
          const cardLots = lotsByAntibody.get(row.antibody.id) || [];
          const rowIndex = Math.floor(index / gridColumns) + 1;
          return (
            <div
              key={row.antibody.id}
              className={`inventory-card ${
                expanded ? "expanded" : ""
              }`}
              data-antibody-id={row.antibody.id}
              style={
                expanded
                  ? {
                      gridColumn: "1 / -1",
                      gridRow: `${rowIndex}`,
                    }
                  : undefined
              }
              onClick={() => {
                setExpandedId(expanded ? null : row.antibody.id);
              }}
            >
              <span className="corner-arrow corner-tl" />
              <span className="corner-arrow corner-tr" />
              <span className="corner-arrow corner-bl" />
              <span className="corner-arrow corner-br" />
              <div className="inventory-card-header">
                <div className="inventory-title">
                  {fluoro && (
                    <span
                      className="color-dot"
                      style={{ backgroundColor: fluoro.color }}
                    />
                  )}
                  <span>
                    {row.antibody.target}-{row.antibody.fluorochrome}
                  </span>
                </div>
                {canEdit && (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <input
                      type="color"
                      className="fluoro-color-input"
                      value={fluoro?.color || DEFAULT_FLUORO_COLOR}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        e.stopPropagation();
                        handleUpdateFluoroColor(
                          row.antibody.fluorochrome,
                          e.target.value
                        );
                      }}
                    />
                    <div
                      className="active-switch"
                      onClick={(e) => {
                        e.stopPropagation();
                        setArchiveAbNote("");
                        setArchiveAbPrompt({
                          id: row.antibody.id,
                          target: row.antibody.target,
                          fluorochrome: row.antibody.fluorochrome,
                        });
                      }}
                      title="Set this antibody as inactive"
                    >
                      <span className="active-switch-label on">Active</span>
                      <div className="active-switch-track on">
                        <div className="active-switch-thumb" />
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="inventory-meta">
                <span>{row.lots} lot{row.lots === 1 ? "" : "s"}</span>
                {row.lowStock && (
                  <span className="badge badge-red">Low stock</span>
                )}
                {row.antibody.is_testing && (
                  <span className="badge badge-yellow">Testing</span>
                )}
              </div>
              <div className="inventory-submeta">
                <span>Vendor: {row.antibody.vendor || "—"}</span>
                <span>Catalog #: {row.antibody.catalog_number || "—"}</span>
              </div>
              <div className="inventory-counts">
                <div>
                  <div className="count-label">Sealed</div>
                  <div className="count-value">{row.sealed}</div>
                </div>
                {!sealedOnly && (
                  <div>
                    <div className="count-label">Opened</div>
                    <div className="count-value">{row.opened}</div>
                  </div>
                )}
                {!sealedOnly && (
                  <div>
                    <div className="count-label">Depleted</div>
                    <div className="count-value">{row.depleted}</div>
                  </div>
                )}
                <div>
                  <div className="count-label">Total</div>
                  <div className="count-value">{row.total}</div>
                </div>
              </div>
              <div className="expand-label">Expand</div>
              <div className="collapse-label">Collapse</div>
              {expanded && (
                <div className="inventory-expanded" onClick={(e) => e.stopPropagation()}>
                  <div className="detail-header">
                    <div>
                      <h3>Lots</h3>
                      <p className="page-desc">Manage lots for this antibody.</p>
                    </div>
                    <div className="filters">
                      <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <input
                          type="checkbox"
                          checked={showArchived}
                          onChange={() => setShowArchived(!showArchived)}
                        />
                        Show archived
                      </label>
                      {canEdit && (
                        <button onClick={() => setShowLotForm(!showLotForm)}>
                          {showLotForm ? "Cancel" : "+ New Lot"}
                        </button>
                      )}
                    </div>
                  </div>

                  {showLotForm && (
                    <form className="inline-form" onSubmit={handleCreateLot}>
                      <div className="inline-form-full barcode-row">
                        <div className="input-with-scan">
                          <input
                            placeholder="Vendor Barcode"
                            value={lotForm.vendor_barcode}
                            onChange={(e) =>
                              setLotForm({
                                ...lotForm,
                                vendor_barcode: e.target.value,
                              })
                            }
                          />
                          <BarcodeScannerButton
                            label="Scan"
                            onDetected={(value) =>
                              setLotForm({ ...lotForm, vendor_barcode: value })
                            }
                          />
                        </div>
                      </div>
                      <input
                        placeholder="Lot Number"
                        value={lotForm.lot_number}
                        onChange={(e) =>
                          setLotForm({ ...lotForm, lot_number: e.target.value })
                        }
                        required
                      />
                      <input
                        type="date"
                        value={lotForm.expiration_date}
                        onChange={(e) =>
                          setLotForm({
                            ...lotForm,
                            expiration_date: e.target.value,
                          })
                        }
                      />
                      <input
                        type="number"
                        min={1}
                        placeholder="Vials received"
                        value={lotForm.quantity}
                        onChange={(e) =>
                          setLotForm({ ...lotForm, quantity: e.target.value })
                        }
                      />
                      <select
                        value={lotForm.storage_unit_id}
                        onChange={(e) =>
                          setLotForm({
                            ...lotForm,
                            storage_unit_id: e.target.value,
                          })
                        }
                      >
                        <option value="">No storage assignment</option>
                        {storageUnits.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name} ({u.rows}x{u.cols}) {u.temperature || ""}
                          </option>
                        ))}
                      </select>
                      <button type="submit" disabled={loading}>
                        {loading ? "Saving..." : "Create Lot"}
                      </button>
                    </form>
                  )}

                  {cardLots.length > 0 ? (
                    <table>
                      <thead>
                        <tr>
                          <th>Lot #</th>
                          <th>Vendor Barcode</th>
                          <th>QC</th>
                          <th>Expiration</th>
                          <th>Sealed</th>
                          {!sealedOnly && <th>Opened</th>}
                          {!sealedOnly && <th>Depleted</th>}
                          <th>Total</th>
                          {canQC && <th>Actions</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {cardLots.map((lot) => (
                          <tr key={lot.id} style={lot.is_archived ? { opacity: 0.5 } : undefined}>
                            <td>
                              {lot.lot_number}
                              {lotAgeBadgeMap.get(lot.id) === "current" && (
                                <span className="badge badge-green" style={{ marginLeft: 6, fontSize: "0.7em" }}>Current</span>
                              )}
                              {lotAgeBadgeMap.get(lot.id) === "new" && (
                                <span className="badge" style={{ marginLeft: 6, fontSize: "0.7em", background: "#6b7280", color: "#fff" }}>New</span>
                              )}
                            </td>
                            <td>{lot.vendor_barcode || "—"}</td>
                            <td>
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
                              {lot.is_archived && (
                                <span
                                  className="badge"
                                  style={{
                                    marginLeft: 6,
                                    fontSize: "0.7em",
                                    background: "#9ca3af",
                                    color: "#fff",
                                  }}
                                >
                                  Archived
                                </span>
                              )}
                            </td>
                            <td>{lot.expiration_date || "—"}</td>
                            <td>{lot.vial_counts?.sealed ?? 0}</td>
                            {!sealedOnly && <td>{lot.vial_counts?.opened ?? 0}</td>}
                            {!sealedOnly && <td>{lot.vial_counts?.depleted ?? 0}</td>}
                            <td>{lot.vial_counts?.total ?? 0}</td>
                            {canQC && (
                              <td className="action-btns">
                                {lot.qc_status !== "approved" && (
                                  <button
                                    className="btn-sm btn-green"
                                    onClick={() => updateQC(lot.id, "approved")}
                                  >
                                    Approve
                                  </button>
                                )}
                                {(lot.vial_counts?.opened ?? 0) > 0 && (
                                  <button
                                    className="btn-sm btn-red"
                                    onClick={() =>
                                      setConfirmAction({
                                        lotId: lot.id,
                                        lotNumber: lot.lot_number,
                                        openedCount: lot.vial_counts?.opened ?? 0,
                                        sealedCount: lot.vial_counts?.sealed ?? 0,
                                        totalCount: lot.vial_counts?.total ?? 0,
                                      })
                                    }
                                    title={`Deplete vials for lot ${lot.lot_number}`}
                                  >
                                    Deplete
                                  </button>
                                )}
                                {(lot.vial_counts?.opened ?? 0) === 0 && (lot.vial_counts?.total ?? 0) > 0 && (
                                  <button
                                    className="btn-sm btn-red"
                                    onClick={() =>
                                      setConfirmAction({
                                        lotId: lot.id,
                                        lotNumber: lot.lot_number,
                                        openedCount: 0,
                                        sealedCount: lot.vial_counts?.sealed ?? 0,
                                        totalCount: lot.vial_counts?.total ?? 0,
                                      })
                                    }
                                    title={`Deplete all ${lot.vial_counts?.total ?? 0} active vials (sealed + opened)`}
                                  >
                                    Deplete
                                  </button>
                                )}
                                <button
                                  className="btn-sm"
                                  onClick={() => {
                                    if (lot.is_archived) {
                                      handleArchive(lot.id);
                                    } else {
                                      setArchiveNote("");
                                      setArchivePrompt({
                                        lotId: lot.id,
                                        lotNumber: lot.lot_number,
                                      });
                                    }
                                  }}
                                  title={lot.is_archived ? "Unarchive this lot" : "Archive this lot"}
                                >
                                  {lot.is_archived ? "Unarchive" : "Archive"}
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="empty">No lots for this antibody yet.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {inventoryRows.length === 0 && (
          <p className="empty">No antibodies yet.</p>
        )}
      </div>

      <div className="inactive-section">
        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={showInactive}
            onChange={() => setShowInactive(!showInactive)}
          />
          Show inactive antibodies{inactiveRows.length > 0 ? ` (${inactiveRows.length})` : ""}
        </label>
        {showInactive && inactiveRows.length > 0 && (
          <table style={{ marginTop: "0.75rem" }}>
            <thead>
              <tr>
                <th>Antibody</th>
                <th>Vendor</th>
                <th>Catalog #</th>
                {canEdit && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {inactiveRows.map((row) => {
                const fluoro = fluorochromeByName.get(
                  row.antibody.fluorochrome.toLowerCase()
                );
                return (
                  <tr key={row.antibody.id}>
                    <td>
                      {fluoro && (
                        <span
                          className="color-dot"
                          style={{ backgroundColor: fluoro.color }}
                        />
                      )}
                      {row.antibody.target}-{row.antibody.fluorochrome}
                    </td>
                    <td>{row.antibody.vendor || "—"}</td>
                    <td>{row.antibody.catalog_number || "—"}</td>
                    {canEdit && (
                      <td>
                        <button
                          className="archive-toggle-btn reactivate"
                          onClick={() => handleArchiveAntibody(row.antibody.id)}
                        >
                          Reactivate
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {showInactive && inactiveRows.length === 0 && (
          <p className="empty" style={{ marginTop: "0.5rem" }}>No inactive antibodies.</p>
        )}
      </div>

      {archiveAbPrompt && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Set Inactive: {archiveAbPrompt.target}-{archiveAbPrompt.fluorochrome}</h2>
            <p className="page-desc">
              This antibody will be moved to the inactive list. You can reactivate it later.
            </p>
            <div className="form-group">
              <label>Note (optional)</label>
              <textarea
                value={archiveAbNote}
                onChange={(e) => setArchiveAbNote(e.target.value)}
                rows={3}
                placeholder='e.g., "Discontinued by vendor"'
              />
            </div>
            <div className="action-btns" style={{ marginTop: "1rem" }}>
              <button
                className="btn-red"
                onClick={() =>
                  handleArchiveAntibody(archiveAbPrompt.id, archiveAbNote.trim() || undefined)
                }
                disabled={archiveAbLoading}
              >
                {archiveAbLoading ? "Saving..." : "Set Inactive"}
              </button>
              <button
                className="btn-secondary"
                onClick={() => setArchiveAbPrompt(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmAction && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Confirm Deplete</h2>
            <p className="page-desc">
              Lot <strong>{confirmAction.lotNumber}</strong> has{" "}
              <strong>{confirmAction.openedCount}</strong> opened and{" "}
              <strong>{confirmAction.sealedCount}</strong> sealed vial(s).
            </p>
            <div className="action-btns" style={{ marginTop: "1rem" }}>
              {confirmAction.openedCount > 0 && (
                <button
                  className="btn-red"
                  onClick={() => handleConfirmDeplete("opened")}
                  disabled={confirmLoading}
                >
                  {confirmLoading ? "Depleting..." : `Deplete Opened (${confirmAction.openedCount})`}
                </button>
              )}
              <button
                className="btn-red"
                onClick={() => handleConfirmDeplete("lot")}
                disabled={confirmLoading}
              >
                {confirmLoading ? "Depleting..." : `Deplete All (${confirmAction.totalCount})`}
              </button>
              <button className="btn-secondary" onClick={() => setConfirmAction(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {archivePrompt && (
        <div className="modal-overlay">
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
                className="btn-red"
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
