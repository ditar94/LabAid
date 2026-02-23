import { createPortal } from "react-dom";
import { useEffect, type ReactNode } from "react";

interface ModalProps {
  children: ReactNode;
  onClose?: () => void;
  ariaLabel?: string;
  fullscreen?: boolean;
}

/**
 * Modal wrapper that renders into a portal outside the React root.
 * This ensures the modal overlay fills the entire viewport including safe areas.
 */
export function Modal({ children, onClose, ariaLabel, fullscreen = false }: ModalProps) {
  const portalRoot = document.getElementById("modal-portal");

  useEffect(() => {
    const scrollY = window.scrollY;
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.left = "";
      document.body.style.right = "";
      document.body.style.overflow = "";
      window.scrollTo(0, scrollY);
    };
  }, []);

  if (!portalRoot) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    // Only close if clicking the overlay itself, not the content
    if (e.target === e.currentTarget && onClose) {
      onClose();
    }
  };

  return createPortal(
    <div
      className={`modal-overlay${fullscreen ? " modal-overlay-fullscreen" : ""}`}
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
