import { X } from "lucide-react";
import { Modal } from "./Modal";
import PrivacyContent from "./PrivacyContent";

export default function PrivacyModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} ariaLabel="Privacy Policy">
      <div className="terms-modal">
        <div className="terms-modal-header">
          <div>
            <h1>Privacy Policy</h1>
            <p className="terms-effective">Effective Date: March 6, 2026</p>
          </div>
          <button className="terms-modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="terms-content">
          <PrivacyContent />
        </div>
      </div>
    </Modal>
  );
}
