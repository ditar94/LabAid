import { useEffect, useState, type FormEvent } from "react";
import api from "../api/client";
import type { Antibody, Lot, Lab, Fluorochrome } from "../api/types";
import { useAuth } from "../context/AuthContext";
import BarcodeScannerButton from "../components/BarcodeScannerButton";

function DocumentModal({ lot, onClose, onUpload }: { lot: Lot; onClose: () => void; onUpload: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async (docId: string, fileName: string) => {
    const res = await api.get(`/documents/${docId}`, { responseType: "blob" });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setError(null);
    const formData = new FormData();
    formData.append("file", file);
    try {
      await api.post(`/documents/lots/${lot.id}`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      onUpload();
      setFile(null);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to upload file");
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h2>
          Documents for Lot {lot.lot_number}
        </h2>
        <div className="document-list">
          {lot.documents?.map((doc) => (
            <div key={doc.id} className="document-item">
              <a href="#" onClick={(e) => { e.preventDefault(); handleDownload(doc.id, doc.file_name); }}>
                {doc.file_name}
              </a>
            </div>
          ))}
          {lot.documents?.length === 0 && <p>No documents uploaded.</p>}
        </div>
        <div className="upload-form">
          <h3>Upload New Document</h3>
          <input type="file" onChange={handleFileChange} />
          <button onClick={handleUpload} disabled={!file}>
            Upload
          </button>
          {error && <p className="error">{error}</p>}
        </div>
        <button onClick={onClose} className="modal-close-btn">
          Close
        </button>
      </div>
    </div>
  );
}

export default function LotsPage() {
  const { user, labSettings } = useAuth();
  const sealedOnly = labSettings.sealed_counts_only ?? false;
  const [labs, setLabs] = useState<Lab[]>([]);
  const [selectedLab, setSelectedLab] = useState<string>("");
  const [lots, setLots] = useState<Lot[]>([]);
  const [antibodies, setAntibodies] = useState<Antibody[]>([]);
  const [fluorochromes, setFluorochromes] = useState<Fluorochrome[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    antibody_id: "",
    lot_number: "",
    vendor_barcode: "",
    expiration_date: "",
  });
  const [modalLot, setModalLot] = useState<Lot | null>(null);
  const [filterAntibodyId, setFilterAntibodyId] = useState<string>("");
  const [depleteAllLotId, setDepleteAllLotId] = useState<string | null>(null);
  const [depleteAllLoading, setDepleteAllLoading] = useState(false);
  const [depleteLotId, setDepleteLotId] = useState<string | null>(null);
  const [depleteLotLoading, setDepleteLotLoading] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [archivePrompt, setArchivePrompt] = useState<{ lotId: string; lotNumber: string } | null>(null);
  const [archiveNote, setArchiveNote] = useState("");
  const [archiveLoading, setArchiveLoading] = useState(false);

  const canEdit =
    user?.role === "super_admin" ||
    user?.role === "lab_admin" ||
    user?.role === "supervisor";
  const canQC =
    user?.role === "super_admin" ||
    user?.role === "lab_admin" ||
    user?.role === "supervisor";

  const load = () => {
    const params: Record<string, string> = {};
    if (user?.role === "super_admin" && selectedLab) {
      params.lab_id = selectedLab;
    }
    if (filterAntibodyId) {
      params.antibody_id = filterAntibodyId;
    }
    if (showArchived) {
      params.include_archived = "true";
    }
    api.get("/lots/", { params }).then((r) => setLots(r.data));
    if (user?.role !== "super_admin" || selectedLab) {
      const abParams: Record<string, string> = {};
      if (user?.role === "super_admin" && selectedLab) {
        abParams.lab_id = selectedLab;
      }
      api.get("/antibodies/", { params: abParams }).then((r) => setAntibodies(r.data));
      api.get("/fluorochromes/", { params: abParams }).then((r) => setFluorochromes(r.data));
    }
  };

  useEffect(() => {
    if (user?.role === "super_admin") {
      api.get("/labs").then((r) => {
        setLabs(r.data);
        if (r.data.length > 0) {
          setSelectedLab(r.data[0].id);
        }
      });
    } else if (user) {
      setSelectedLab(user.lab_id);
    }
  }, [user]);

  useEffect(() => {
    if (selectedLab) {
      load();
    }
  }, [selectedLab, filterAntibodyId, showArchived]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const params: Record<string, string> = {};
    if (user?.role === "super_admin" && selectedLab) {
      params.lab_id = selectedLab;
    }
    await api.post(
      "/lots/",
      {
        antibody_id: form.antibody_id,
        lot_number: form.lot_number,
        vendor_barcode: form.vendor_barcode || null,
        expiration_date: form.expiration_date || null,
      },
      { params }
    );
    setForm({
      antibody_id: "",
      lot_number: "",
      vendor_barcode: "",
      expiration_date: "",
    });
    setShowForm(false);
    load();
  };

  const updateQC = async (lotId: string, status: string) => {
    await api.patch(`/lots/${lotId}/qc`, { qc_status: status });
    load();
  };

  const handleDepleteAll = async (lotId: string) => {
    setDepleteAllLoading(true);
    try {
      await api.post(`/lots/${lotId}/deplete-all`);
      setDepleteAllLotId(null);
      load();
    } catch {
      // Silently handle — user can retry
    } finally {
      setDepleteAllLoading(false);
    }
  };

  const handleDepleteLot = async (lotId: string) => {
    setDepleteLotLoading(true);
    try {
      await api.post(`/lots/${lotId}/deplete-all-lot`);
      setDepleteLotId(null);
      load();
    } catch {
      // Silently handle
    } finally {
      setDepleteLotLoading(false);
    }
  };

  const handleArchive = async (lotId: string, note?: string) => {
    setArchiveLoading(true);
    try {
      const body = note ? { note } : undefined;
      await api.patch(`/lots/${lotId}/archive`, body);
      load();
      setArchivePrompt(null);
      setArchiveNote("");
    } finally {
      setArchiveLoading(false);
    }
  };

  const abName = (lot: Lot) => {
    if (lot.antibody_target && lot.antibody_fluorochrome) {
      return `${lot.antibody_target}-${lot.antibody_fluorochrome}`;
    }
    const ab = antibodies.find((a) => a.id === lot.antibody_id);
    return ab ? `${ab.target}-${ab.fluorochrome}` : lot.antibody_id.slice(0, 8);
  };

  const qcBadge = (status: string) => {
    const cls =
      status === "approved"
        ? "badge-green"
        : status === "failed"
        ? "badge-red"
        : "badge-yellow";
    return <span className={`badge ${cls}`}>{status}</span>;
  };

  // Sort lots: group by antibody name, then by expiration date (soonest first)
  const sortedLots = [...lots].sort((a, b) => {
    const aName = abName(a).toLowerCase();
    const bName = abName(b).toLowerCase();
    if (aName !== bName) return aName.localeCompare(bName);
    // Within same antibody, sort by expiration date ascending (soonest first, nulls last)
    const aExp = a.expiration_date
      ? new Date(a.expiration_date).getTime()
      : Infinity;
    const bExp = b.expiration_date
      ? new Date(b.expiration_date).getTime()
      : Infinity;
    return aExp - bExp;
  });

  // Build age badges: for each antibody with 2+ lots, tag oldest active as "Use First"
  const ageBadgeMap = new Map<string, "use-first" | "newer">();
  {
    const groups = new Map<string, Lot[]>();
    for (const lot of sortedLots) {
      const key = lot.antibody_id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(lot);
    }
    for (const [, groupLots] of groups) {
      if (groupLots.length < 2) continue;
      const oldest = groupLots.find((l) => (l.vial_counts?.sealed ?? 0) > 0);
      for (const lot of groupLots) {
        if (lot === oldest) {
          ageBadgeMap.set(lot.id, "use-first");
        } else {
          ageBadgeMap.set(lot.id, "newer");
        }
      }
    }
  }

  const fluoroMap = new Map<string, string>();
  for (const f of fluorochromes) {
    fluoroMap.set(f.name.toLowerCase(), f.color);
  }

  return (
    <div>
      <div className="page-header">
        <h1>Lots</h1>
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
          <select
            value={filterAntibodyId}
            onChange={(e) => setFilterAntibodyId(e.target.value)}
          >
            <option value="">All Antibodies</option>
            {antibodies.map((ab) => (
              <option key={ab.id} value={ab.id}>
                {ab.target} - {ab.fluorochrome}
              </option>
            ))}
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.85rem" }}>
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show Archived
          </label>
          {canEdit && (
            <button onClick={() => setShowForm(!showForm)}>
              {showForm ? "Cancel" : "+ New Lot"}
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <form className="inline-form" onSubmit={handleSubmit}>
          <select
            value={form.antibody_id}
            onChange={(e) => setForm({ ...form, antibody_id: e.target.value })}
            required
          >
            <option value="">Select Antibody</option>
            {antibodies.map((ab) => (
              <option key={ab.id} value={ab.id}>
                {ab.target} - {ab.fluorochrome}
              </option>
            ))}
          </select>
          <input
            placeholder="Lot Number"
            value={form.lot_number}
            onChange={(e) => setForm({ ...form, lot_number: e.target.value })}
            required
          />
          <div className="input-with-scan">
            <input
              placeholder="Vendor Barcode"
              value={form.vendor_barcode}
              onChange={(e) =>
                setForm({ ...form, vendor_barcode: e.target.value })
              }
            />
            <BarcodeScannerButton
              label="Scan"
              onDetected={(value) =>
                setForm({ ...form, vendor_barcode: value })
              }
            />
          </div>
          <input
            type="date"
            placeholder="Expiration"
            value={form.expiration_date}
            onChange={(e) =>
              setForm({ ...form, expiration_date: e.target.value })
            }
          />
          <button type="submit">Save</button>
        </form>
      )}

      <table>
        <thead>
          <tr>
            <th>Antibody</th>
            <th>Lot #</th>
            <th>Barcode</th>
            <th>Expiration</th>
            <th>QC</th>
            <th>Docs</th>
            <th className="count-header">Sealed</th>
            {!sealedOnly && <th className="count-header">Opened</th>}
            {!sealedOnly && <th className="count-header">Depleted</th>}
            <th className="count-header">Active</th>
            {canQC && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {sortedLots.map((lot) => {
            const vc = lot.vial_counts;
            const color = lot.antibody_fluorochrome
              ? fluoroMap.get(lot.antibody_fluorochrome.toLowerCase())
              : undefined;
            return (
              <tr key={lot.id} style={lot.is_archived ? { opacity: 0.5 } : undefined}>
                <td>
                  {color && (
                    <div
                      className="color-dot"
                      style={{ backgroundColor: color }}
                    />
                  )}
                  {abName(lot)}
                </td>
                <td>
                  {lot.lot_number}
                  {ageBadgeMap.get(lot.id) === "use-first" && (
                    <span className="badge badge-green" style={{ marginLeft: 6, fontSize: "0.7em" }}>Use First</span>
                  )}
                  {ageBadgeMap.get(lot.id) === "newer" && (
                    <span className="badge" style={{ marginLeft: 6, fontSize: "0.7em", background: "#6b7280", color: "#fff" }}>Newer</span>
                  )}
                  {lot.is_archived && (
                    <span className="badge" style={{ marginLeft: 6, fontSize: "0.7em", background: "#9ca3af", color: "#fff" }}>Archived</span>
                  )}
                </td>
                <td>{lot.vendor_barcode || "—"}</td>
                <td>
                  {lot.expiration_date
                    ? new Date(lot.expiration_date).toLocaleDateString()
                    : "—"}
                </td>
                <td>{qcBadge(lot.qc_status)}</td>
                <td>
                  <button className="btn-sm" onClick={() => setModalLot(lot)}>
                    {lot.documents?.length || 0}
                  </button>
                </td>
                <td className="count-cell">
                  <span className="count-pill sealed">{vc?.sealed ?? 0}</span>
                </td>
                {!sealedOnly && (
                  <td className="count-cell">
                    <span className="count-pill opened">{vc?.opened ?? 0}</span>
                    {(vc?.opened_for_qc ?? 0) > 0 && (
                      <span style={{ fontSize: "0.75em", color: "#d97706", marginLeft: 4 }}>
                        ({vc!.opened_for_qc} for QC)
                      </span>
                    )}
                  </td>
                )}
                {!sealedOnly && (
                  <td className="count-cell">
                    <span className="count-pill depleted">
                      {vc?.depleted ?? 0}
                    </span>
                  </td>
                )}
                <td className="count-cell">
                  <strong>{vc?.total ?? 0}</strong>
                </td>
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
                    {(vc?.opened ?? 0) > 0 && (
                      depleteAllLotId === lot.id ? (
                        <>
                          <button
                            className="btn-sm btn-red"
                            onClick={() => handleDepleteAll(lot.id)}
                            disabled={depleteAllLoading}
                          >
                            {depleteAllLoading ? "..." : "Confirm"}
                          </button>
                          <button
                            className="btn-sm"
                            onClick={() => setDepleteAllLotId(null)}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          className="btn-sm btn-red"
                          onClick={() => setDepleteAllLotId(lot.id)}
                          title={`Deplete all ${vc?.opened ?? 0} opened vials`}
                        >
                          Deplete Opened
                        </button>
                      )
                    )}
                    {(vc?.total ?? 0) > 0 && (
                      depleteLotId === lot.id ? (
                        <>
                          <button
                            className="btn-sm btn-red"
                            onClick={() => handleDepleteLot(lot.id)}
                            disabled={depleteLotLoading}
                          >
                            {depleteLotLoading ? "..." : "Confirm"}
                          </button>
                          <button
                            className="btn-sm"
                            onClick={() => setDepleteLotId(null)}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          className="btn-sm btn-red"
                          onClick={() => setDepleteLotId(lot.id)}
                          title={`Deplete all ${vc?.total ?? 0} active vials (sealed + opened)`}
                        >
                          Deplete Lot
                        </button>
                      )
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
            );
          })}
          {lots.length === 0 && (
            <tr>
              <td colSpan={canQC ? (sealedOnly ? 9 : 11) : (sealedOnly ? 8 : 10)} className="empty">
                No lots registered
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {modalLot && (
        <DocumentModal
          lot={modalLot}
          onClose={() => setModalLot(null)}
          onUpload={() => {
            load();
            setModalLot(null);
          }}
        />
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
