import { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from "lucide-react";

type ToastVariant = "success" | "danger" | "info" | "warning";

interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
  exiting?: boolean;
}

interface ToastContextType {
  addToast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextType>({
  addToast: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

let toastId = 0;

const ICONS: Record<ToastVariant, typeof CheckCircle2> = {
  success: CheckCircle2,
  danger: XCircle,
  info: Info,
  warning: AlertTriangle,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, exiting: true } : t))
    );
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 200);
  }, []);

  const addToast = useCallback(
    (message: string, variant: ToastVariant = "success") => {
      const id = ++toastId;
      setToasts((prev) => [...prev, { id, message, variant }]);
      setTimeout(() => removeToast(id), 4000);
    },
    [removeToast]
  );

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map((toast) => {
            const Icon = ICONS[toast.variant];
            return (
              <div
                key={toast.id}
                className={`toast toast-${toast.variant}${toast.exiting ? " toast-exiting" : ""}`}
              >
                <Icon className="toast-icon" />
                <span className="toast-message">{toast.message}</span>
                <button
                  className="toast-dismiss"
                  onClick={() => removeToast(toast.id)}
                  aria-label="Dismiss"
                >
                  <X size={16} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </ToastContext.Provider>
  );
}
