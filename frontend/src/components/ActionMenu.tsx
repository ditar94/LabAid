import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";

export interface ActionMenuItem {
  label: string;
  icon?: string;
  variant?: "default" | "success" | "danger";
  onClick: () => void;
}

interface ActionMenuProps {
  items: ActionMenuItem[];
}

export default function ActionMenu({ items }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const reposition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const menuWidth = 180;
    const menuHeight = items.length * 38 + 12; // approximate
    let top = rect.bottom + 6;
    let left = rect.right - menuWidth;

    // Flip left if it would go off-screen left
    if (left < 8) left = rect.left;
    // Flip right if it would go off-screen right
    if (left + menuWidth > window.innerWidth - 8) {
      left = window.innerWidth - menuWidth - 8;
    }
    // Flip above if it would go off-screen bottom
    if (top + menuHeight > window.innerHeight - 8) {
      top = rect.top - menuHeight - 6;
    }

    setPos({ top, left });
  }, [items.length]);

  // Position on open
  useLayoutEffect(() => {
    if (open) reposition();
  }, [open, reposition]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      )
        return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", handler, true);
    return () => document.removeEventListener("pointerdown", handler, true);
  }, [open]);

  // Close on scroll (any ancestor)
  useEffect(() => {
    if (!open) return;
    const handler = () => setOpen(false);
    window.addEventListener("scroll", handler, true);
    return () => window.removeEventListener("scroll", handler, true);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  if (items.length === 0) return null;

  return (
    <>
      <button
        ref={triggerRef}
        className={`action-menu-trigger${open ? " active" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        aria-haspopup="true"
        aria-expanded={open}
        title="Actions"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <circle cx="8" cy="3" r="1.5" />
          <circle cx="8" cy="8" r="1.5" />
          <circle cx="8" cy="13" r="1.5" />
        </svg>
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            className="action-menu-dropdown"
            style={{ top: pos.top, left: pos.left }}
            role="menu"
          >
            {items.map((item, i) => (
              <button
                key={i}
                className={`action-menu-item${item.variant ? ` action-menu-item--${item.variant}` : ""}`}
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  item.onClick();
                  setOpen(false);
                }}
              >
                {item.icon && <span className="action-menu-icon">{item.icon}</span>}
                {item.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
