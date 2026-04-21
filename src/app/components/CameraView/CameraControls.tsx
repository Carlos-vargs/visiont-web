import { Flashlight, ZoomIn } from "lucide-react";

type CameraControlsProps = {
  flashAvailable: boolean;
  flashOn: boolean;
  onToggleFlash: () => void;
  onZoom?: () => void;
};

export function CameraControls({
  flashAvailable,
  flashOn,
  onToggleFlash,
  onZoom,
}: CameraControlsProps) {
  return (
    <div className="absolute bottom-3 right-3 flex flex-col gap-2">
      {flashAvailable && (
        <button
          onClick={onToggleFlash}
          aria-label={flashOn ? "Apagar linterna" : "Encender linterna"}
          className="w-9 h-9 rounded-full flex items-center justify-center transition-all"
          style={{
            background: flashOn
              ? "rgba(251,191,36,0.9)"
              : "rgba(15,23,42,0.6)",
            backdropFilter: "blur(4px)",
            border: "1px solid rgba(255,255,255,0.15)",
          }}
        >
          <Flashlight
            size={16}
            className={flashOn ? "text-slate-900" : "text-white"}
          />
        </button>
      )}
      <button
        onClick={onZoom}
        aria-label="Zoom"
        className="w-9 h-9 rounded-full flex items-center justify-center"
        style={{
          background: "rgba(15,23,42,0.6)",
          backdropFilter: "blur(4px)",
          border: "1px solid rgba(255,255,255,0.15)",
        }}
      >
        <ZoomIn size={14} className="text-white" />
      </button>
    </div>
  );
}
