import { useState, useEffect } from "react";
import api from "../api/client";
import type { LotRequest, StorageUnit, Fluorochrome, Designation } from "../api/types";
import DatePicker from "./DatePicker";
import { Modal } from "./Modal";

interface Props {
  request: LotRequest;
  onClose: () => void;
  onSuccess: () => void;
}

export default function LotRequestReviewModal({ request, onClose, onSuccess }: Props) {
  const [storageUnits, setStorageUnits] = useState<StorageUnit[]>([]);
  const [fluorochromes, setFluorochromes] = useState<Fluorochrome[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectionNote, setRejectionNote] = useState("");

  // Editable fields
  const ab = request.proposed_antibody;
  const [designation, setDesignation] = useState<Designation>((ab.designation as Designation) || "ruo");
  const [target, setTarget] = useState((ab.target as string) || "");
  const [fluorochrome, setFluorochrome] = useState((ab.fluorochrome as string) || "");
  const [clone, setClone] = useState((ab.clone as string) || "");
  const [vendor, setVendor] = useState((ab.vendor as string) || "");
  const [catalogNumber, setCatalogNumber] = useState((ab.catalog_number as string) || "");
  const [name, setName] = useState((ab.name as string) || "");
  const [shortCode, setShortCode] = useState((ab.short_code as string) || "");
  const [color, setColor] = useState((ab.color as string) || "#6366f1");
  const [stabilityDays, setStabilityDays] = useState(ab.stability_days != null ? String(ab.stability_days) : "");
  const [lowStockThreshold, setLowStockThreshold] = useState(ab.low_stock_threshold != null ? String(ab.low_stock_threshold) : "");
  const [approvedLowThreshold, setApprovedLowThreshold] = useState(ab.approved_low_threshold != null ? String(ab.approved_low_threshold) : "");
  const [lotNumber, setLotNumber] = useState(request.lot_number || "");
  const [expirationDate, setExpirationDate] = useState(request.expiration_date || "");
  const [quantity, setQuantity] = useState(String(request.quantity));
  const [storageUnitId, setStorageUnitId] = useState(request.storage_unit_id || "");

  useEffect(() => {
    Promise.all([
      api.get<StorageUnit[]>("/storage/units"),
      api.get<Fluorochrome[]>("/fluorochromes/"),
    ]).then(([unitsRes, fluoroRes]) => {
      setStorageUnits(unitsRes.data);
      setFluorochromes(fluoroRes.data);
    });
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const isIVD = designation === "ivd";

  const handleApprove = async () => {
    setError(null);
    setLoading(true);
    try {
      const qty = parseInt(quantity, 10);
      if (!Number.isFinite(qty) || qty < 1) {
        setError("Please enter a valid quantity.");
        setLoading(false);
        return;
      }

      await api.patch(`/lot-requests/${request.id}/approve`, {
        lot_number: lotNumber || null,
        expiration_date: expirationDate || null,
        quantity: qty,
        storage_unit_id: storageUnitId || null,
        proposed_antibody: {
          designation,
          target: isIVD ? null : target.trim() || null,
          fluorochrome: isIVD ? null : fluorochrome.trim() || null,
          clone: isIVD ? null : (clone.trim() || null),
          vendor: vendor.trim() || null,
          catalog_number: catalogNumber.trim() || null,
          name: name.trim() || null,
          short_code: isIVD ? (shortCode.trim() || null) : null,
          color: color || null,
          stability_days: stabilityDays.trim() ? parseInt(stabilityDays, 10) : null,
          low_stock_threshold: lowStockThreshold.trim() ? parseInt(lowStockThreshold, 10) : null,
          approved_low_threshold: approvedLowThreshold.trim() ? parseInt(approvedLowThreshold, 10) : null,
        },
      });
      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to approve request");
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    if (!rejectionNote.trim()) {
      setError("Please provide a rejection reason.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await api.patch(`/lot-requests/${request.id}/reject`, {
        rejection_note: rejectionNote.trim(),
      });
      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to reject request");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal onClose={onClose} ariaLabel="Review Request">
      <div className="modal-content lot-request-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Review Request</h2>

        <div className="form-row">
          <div className="form-group">
            <label>Submitted By</label>
            <input value={request.user_full_name || "Unknown"} disabled />
          </div>
          <div className="form-group">
            <label>Barcode</label>
            <input value={request.barcode} disabled />
          </div>
        </div>

        {request.notes && (
          <div className="form-group">
            <label>Tech Notes</label>
            <p className="page-desc" style={{ margin: 0 }}>{request.notes}</p>
          </div>
        )}

        <h3 style={{ margin: "1rem 0 0.5rem" }}>Antibody</h3>

        <div className="form-row">
          <div className="form-group">
            <label>Designation</label>
            <select value={designation} onChange={(e) => setDesignation(e.target.value as Designation)}>
              <option value="ruo">RUO</option>
              <option value="asr">ASR</option>
              <option value="ivd">IVD</option>
            </select>
          </div>
          <div className="form-group">
            <label>Vendor</label>
            <input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Vendor" />
          </div>
        </div>

        {isIVD ? (
          <>
            <div className="form-group">
              <label>Product Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="IVD product name (required)" required />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Short Code</label>
                <input value={shortCode} onChange={(e) => setShortCode(e.target.value)} placeholder="e.g. TBNK" maxLength={10} required />
              </div>
              <div className="form-group">
                <label>Color</label>
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="form-row">
              <div className="form-group">
                <label>Target</label>
                <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="e.g. CD3, CD4" required />
              </div>
              <div className="form-group">
                <label>Fluorochrome</label>
                <select value={fluorochrome} onChange={(e) => setFluorochrome(e.target.value)}>
                  <option value="">Select...</option>
                  {fluorochromes.map((f) => (
                    <option key={f.id} value={f.name}>{f.name}</option>
                  ))}
                  {fluorochrome && !fluorochromes.some((f) => f.name === fluorochrome) && (
                    <option value={fluorochrome}>{fluorochrome} (new)</option>
                  )}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Clone</label>
                <input value={clone} onChange={(e) => setClone(e.target.value)} placeholder="Clone (optional)" />
              </div>
              <div className="form-group">
                <label>Color</label>
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
              </div>
            </div>
          </>
        )}

        <div className="form-row">
          <div className="form-group">
            <label>Catalog #</label>
            <input value={catalogNumber} onChange={(e) => setCatalogNumber(e.target.value)} placeholder="Catalog number" />
          </div>
          <div className="form-group">
            <label>Stability Days</label>
            <input type="number" min={0} value={stabilityDays} onChange={(e) => setStabilityDays(e.target.value)} placeholder="Days after opening" />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Reorder Point</label>
            <input type="number" min={0} value={lowStockThreshold} onChange={(e) => setLowStockThreshold(e.target.value)} placeholder="Low stock alert" />
          </div>
          <div className="form-group">
            <label>Min Ready Stock</label>
            <input type="number" min={0} value={approvedLowThreshold} onChange={(e) => setApprovedLowThreshold(e.target.value)} placeholder="Min approved vials" />
          </div>
        </div>

        <h3 style={{ margin: "1rem 0 0.5rem" }}>Lot Details</h3>

        <div className="form-row">
          <div className="form-group">
            <label>Lot Number</label>
            <input value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} placeholder="Lot number" />
          </div>
          <div className="form-group">
            <label>Quantity</label>
            <input type="number" min={1} max={100} value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Expiration Date</label>
            <DatePicker value={expirationDate} onChange={setExpirationDate} placeholderText="Expiration date" />
          </div>
          <div className="form-group">
            <label>Store in</label>
            <select value={storageUnitId} onChange={(e) => setStorageUnitId(e.target.value)}>
              <option value="">Auto (Temp Storage)</option>
              {storageUnits.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
        </div>

        {error && <p className="error">{error}</p>}

        {rejecting ? (
          <div style={{ marginTop: "1rem" }}>
            <div className="form-group">
              <label>Rejection Reason (required)</label>
              <textarea
                value={rejectionNote}
                onChange={(e) => setRejectionNote(e.target.value)}
                rows={3}
                placeholder="Explain why this request is being rejected..."
                autoFocus
              />
            </div>
            <div className="register-actions">
              <button className="btn-danger" onClick={handleReject} disabled={loading}>
                {loading ? "Rejecting..." : "Confirm Reject"}
              </button>
              <button className="btn-secondary" onClick={() => { setRejecting(false); setRejectionNote(""); }}>
                Back
              </button>
            </div>
          </div>
        ) : (
          <div className="register-actions" style={{ marginTop: "1rem" }}>
            <button onClick={handleApprove} disabled={loading}>
              {loading ? "Approving..." : "Approve & Create"}
            </button>
            <button className="btn-danger" onClick={() => setRejecting(true)} disabled={loading}>
              Reject
            </button>
            <button className="btn-secondary" onClick={onClose} disabled={loading}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
