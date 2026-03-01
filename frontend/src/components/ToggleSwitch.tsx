interface ToggleSwitchProps {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  label?: string;
}

export default function ToggleSwitch({ checked, onChange, disabled, label }: ToggleSwitchProps) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`toggle-switch${checked ? " toggle-on" : ""}`}
        onClick={onChange}
        disabled={disabled}
      >
        <span className="toggle-thumb" />
      </button>
      {label && <span className="text-sm">{label}</span>}
    </span>
  );
}
