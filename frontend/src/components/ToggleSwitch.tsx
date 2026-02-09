interface ToggleSwitchProps {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}

export default function ToggleSwitch({ checked, onChange, disabled }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`toggle-switch${checked ? " toggle-on" : ""}`}
      onClick={onChange}
      disabled={disabled}
    >
      <span className="toggle-thumb" />
    </button>
  );
}
