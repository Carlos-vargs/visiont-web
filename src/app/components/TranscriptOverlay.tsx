type TranscriptOverlayProps = {
  transcript: string;
  visible: boolean;
  className?: string;
};

export function TranscriptOverlay({
  transcript,
  visible,
  className = "",
}: TranscriptOverlayProps) {
  if (!visible || !transcript) {
    return null;
  }

  return (
    <div
      className={`absolute bottom-4 left-4 z-50 rounded-xl bg-black bg-opacity-60 px-4 py-2 text-white shadow-lg ${className}`.trim()}
      style={{ maxWidth: "70%", fontSize: 14, pointerEvents: "none" }}
      data-testid="transcript-overlay"
    >
      <span
        style={{
          fontWeight: "bold",
          opacity: 0.7,
          fontSize: 12,
          marginRight: 6,
        }}
      >
        Transcripción:
      </span>
      {transcript}
    </div>
  );
}
