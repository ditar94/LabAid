import { useEffect, useRef, useState } from "react";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface DateRange {
  fromYear: number;
  fromMonth: number; // 0-indexed
  toYear: number;
  toMonth: number;   // 0-indexed, inclusive
}

export function dateRangeLabel(r: DateRange): string {
  if (r.fromYear === r.toYear && r.fromMonth === 0 && r.toMonth === 11) {
    return `${r.fromYear}`;
  }
  if (r.fromYear === r.toYear && r.fromMonth === r.toMonth) {
    return `${MONTH_NAMES[r.fromMonth]} ${r.fromYear}`;
  }
  if (r.fromYear === r.toYear) {
    return `${MONTH_NAMES[r.fromMonth]}\u2013${MONTH_NAMES[r.toMonth]} ${r.fromYear}`;
  }
  return `${MONTH_NAMES[r.fromMonth]} ${r.fromYear} \u2013 ${MONTH_NAMES[r.toMonth]} ${r.toYear}`;
}

export function dateRangeToParams(r: DateRange): { date_from: string; date_to: string } {
  const df = `${r.fromYear}-${String(r.fromMonth + 1).padStart(2, "0")}-01`;
  // date_to is exclusive: first day of the month AFTER toMonth
  const nextM = r.toMonth === 11 ? 0 : r.toMonth + 1;
  const nextY = r.toMonth === 11 ? r.toYear + 1 : r.toYear;
  const dt = `${nextY}-${String(nextM + 1).padStart(2, "0")}-01`;
  return { date_from: df, date_to: dt };
}

export function monthIndex(year: number, month: number) {
  return year * 12 + month;
}

export function monthIndexFromDate(d: Date) {
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

export function monthRangeFromIndex(fromIdx: number, toIdx: number): DateRange {
  return {
    fromYear: Math.floor(fromIdx / 12),
    fromMonth: fromIdx % 12,
    toYear: Math.floor(toIdx / 12),
    toMonth: toIdx % 12,
  };
}

export function monthLabelFromIndex(idx: number) {
  const year = Math.floor(idx / 12);
  const month = idx % 12;
  return `${MONTH_NAMES[month]} ${year}`;
}

export default function MonthPicker({
  value,
  onChange,
  onClear,
}: {
  value: DateRange | null;
  onChange: (r: DateRange) => void;
  onClear: () => void;
}) {
  const now = new Date();
  const [viewYear, setViewYear] = useState(value?.fromYear ?? now.getFullYear());
  const [open, setOpen] = useState(false);
  const [rangeStart, setRangeStart] = useState<{ year: number; month: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setRangeStart(null);
      }
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [open]);

  const isFuture = (y: number, m: number) =>
    y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth());

  const isInRange = (y: number, m: number) => {
    if (!value) return false;
    const v = y * 12 + m;
    const from = value.fromYear * 12 + value.fromMonth;
    const to = value.toYear * 12 + value.toMonth;
    return v >= from && v <= to;
  };

  const isRangeStart = (y: number, m: number) =>
    value?.fromYear === y && value?.fromMonth === m;
  const isRangeEnd = (y: number, m: number) =>
    value?.toYear === y && value?.toMonth === m;

  const handleMonthClick = (month: number, e: React.MouseEvent) => {
    if (e.shiftKey && rangeStart) {
      const a = rangeStart.year * 12 + rangeStart.month;
      const b = viewYear * 12 + month;
      const from = Math.min(a, b);
      const to = Math.max(a, b);
      onChange({
        fromYear: Math.floor(from / 12),
        fromMonth: from % 12,
        toYear: Math.floor(to / 12),
        toMonth: to % 12,
      });
      setRangeStart(null);
    } else {
      onChange({ fromYear: viewYear, fromMonth: month, toYear: viewYear, toMonth: month });
      setRangeStart({ year: viewYear, month });
    }
  };

  const handleYearClick = () => {
    const lastMonth = viewYear === now.getFullYear() ? now.getMonth() : 11;
    onChange({ fromYear: viewYear, fromMonth: 0, toYear: viewYear, toMonth: lastMonth });
    setRangeStart(null);
    setOpen(false);
  };

  const label = value ? dateRangeLabel(value) : "All time";

  return (
    <div className="month-picker" ref={ref}>
      <button
        className="month-picker-trigger"
        onClick={() => setOpen(!open)}
      >
        {label}
        <span className="action-multiselect-arrow">{open ? "\u25B2" : "\u25BC"}</span>
      </button>
      {open && (
        <div className="month-picker-dropdown">
          <div className="month-picker-header">
            <button onClick={() => setViewYear((y) => y - 1)}>&lsaquo;</button>
            <button className="month-picker-year-btn" onClick={handleYearClick} title="Select entire year">
              {viewYear}
            </button>
            <button
              onClick={() => setViewYear((y) => y + 1)}
              disabled={viewYear >= now.getFullYear()}
            >
              &rsaquo;
            </button>
          </div>
          {rangeStart && (
            <div className="month-picker-hint">Shift+click to select range</div>
          )}
          <div className="month-picker-grid">
            {MONTH_NAMES.map((name, i) => {
              const future = isFuture(viewYear, i);
              const inRange = isInRange(viewYear, i);
              const start = isRangeStart(viewYear, i);
              const end = isRangeEnd(viewYear, i);
              let cls = "month-picker-cell";
              if (inRange) cls += " in-range";
              if (start) cls += " range-start";
              if (end) cls += " range-end";
              if (start && end) cls += " selected";
              if (future) cls += " disabled";
              return (
                <button
                  key={i}
                  className={cls}
                  disabled={future}
                  onClick={(e) => handleMonthClick(i, e)}
                >
                  {name}
                </button>
              );
            })}
          </div>
          <div className="month-picker-footer">
            {value && (
              <button className="month-picker-clear" onClick={() => { onClear(); setRangeStart(null); setOpen(false); }}>
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
