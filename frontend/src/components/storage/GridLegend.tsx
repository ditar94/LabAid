import type { ReactNode } from "react";

interface GridLegendProps {
  children?: ReactNode;
}

export default function GridLegend({ children }: GridLegendProps) {
  return (
    <div className="grid-legend">
      <span className="legend-item">
        <span className="legend-box sealed" /> Sealed
      </span>
      <span className="legend-item">
        <span className="legend-box opened" /> Opened
      </span>
      <span className="legend-item">
        <span className="legend-box" /> Empty
      </span>
      {children}
    </div>
  );
}
