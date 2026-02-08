interface CapacityBarProps {
  occupied: number;
  total: number;
}

export function capacityFillClass(occupiedPercent: number): string {
  if (occupiedPercent >= 90) return "fill-danger";
  if (occupiedPercent >= 70) return "fill-warning";
  return "fill-ok";
}

export default function CapacityBar({ occupied, total }: CapacityBarProps) {
  const percent = total > 0 ? Math.round((occupied / total) * 100) : 0;
  const fillClass = capacityFillClass(percent);

  return (
    <div className="capacity-bar">
      <div className={`capacity-fill ${fillClass}`} style={{ width: `${percent}%` }} />
      <span className="capacity-label">
        {occupied}/{total}
      </span>
    </div>
  );
}
