import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api/client";
import type { CocktailLotDocument } from "../api/types";

interface Props {
  cocktailLotId: string;
  renewalCount: number;
  isOpen: boolean;
  onClose: () => void;
  onDocumentsChange?: () => void;
}

export function CocktailDocumentModal({ cocktailLotId, renewalCount, isOpen, onClose, onDocumentsChange }: Props) {
  const [documents, setDocuments] = useState<CocktailLotDocument[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState("");
  const [isQcDocument, setIsQcDocument] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [docSavingId, setDocSavingId] = useState<string | null>(null);
  const [docDeletingId, setDocDeletingId] = useState<string | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [loadingDocs, setLoadingDocs] = useState(false);

  const refreshDocuments = useCallback(async () => {
    setLoadingDocs(true);
    try {
      const res = await api.get<CocktailLotDocument[]>(`/cocktail-documents/lots/${cocktailLotId}`);
      setDocuments(res.data);
    } catch {
      // Keep stale docs visible
    } finally {
      setLoadingDocs(false);
    }
  }, [cocktailLotId]);

  useEffect(() => {
    if (isOpen) {
      refreshDocuments();
    }
  }, [isOpen, refreshDocuments]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Group documents by renewal_number, sorted descending (newest period first)
  const groupedDocs = useMemo(() => {
    const groups = new Map<number, CocktailLotDocument[]>();
    for (const doc of documents) {
      const rn = doc.renewal_number ?? 0;
      if (!groups.has(rn)) groups.set(rn, []);
      groups.get(rn)!.push(doc);
    }
    // Sort groups descending by renewal number
    return [...groups.entries()].sort((a, b) => b[0] - a[0]);
  }, [documents]);

  const hasMultiplePeriods = groupedDocs.length > 1 || (groupedDocs.length === 1 && groupedDocs[0][0] > 0);

  if (!isOpen) return null;

  const MAX_FILE_SIZE_MB = 50;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] || null;
    if (selected && selected.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setError(`File exceeds ${MAX_FILE_SIZE_MB}MB limit`);
      setFile(null);
      setInputKey((k) => k + 1);
      return;
    }
    setError(null);
    setFile(selected);
  };

  const handleUpload = async () => {
    if (!file) return;
    setError(null);
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    if (description.trim()) formData.append("description", description.trim());
    if (isQcDocument) formData.append("is_qc_document", "true");
    try {
      await api.post(`/cocktail-documents/lots/${cocktailLotId}`, formData);
      await refreshDocuments();
      onDocumentsChange?.();
      setFile(null);
      setDescription("");
      setIsQcDocument(false);
      setInputKey((k) => k + 1);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to upload file");
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (docId: string) => {
    setError(null);
    try {
      const baseUrl = import.meta.env.VITE_API_BASE_URL || "/api";
      const base = baseUrl.startsWith("http") ? baseUrl.replace(/\/$/, "") : baseUrl.replace(/\/$/, "");
      const url = `${base}/cocktail-documents/${encodeURIComponent(docId)}`;
      const newTab = window.open(url, "_blank", "noopener,noreferrer");
      if (!newTab) {
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.click();
      }
    } catch (err: any) {
      setError(err?.message || "Failed to open document");
    }
  };

  const toggleDocumentQc = async (doc: CocktailLotDocument) => {
    setError(null);
    setDocSavingId(doc.id);
    try {
      const res = await api.patch<CocktailLotDocument>(`/cocktail-documents/${doc.id}`, {
        is_qc_document: !doc.is_qc_document,
      });
      setDocuments((prev) => prev.map((d) => (d.id === doc.id ? res.data : d)));
      onDocumentsChange?.();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to update document");
    } finally {
      setDocSavingId(null);
    }
  };

  const deleteDocument = async (doc: CocktailLotDocument) => {
    const confirmed = window.confirm(`Delete ${doc.file_name}? This cannot be undone.`);
    if (!confirmed) return;
    setError(null);
    setDocDeletingId(doc.id);
    try {
      await api.delete(`/cocktail-documents/${doc.id}`);
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
      onDocumentsChange?.();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to delete document");
    } finally {
      setDocDeletingId(null);
    }
  };

  const periodLabel = (rn: number) => {
    if (rn === 0) return "Initial Preparation";
    return `Renewal #${rn}`;
  };

  const renderDocItem = (doc: CocktailLotDocument) => (
    <div key={doc.id} className="document-item">
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          handleDownload(doc.id);
        }}
      >
        {doc.file_name}
      </a>
      {doc.is_qc_document && <span className="badge badge-green qc-doc-badge">QC</span>}
      {doc.description && <span className="document-desc">{doc.description}</span>}
      <div className="document-item-actions">
        <button
          className="btn-sm btn-secondary"
          type="button"
          onClick={() => toggleDocumentQc(doc)}
          disabled={docSavingId === doc.id || docDeletingId === doc.id}
        >
          {docSavingId === doc.id
            ? "Saving..."
            : doc.is_qc_document
            ? "Unmark QC"
            : "Mark as QC"}
        </button>
        <button
          className="btn-sm btn-danger"
          type="button"
          onClick={() => deleteDocument(doc)}
          disabled={docDeletingId === doc.id || docSavingId === doc.id}
        >
          {docDeletingId === doc.id ? "Deleting..." : "Delete"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Cocktail Lot Documents">
      <div className="modal-content">
        <h2>Documents</h2>

        <div className="document-list">
          {loadingDocs && documents.length === 0 && <p className="page-desc">Loading documents...</p>}

          {hasMultiplePeriods
            ? groupedDocs.map(([rn, docs]) => (
                <div key={rn} style={{ marginBottom: "0.75rem" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      marginBottom: "0.25rem",
                      paddingBottom: "0.25rem",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <strong style={{ fontSize: "0.85rem" }}>{periodLabel(rn)}</strong>
                    {rn === renewalCount && (
                      <span className="badge badge-blue" style={{ fontSize: "0.7em" }}>Current</span>
                    )}
                  </div>
                  {docs.map(renderDocItem)}
                </div>
              ))
            : documents.map(renderDocItem)}

          {!loadingDocs && documents.length === 0 && <p>No documents uploaded.</p>}
        </div>

        <div className="upload-form">
          <h3>
            Upload New Document
            {renewalCount > 0 && (
              <span style={{ fontWeight: 400, fontSize: "0.8em", color: "var(--text-secondary)", marginLeft: 8 }}>
                (Renewal #{renewalCount})
              </span>
            )}
          </h3>
          <input key={inputKey} type="file" onChange={handleFileChange} />
          <input
            type="text"
            placeholder="What is this document? (e.g. QC report, CoA)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={{ width: "100%", marginTop: "0.5rem" }}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: "0.5rem" }}>
            <input
              type="checkbox"
              checked={isQcDocument}
              onChange={(e) => setIsQcDocument(e.target.checked)}
            />
            This is a lot verification/QC document
          </label>
          <div className="action-btns" style={{ marginTop: "0.5rem" }}>
            <button onClick={handleUpload} disabled={!file || uploading}>
              {uploading ? "Uploading..." : "Upload"}
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </div>

        <button onClick={onClose} className="btn-secondary" style={{ marginTop: "var(--space-lg)" }}>
          Close
        </button>
      </div>
    </div>
  );
}
