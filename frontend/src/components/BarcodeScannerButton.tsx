import { useEffect, useRef, useState } from "react";
import { BarcodeDetector } from "barcode-detector/pure";

type Props = {
  onDetected: (value: string) => void;
  label?: string;
  className?: string;
  disabled?: boolean;
};

const DEFAULT_FORMATS: string[] = [
  "qr_code",
  "code_128",
  "code_39",
  "code_93",
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "itf",
  "codabar",
  "data_matrix",
];

export default function BarcodeScannerButton({
  onDetected,
  label = "Camera Scan",
  className = "",
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetector | null>(null);
  const rafRef = useRef<number | null>(null);

  const stopStream = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    detectorRef.current = null;
  };

  const close = () => {
    setOpen(false);
    setError(null);
    stopStream();
  };

  const scanLoop = async () => {
    if (!detectorRef.current || !videoRef.current) return;
    try {
      const barcodes = await detectorRef.current.detect(videoRef.current);
      if (barcodes && barcodes.length > 0) {
        const value = barcodes[0]?.rawValue;
        if (value) {
          onDetected(value);
          close();
          return;
        }
      }
    } catch {
      // Ignore and keep scanning
    }
    rafRef.current = requestAnimationFrame(scanLoop);
  };

  const startScan = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera access isn't available.");
      return;
    }
    try {
      detectorRef.current = new BarcodeDetector({ formats: DEFAULT_FORMATS as any });
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      scanLoop();
    } catch {
      setError("Unable to access camera. Check permissions and try again.");
    }
  };

  useEffect(() => {
    if (open) {
      startScan();
    } else {
      stopStream();
    }
    return () => stopStream();
  }, [open]);

  return (
    <>
      <button
        type="button"
        className={`btn-secondary btn-sm scan-camera-button ${className}`.trim()}
        onClick={() => setOpen(true)}
        disabled={disabled}
      >
        {label}
      </button>
      {open && (
        <div className="modal-overlay">
          <div className="modal-content scan-modal">
            <h2>Scan Barcode</h2>
            <p className="page-desc">
              Point your camera at a barcode or QR code.
            </p>
            <div className="scan-video-frame">
              <video ref={videoRef} className="scan-video" playsInline />
            </div>
            {error && <p className="error">{error}</p>}
            <div className="scan-actions">
              <button className="btn-secondary" onClick={close}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
