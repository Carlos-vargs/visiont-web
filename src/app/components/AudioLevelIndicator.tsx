import { Mic } from "lucide-react";

type AudioLevelIndicatorProps = {
  isListening: boolean;
  hasRealAudioLevel: boolean;
  audioLevel: number;
  label?: string;
  className?: string;
};

export function AudioLevelIndicator({
  isListening,
  hasRealAudioLevel,
  audioLevel,
  label = "Escuchando",
  className = "",
}: AudioLevelIndicatorProps) {
  if (!isListening) {
    return null;
  }

  return (
    <div
      className={`absolute top-3 left-3 flex items-center gap-2 rounded-full bg-black/50 px-3 py-1.5 backdrop-blur-sm ${className}`.trim()}
    >
      <Mic size={12} className="text-red-400" />
      {hasRealAudioLevel ? (
        <div className="w-16 h-1.5 bg-white/20 rounded-full overflow-hidden">
          <div
            className="h-full bg-red-400 transition-all duration-100"
            style={{ width: `${audioLevel * 100}%` }}
          />
        </div>
      ) : (
        <span className="text-white" style={{ fontSize: 11 }}>
          {label}
        </span>
      )}
    </div>
  );
}
