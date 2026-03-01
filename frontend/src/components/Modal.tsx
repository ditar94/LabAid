import { createPortal } from "react-dom";
import { useEffect, useRef, useCallback, type ReactNode } from "react";

interface ModalProps {
  children: ReactNode;
  onClose?: () => void;
  ariaLabel?: string;
  fullscreen?: boolean;
}

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal wrapper that renders into a portal outside the React root.
 * This ensures the modal overlay fills the entire viewport including safe areas.
 */
export function Modal({ children, onClose, ariaLabel, fullscreen = false }: ModalProps) {
  const portalRoot = document.getElementById("modal-portal");
  const overlayRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<Element | null>(null);

  // Store the previously focused element on mount
  useEffect(() => {
    previousFocus.current = document.activeElement;
  }, []);

  // Scroll lock
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

  // Auto-focus first focusable element on mount, restore on unmount
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const first = el.querySelector<HTMLElement>(FOCUSABLE);
    if (first) first.focus();
    return () => {
      if (previousFocus.current instanceof HTMLElement) {
        previousFocus.current.focus();
      }
    };
  }, []);

  // Escape key handler + focus trap
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape" && onClose) {
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === "Tab") {
        const el = overlayRef.current;
        if (!el) return;
        const focusable = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    },
    [onClose]
  );

  if (!portalRoot) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    // Only close if clicking the overlay itself, not the content
    if (e.target === e.currentTarget && onClose) {
      onClose();
    }
  };

  return createPortal(
    <div
      ref={overlayRef}
      className={`modal-overlay${fullscreen ? " modal-overlay-fullscreen" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>,
    portalRoot
  );
}
