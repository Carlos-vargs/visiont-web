type TranscriptOverlayProps = {
  transcript: string;
  visible: boolean;
};

export function TranscriptOverlay({
  transcript,
  visible,
}: TranscriptOverlayProps) {
  if (!visible || !transcript) {
    return null;
  }

  return (
    <div
      className="absolute left-4 bottom-4 bg-black bg-opacity-60 text-white px-4 py-2 rounded-xl shadow-lg z-50"
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
