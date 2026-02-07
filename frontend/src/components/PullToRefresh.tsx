import { RefreshCw } from "lucide-react";

interface Props {
  pulling: boolean;
  refreshing: boolean;
  pullDistance: number;
  progress: number;
  isPastThreshold: boolean;
}

export default function PullToRefresh({
  pulling,
  refreshing,
  pullDistance,
  progress,
  isPastThreshold,
}: Props) {
  if (!pulling && !refreshing) return null;

  return (
    <div
      className="pull-to-refresh"
      style={{ height: pullDistance, opacity: Math.min(progress * 1.5, 1) }}
    >
      <div className={`ptr-icon${refreshing ? " ptr-spinning" : ""}${isPastThreshold ? " ptr-ready" : ""}`}>
        <RefreshCw
          size={20}
          style={{
            transform: `rotate(${progress * 360}deg)`,
            transition: refreshing ? "none" : "transform 0.1s ease",
          }}
        />
      </div>
      {!refreshing && isPastThreshold && (
        <span className="ptr-label">Release to refresh</span>
      )}
    </div>
  );
}
