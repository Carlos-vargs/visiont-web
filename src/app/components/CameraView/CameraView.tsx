import { useState, useEffect } from "react";
import { AppHeader } from "../AppHeader";
import { CornerMarkers } from "./CornerMarkers";
import { ScanLine } from "./ScanLine";
import { AudioLevelIndicator } from "../AudioLevelIndicator";
import { TranscriptOverlay } from "../TranscriptOverlay";
import { BoundingBoxOverlay } from "./BoundingBoxOverlay";
import { CameraControls } from "./CameraControls";
import { MicButton, type MicButtonMode } from "../MicButton";
import { ErrorOverlay } from "../ErrorOverlay";
import { InlineErrorMessage } from "../InlineErrorMessage";
import { useCamera } from "../../hooks/useCamera";
import { useAudio } from "../../hooks/useAudio";
import { useCameraInteractionController } from "../../hooks/useCameraInteractionController";
import { useGemini } from "../../hooks/useGemini";

const isDevelopment = import.meta.env.VITE_ENVIRONMENT !== "production";

export function CameraView() {
  // ─── State ───────────────────────────────────────────────────────────────────

  const [scanning, setScanning] = useState(true);
  const [scanLine, setScanLine] = useState(0);

  // ─── Hooks ────────────────────────────────────────────────────────────────────

  const {
    isActive: cameraActive,
    error: cameraError,
    flashAvailable,
    flashOn,
    videoRef,
    startCamera,
    stopCamera,
    toggleFlash,
    captureFrame,
    captureFrameData,
  } = useCamera({
    width: 1280,
    height: 720,
    facingMode: "environment",
    frameRate: 30,
  });

  const audio = useAudio({
    sendSampleRate: 16000,
    enableEchoCancellation: true,
  });

  const {
    error: geminiError,
    sendImageWithPrompt,
    cancelActiveRequest,
  } = useGemini();

  const {
    mode,
    transcript: userTranscript,
    audioLevel,
    hasRealAudioLevel,
    statusMessage,
    errorMessage,
    activeBoxes,
    handleMicPress,
    cleanup: cleanupInteraction,
  } = useCameraInteractionController({
    audio,
    captureFrame,
    captureFrameData,
    sendImageWithPrompt,
    cancelActiveRequest,
  });

  const isListening = mode === "starting" || mode === "listening";
  const isAnalyzing =
    mode === "analyzing" || mode === "speaking" || mode === "cancelling";
  const buttonDisabled = mode === "starting" || mode === "cancelling";
  const isCancelling = mode === "cancelling";
  const micButtonMode: MicButtonMode = isCancelling
    ? "cancelling"
    : isAnalyzing
      ? "analyzing"
      : isListening
        ? "listening"
        : "idle";
  const displayError =
    cameraError ||
    errorMessage ||
    audio.lastAudioError ||
    audio.error ||
    geminiError;

  // ─── Debug transcript log ─────────────────────────────────────────────────────

  useEffect(() => {
    if (userTranscript) console.log("[Voice Transcript]", userTranscript);
  }, [userTranscript]);

  // ─── Scan line animation ──────────────────────────────────────────────────────

  useEffect(() => {
    let prog = 0;
    const id = setInterval(() => {
      prog += 2;
      setScanLine(prog % 100);
    }, 40);
    return () => clearInterval(id);
  }, []);

  // ─── Mount / unmount ─────────────────────────────────────────────────────────

  useEffect(() => {
    startCamera();

    return () => {
      cleanupInteraction();
      stopCamera();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      data-testid="camera-view-shell"
      className="flex h-full min-h-0 flex-col"
      style={{ background: "#F8FAFC" }}
    >
      <AppHeader />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Camera frame */}
        <div
          data-testid="camera-frame"
          className="mx-4 mt-12 relative min-h-0 flex-1 overflow-hidden rounded-3xl bg-slate-800 shadow-md"
        >
          {/* Camera feed - always rendered for videoRef to exist */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover"
            style={{ display: cameraActive ? "block" : "none" }}
          />

          <ErrorOverlay message={cameraError} />

          {/* Gradient background when camera not active */}
          {!cameraActive && !cameraError && (
            <div
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(160deg, #1a2332 0%, #243447 40%, #1c2d3f 70%, #0f1923 100%)",
              }}
            />
          )}

          {/* Subtle grid overlay */}
          <div
            className="absolute inset-0 opacity-10"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.15) 1px, transparent 1px)",
              backgroundSize: "40px 40px",
            }}
          />

          <AudioLevelIndicator
            isListening={isListening}
            hasRealAudioLevel={hasRealAudioLevel}
            audioLevel={audioLevel}
          />

          <TranscriptOverlay
            transcript={userTranscript}
            visible={isDevelopment}
          />
          <ScanLine visible={scanning && cameraActive} progress={scanLine} />
          <CornerMarkers />
          <BoundingBoxOverlay boxes={activeBoxes} visible={cameraActive} />
          <CameraControls
            flashAvailable={flashAvailable}
            flashOn={flashOn}
            onToggleFlash={toggleFlash}
          />
        </div>

        {/* Mic button and status message */}
        <div
          onClick={handleMicPress}
          className="flex w-full h-52 shrink-0 flex-col items-center justify-center px-4 pb-6 pt-2"
        >
          <p style={{ fontSize: "12px" }} className="text-gray-400 mb-3">
            {statusMessage}
          </p>

          <MicButton
            mode={micButtonMode}
            disabled={buttonDisabled}
            onPress={() => {}}
          />
        </div>

        <InlineErrorMessage message={displayError} />
      </div>
    </div>
  );
}
