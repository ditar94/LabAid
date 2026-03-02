import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import TermsContent from "./TermsContent";

export default function TermsModal({ onClose }: { onClose: () => void }) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      className="terms-modal-overlay"
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="terms-modal">
        <div className="terms-modal-header">
          <div>
            <h1>Terms of Use</h1>
            <p className="terms-effective">Effective Date: February 8, 2026</p>
          </div>
          <button className="terms-modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="terms-content">
          <TermsContent />
        </div>
      </div>
    </div>
  );
}
