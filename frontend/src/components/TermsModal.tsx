import { X } from "lucide-react";
import { Modal } from "./Modal";
import TermsContent from "./TermsContent";

export default function TermsModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} ariaLabel="Terms of Use">
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
    </Modal>
  );
}
