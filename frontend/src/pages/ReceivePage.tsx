import { useEffect, useState, type FormEvent } from "react";
import api from "../api/client";
import type { Lot, Antibody, StorageUnit } from "../api/types";
import { useAuth } from "../context/AuthContext";

export default function ReceivePage() {
  const { user } = useAuth();
  const canReceive =
    user?.role === "super_admin" ||
    user?.role === "lab_admin" ||
    user?.role === "supervisor";

  const [lots, setLots] = useState<Lot[]>([]);
  const [antibodies, setAntibodies] = useState<Antibody[]>([]);
  const [units, setUnits] = useState<StorageUnit[]>([]);
  const [form, setForm] = useState({
    lot_id: "",
    quantity: 1,
    storage_unit_id: "",
  });
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canReceive) return;
    api.get("/lots/").then((r) => setLots(r.data));
    api.get("/antibodies/").then((r) => setAntibodies(r.data));
    api.get("/storage/units").then((r) => setUnits(r.data));
  }, [canReceive]);

  if (!canReceive) {
    return (
      <div>
        <h1>Receive Inventory</h1>
        <p className="error">
          You do not have permission to receive inventory. Contact your
          supervisor.
        </p>
      </div>
    );
  }

  const abName = (abId: string) => {
    const ab = antibodies.find((a) => a.id === abId);
    return ab ? `${ab.target}-${ab.fluorochrome}` : "";
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setResult(null);
    setError(null);
    try {
      const res = await api.post("/vials/receive", {
        lot_id: form.lot_id,
        quantity: form.quantity,
        storage_unit_id: form.storage_unit_id || null,
      });
      setResult(`${res.data.length} vial(s) received successfully.`);
      setForm({ lot_id: "", quantity: 1, storage_unit_id: "" });
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to receive vials");
    }
  };

  return (
    <div>
      <h1>Receive Inventory</h1>
      <p className="page-desc">
        Scan a vendor barcode or select a lot, enter quantity, and optionally assign to storage.
      </p>

      <form className="receive-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Lot</label>
          <select
            value={form.lot_id}
            onChange={(e) => setForm({ ...form, lot_id: e.target.value })}
            required
          >
            <option value="">Select Lot</option>
            {lots.map((lot) => (
              <option key={lot.id} value={lot.id}>
                {abName(lot.antibody_id)} — Lot {lot.lot_number}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>Quantity</label>
          <input
            type="number"
            min={1}
            max={100}
            value={form.quantity}
            onChange={(e) =>
              setForm({ ...form, quantity: parseInt(e.target.value) || 1 })
            }
            required
          />
        </div>

        <div className="form-group">
          <label>Storage Unit (optional)</label>
          <select
            value={form.storage_unit_id}
            onChange={(e) =>
              setForm({ ...form, storage_unit_id: e.target.value })
            }
          >
            <option value="">No storage assignment</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.rows}x{u.cols}) {u.temperature || ""}
              </option>
            ))}
          </select>
        </div>

        <button type="submit">Receive Vials</button>
      </form>

      {result && <p className="success">{result}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
