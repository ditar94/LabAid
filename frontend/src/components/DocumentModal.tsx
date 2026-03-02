import { useState, useCallback, useEffect } from "react";
import api from "../api/client";
import type { Lot, LotDocument } from "../api/types";
import { openDocumentInNewTab } from "../utils/documents";
import { Modal } from "./Modal";

interface Props {
  lot: Lot;
  qcDocRequired?: boolean;
  onClose: () => void;
  onUpload: () => void;
  onUploadAndApprove?: () => Promise<void>;
  onDocumentsChange?: () => void;
}

export default function DocumentModal({ lot, qcDocRequired = false, onClose, onUpload, onUploadAndApprove, onDocumentsChange }: Props) {
  const [documents, setDocuments] = useState<LotDocument[]>(lot.documents || []);
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState("");
  const [isQcDocument, setIsQcDocument] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [docSavingId, setDocSavingId] = useState<string | null>(null);
  const [docDeletingId, setDocDeletingId] = useState<string | null>(null);
  const [deletePrompt, setDeletePrompt] = useState<LotDocument | null>(null);
  // Incrementing key forces the file input to fully remount after errors
  const [inputKey, setInputKey] = useState(0);

  useEffect(() => {
    setDocuments(lot.documents || []);
  }, [lot]);

  const refreshDocuments = useCallback(async () => {
    const res = await api.get<LotDocument[]>(`/documents/lots/${lot.id}`);
    setDocuments(res.data);
  }, [lot.id]);

  useEffect(() => {
    refreshDocuments().catch(() => {
      // Keep stale docs visible if refresh fails
    });
  }, [refreshDocuments]);

  const handleDownload = async (docId: string) => {
    setError(null);
    try {
      await openDocumentInNewTab(docId);
    } catch (err: any) {
      setError(err?.message || "Failed to open document");
    }
  };

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

  const doUpload = async () => {
    if (!file) return false;
    setError(null);
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    if (description.trim()) formData.append("description", description.trim());
    if (isQcDocument) formData.append("is_qc_document", "true");
    try {
      await api.post(`/documents/lots/${lot.id}`, formData);
      await refreshDocuments();
      onDocumentsChange?.();
      setFile(null);
      setDescription("");
      setIsQcDocument(false);
      setInputKey((k) => k + 1);
      return true;
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to upload file");
      return false;
    } finally {
      setUploading(false);
    }
  };

  const handleUpload = async () => {
    try {
      if (await doUpload()) onUpload();
    } catch (err: any) {
      setError(err.message || "Upload failed");
    }
  };

  const handleUploadAndApprove = async () => {
    const hasExistingQcDoc = documents.some((doc) => doc.is_qc_document);
    try {
      if (file) {
        if (qcDocRequired && !isQcDocument && !hasExistingQcDoc) {
          setError("Your lab requires a QC document to approve this lot. Check \"This is a lot verification/QC document\" first.");
          return;
        }
        if (!(await doUpload())) return;
      } else if (qcDocRequired && !hasExistingQcDoc) {
        setError("A QC document must be uploaded or marked as QC before approval.");
        return;
      }

      if (onUploadAndApprove) {
        await onUploadAndApprove();
      }
    } catch (err: any) {
      setError(err?.message || "Upload succeeded, but approval failed");
    }
  };

  const toggleDocumentQc = async (doc: LotDocument) => {
    setError(null);
    setDocSavingId(doc.id);
    try {
      const res = await api.patch<LotDocument>(`/documents/${doc.id}`, {
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

  const deleteDocument = (doc: LotDocument) => {
    setDeletePrompt(doc);
  };

  const confirmDelete = async () => {
    if (!deletePrompt) return;
    setError(null);
    setDocDeletingId(deletePrompt.id);
    try {
      await api.delete(`/documents/${deletePrompt.id}`);
      setDocuments((prev) => prev.filter((d) => d.id !== deletePrompt.id));
      onDocumentsChange?.();
      setDeletePrompt(null);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to delete document");
    } finally {
      setDocDeletingId(null);
    }
  };

  return (
    <Modal onClose={onClose} ariaLabel={`Documents for Lot ${lot.lot_number}`}>
      <div className="modal-content">
        <h2>Documents for Lot {lot.lot_number}</h2>
        <div className="document-list">
          {documents.map((doc) => (
            <div key={doc.id} className="document-item">
              <a href="#" onClick={(e) => { e.preventDefault(); handleDownload(doc.id); }}>
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
          ))}
          {documents.length === 0 && <p>No documents uploaded.</p>}
        </div>
        <div className="upload-form">
          <h3>Upload New Document</h3>
          <input key={inputKey} type="file" onChange={handleFileChange} />
          <input
            type="text"
            placeholder="What is this document? (e.g. QC report, CoA)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={{ width: "100%", marginTop: "0.5rem" }}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: "0.5rem" }}>
            <input type="checkbox" checked={isQcDocument} onChange={(e) => setIsQcDocument(e.target.checked)} />
            This is a lot verification/QC document
          </label>
          <div className="action-btns" style={{ marginTop: "0.5rem" }}>
            <button onClick={handleUpload} disabled={!file || uploading}>
              {uploading ? "Uploading..." : "Upload"}
            </button>
            {onUploadAndApprove && (
              <button
                className="btn-success"
                onClick={handleUploadAndApprove}
                disabled={uploading || (!file && !documents.some((doc) => doc.is_qc_document))}
              >
                {uploading ? "Uploading..." : file ? "Upload & Approve" : "Approve Lot"}
              </button>
            )}
          </div>
          {error && <p className="error">{error}</p>}
        </div>
        <button onClick={onClose} className={onUploadAndApprove ? "btn-secondary" : ""} style={{ marginTop: "var(--space-lg)", width: onUploadAndApprove ? undefined : "100%" }}>
          {onUploadAndApprove ? "Cancel" : "Done"}
        </button>
      </div>
      {deletePrompt && (
        <div className="modal-overlay" style={{ zIndex: 1001 }} onClick={() => setDeletePrompt(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Delete document?</h2>
            <p className="page-desc">Delete {deletePrompt.file_name}? This cannot be undone.</p>
            <div className="action-btns" style={{ marginTop: "var(--space-lg)" }}>
              <button className="btn-danger" onClick={confirmDelete} disabled={!!docDeletingId}>
                {docDeletingId ? "Deleting..." : "Delete"}
              </button>
              <button className="btn-secondary" onClick={() => setDeletePrompt(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
