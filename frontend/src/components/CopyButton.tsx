import { useState, useRef } from "react";
import { Copy, Check } from "lucide-react";

interface CopyButtonProps {
  value: string;
}

export default function CopyButton({ value }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  if (!value) return null;

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Fallback for insecure contexts (e.g. non-localhost dev)
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      className={`copy-btn${copied ? " copied" : ""}`}
      onClick={handleClick}
      title="Copy to clipboard"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}
