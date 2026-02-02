import ReactDatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";

interface Props {
  value: string; // "YYYY-MM-DD" or ""
  onChange: (value: string) => void;
  placeholderText?: string;
}

/** Thin wrapper around react-datepicker that works with YYYY-MM-DD strings. */
export default function DatePicker({ value, onChange, placeholderText }: Props) {
  const selected = value ? new Date(value + "T00:00:00") : null;

  const handleChange = (date: Date | null) => {
    if (!date) {
      onChange("");
      return;
    }
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    onChange(`${y}-${m}-${d}`);
  };

  return (
    <ReactDatePicker
      selected={selected}
      onChange={handleChange}
      dateFormat="MM/dd/yyyy"
      placeholderText={placeholderText || "MM/DD/YYYY"}
      isClearable
      showMonthDropdown
      showYearDropdown
      dropdownMode="select"
      autoComplete="off"
    />
  );
}
