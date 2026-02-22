import { createPortal } from "react-dom";
import type { ReactNode } from "react";

interface ModalProps {
  children: ReactNode;
  onClose?: () => void;
  ariaLabel?: string;
}

/**
 * Modal wrapper that renders into a portal outside the React root.
 * This ensures the modal overlay fills the entire viewport including safe areas.
 */
export function Modal({ children, onClose, ariaLabel }: ModalProps) {
  const portalRoot = document.getElementById("modal-portal");
  if (!portalRoot) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    // Only close if clicking the overlay itself, not the content
    if (e.target === e.currentTarget && onClose) {
      onClose();
    }
  };

  return createPortal(
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onClick={handleOverlayClick}
    >
      {children}
    </div>,
    portalRoot
  );
}
