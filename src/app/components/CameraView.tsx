import { useState, useEffect, useRef, useCallback } from "react";
import { AppHeader } from "./AppHeader";
import { TopNav } from "./TopNav";
import { motion, AnimatePresence } from "motion/react";
import { Flashlight, ZoomIn, Info, Mic, MicOff } from "lucide-react";
import { useCamera } from "../hooks/useCamera";
import { useAudio } from "../hooks/useAudio";
import { useGemini } from "../hooks/useGemini";
import { useVoiceActivation } from "../hooks/useVoiceActivation";

type BoundingBox = {
  id: number;
  label: string;
  distance: string;
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
};

type DetectionResult = {
  label: string;
  distance: string;
  confidence: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

const isDevelopment = import.meta.env.VITE_ENVIRONMENT !== "production";

export function CameraView() {
  // ─── State ───────────────────────────────────────────────────────────────────

  const [activeBoxes, setActiveBoxes] = useState<BoundingBox[]>([]);
  const [scanning, setScanning] = useState(true);
  const [scanLine, setScanLine] = useState(0);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceActivationEnabled] = useState(true);

  const abortControllerRef = useRef<AbortController | null>(null);
  const captureTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAnalysisInProgressRef = useRef(false);

  // Stable refs for callbacks used inside useVoiceActivation closures
  const executeSingleAnalysisRef = useRef<
    ((transcript?: string) => Promise<void>) | null
  >(null);
  const startVoiceListeningRef = useRef<(() => Promise<void>) | null>(null);

  // ─── Hooks ────────────────────────────────────────────────────────────────────

  const {
    isActive: cameraActive,
    error: cameraError,
    permissionGranted: cameraPermission,
    flashAvailable,
    flashOn,
    videoRef,
    startCamera,
    stopCamera,
    toggleFlash,
    captureFrame,
  } = useCamera({
    width: 1280,
    height: 720,
    facingMode: "environment",
    frameRate: 30,
  });

  const {
    isSpeaking: audioSpeaking,
    error: audioError,
    audioLevel,
    startListening: startAudioListening,
    stopListening: stopAudioListening,
    speakText,
    cancelSpeech,
  } = useAudio({ sendSampleRate: 16000, enableEchoCancellation: true });

  const {
    isConnected: geminiConnected,
    isLoading: geminiLoading,
    error: geminiError,
    sendImageWithPrompt,
    cancelActiveRequest,
  } = useGemini();

  const {
    isBackgroundListening,
    isActive: voiceActive,
    isProcessing: voiceProcessing,
    transcript: userTranscript,
    error: voiceError,
    startBackgroundListening,
    pauseRecognition,
    resumeRecognition,
    resetActive,
  } = useVoiceActivation({
    silenceTimeout: 4000,
    onActivation: () => {
      if (!isAnalysisInProgressRef.current) {
        startVoiceListeningRef.current?.();
      }
    },
    onSilence: (transcript: string) => {
      executeSingleAnalysisRef.current?.(transcript);
    },
  });

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
    if (voiceActivationEnabled) {
      const t = setTimeout(() => startBackgroundListening(), 1000);
      return () => {
        clearTimeout(t);
        stopCamera();
        cancelAnalysis();
      };
    }
    return () => {
      stopCamera();
      cancelAnalysis();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Analysis ────────────────────────────────────────────────────────────────

  const executeSingleAnalysis = useCallback(
    async (transcript?: string) => {
      if (isAnalysisInProgressRef.current) return;
      isAnalysisInProgressRef.current = true;

      // Stop mic input — no longer needed during analysis
      stopAudioListening();
      setIsListening(false);
      setIsAnalyzing(true);

      // Pause wake-word recognition for the ENTIRE cycle.
      // Single pause here, single resume in finally — no per-utterance flickering.
      pauseRecognition();

      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      // Fire-and-forget: speak concurrently with the API request.
      // The speech queue ensures feedback plays AFTER this utterance finishes.
      speakText("Analizando");

      try {
        const frame = captureFrame();
        if (!frame || signal.aborted) return;

        const prompt = transcript
          ? `El usuario dijo: "${transcript}". Responde a lo que pide basandote en la imagen. ` +
            `Si solicita identificar objetos proporciona maximo 4 con distancias aproximadas. ` +
            `Responde en JSON con 'feedback' y 'detections' (maximo 4 objetos si aplica).`
          : `Describe lo que ves. Identifica maximo 4 objetos principales con distancias aproximadas. ` +
            `Responde en JSON con 'feedback' y 'detections'.`;

        const result = await sendImageWithPrompt(frame, prompt);

        if (signal.aborted) return;

        setFeedbackText(result.feedback);
        setShowFeedback(true);

        const boxes: BoundingBox[] = result.detections
          .slice(0, 4)
          .map((det, idx) => ({
            id: Date.now() + idx,
            ...det,
            confidence: det.confidence ?? 90,
          }));
        if (boxes.length > 0) setActiveBoxes(boxes);

        // Enqueued — plays automatically after "Analizando" finishes
        if (!signal.aborted) speakText(result.feedback);
      } catch (err: any) {
        if (err.name !== "AbortError") {
          console.error("[executeSingleAnalysis]", err);
        }
      } finally {
        isAnalysisInProgressRef.current = false;
        setIsAnalyzing(false);
        abortControllerRef.current = null;
        resetActive();
        // Single resume — recognition restarts after TTS fully settles (350ms in hook)
        resumeRecognition();
      }
    },
    [
      captureFrame,
      sendImageWithPrompt,
      speakText,
      stopAudioListening,
      pauseRecognition,
      resumeRecognition,
      resetActive,
    ],
  );

  const cancelAnalysis = useCallback(() => {
    const hadActivity =
      isAnalysisInProgressRef.current || !!abortControllerRef.current;

    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    cancelActiveRequest();

    if (captureTimeoutRef.current) {
      clearTimeout(captureTimeoutRef.current);
      captureTimeoutRef.current = null;
    }

    cancelSpeech();

    isAnalysisInProgressRef.current = false;
    setIsAnalyzing(false);
    setIsListening(false);
    resetActive();

    // Ensure recognition resumes even after an aborted cycle
    resumeRecognition();

    if (hadActivity) speakText("Cancelando");
  }, [
    cancelActiveRequest,
    cancelSpeech,
    speakText,
    resetActive,
    resumeRecognition,
  ]);

  // ─── Assign stable refs ───────────────────────────────────────────────────────

  useEffect(() => {
    executeSingleAnalysisRef.current = executeSingleAnalysis;
  }, [executeSingleAnalysis]);

  // ─── Voice listening (wake word activation) ───────────────────────────────────

  const startVoiceListening = useCallback(async () => {
    const started = await startAudioListening();
    if (!started) return;
    setIsListening(true);
    // No pause here — recognition stays running so the user's question is captured.
    // "Escuchando" is not a wake word so it won't re-trigger activation.
    speakText("Escuchando");
  }, [startAudioListening, speakText]);

  useEffect(() => {
    startVoiceListeningRef.current = startVoiceListening;
  }, [startVoiceListening]);

  const interruptAndStartListening = useCallback(async () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    cancelActiveRequest();
    stopAudioListening();
    cancelSpeech();
    isAnalysisInProgressRef.current = false;
    setIsAnalyzing(false);
    setIsListening(false);
    resetActive();

    await speakText("Cancelando");

    const started = await startAudioListening();
    if (!started) return;
    setIsListening(true);
  }, [
    cancelActiveRequest,
    cancelSpeech,
    resetActive,
    speakText,
    startAudioListening,
    stopAudioListening,
  ]);

  // ─── Mic button ───────────────────────────────────────────────────────────────

  /**
   * analyzing  ->  cancel everything
   * listening  ->  stop mic, run analysis immediately (no transcript)
   * idle       ->  request permission, start listening
   */
  const handleMicPress = useCallback(async () => {
    if (isListening) {
      stopAudioListening();
      setIsListening(false);
      await executeSingleAnalysis();
      return;
    }

    if (isAnalyzing || geminiLoading || audioSpeaking) {
      await interruptAndStartListening();
      return;
    }

    const started = await startAudioListening();
    if (!started) return;
    setIsListening(true);
    speakText("Escuchando, tocar para analizar");
  }, [
    isAnalyzing,
    isListening,
    geminiLoading,
    audioSpeaking,
    stopAudioListening,
    executeSingleAnalysis,
    interruptAndStartListening,
    startAudioListening,
    speakText,
  ]);

  // ─── Replay last feedback ─────────────────────────────────────────────────────

  const handleSpeakFeedback = useCallback(() => {
    if (feedbackText) speakText(feedbackText);
  }, [feedbackText, speakText]);

  return (
    <>
      <AppHeader />
      <div
        className="flex flex-col flex-1 overflow-hidden"
        style={{ background: "#F8FAFC" }}
      >
        {/* Camera frame */}
        <div
          className="mx-4 mt-12 relative overflow-hidden rounded-3xl bg-slate-800 shadow-md"
          style={{ minHeight: "calc(100dvh - 220px)" }}
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

          {/* Error overlay */}
          {cameraError && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900 text-white text-center px-4">
              <span className="text-lg font-semibold">{cameraError}</span>
            </div>
          )}

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

          {/* Audio level indicator when listening */}
          {isListening && (
            <div className="absolute top-3 left-3 bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5 flex items-center gap-2">
              <Mic size={12} className="text-red-400" />
              <div className="w-16 h-1.5 bg-white/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-red-400 transition-all duration-100"
                  style={{ width: `${audioLevel * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* Voice activation indicator */}
          {isBackgroundListening && !isListening && !isAnalyzing && (
            <div className="absolute top-3 left-3 bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-green-400 text-xs">
                Escuchando comandos de voz
              </span>
            </div>
          )}

          {/* Scan line */}
          {isDevelopment && userTranscript && (
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
              {userTranscript}
            </div>
          )}

          <AnimatePresence>
            {scanning && cameraActive && (
              <motion.div
                className="absolute left-0 right-0 h-px z-10"
                style={{
                  top: `${scanLine}%`,
                  background:
                    "linear-gradient(90deg, transparent, #3B82F6 20%, #60A5FA 50%, #3B82F6 80%, transparent)",
                  boxShadow: "0 0 8px 2px rgba(59,130,246,0.6)",
                }}
              />
            )}
          </AnimatePresence>

          {/* Corner markers */}
          {[
            { top: "8px", left: "8px", borderTop: true, borderLeft: true },
            { top: "8px", right: "8px", borderTop: true, borderRight: true },
            {
              bottom: "8px",
              left: "8px",
              borderBottom: true,
              borderLeft: true,
            },
            {
              bottom: "8px",
              right: "8px",
              borderBottom: true,
              borderRight: true,
            },
          ].map((corner, i) => {
            const {
              top,
              left,
              right,
              bottom,
              borderTop,
              borderLeft,
              borderRight,
              borderBottom,
            } = corner;
            return (
              <div
                key={i}
                className="absolute w-5 h-5"
                style={{
                  ...(top !== undefined ? { top } : {}),
                  ...(left !== undefined ? { left } : {}),
                  ...(right !== undefined ? { right } : {}),
                  ...(bottom !== undefined ? { bottom } : {}),
                  borderColor: "rgba(59,130,246,0.8)",
                  borderWidth: "2px",
                  borderTopWidth: borderTop ? "2px" : "0",
                  borderLeftWidth: borderLeft ? "2px" : "0",
                  borderRightWidth: borderRight ? "2px" : "0",
                  borderBottomWidth: borderBottom ? "2px" : "0",
                  borderStyle: "solid",
                }}
              />
            );
          })}

          {/* Bounding boxes */}
          <AnimatePresence>
            {cameraActive &&
              activeBoxes.map((box) => (
                <motion.div
                  key={box.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.3 }}
                  className="absolute"
                  style={{
                    left: `${box.x}%`,
                    top: `${box.y}%`,
                    width: `${box.w}%`,
                    height: `${box.h}%`,
                  }}
                >
                  {/* Dotted border */}
                  <div
                    className="absolute inset-0 rounded-lg"
                    style={{
                      border: "1.5px dashed rgba(96, 165, 250, 0.85)",
                      boxShadow:
                        "inset 0 0 8px rgba(59,130,246,0.1), 0 0 4px rgba(59,130,246,0.2)",
                    }}
                  />

                  {/* Label */}
                  <div
                    className="absolute -top-5 left-0 flex items-center gap-1 rounded-md px-1.5 py-0.5"
                    style={{
                      background: "rgba(15, 23, 42, 0.85)",
                      backdropFilter: "blur(4px)",
                    }}
                  >
                    <span
                      className="text-blue-300 font-medium"
                      style={{ fontSize: "9px", whiteSpace: "nowrap" }}
                    >
                      {box.label}
                    </span>
                    {box.distance && (
                      <>
                        <span className="w-px h-3 bg-slate-500" />
                        <span
                          className="text-emerald-400"
                          style={{ fontSize: "9px" }}
                        >
                          {box.distance}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Confidence dot */}
                  {box.confidence >= 90 && (
                    <div
                      className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-400"
                      style={{ boxShadow: "0 0 4px rgba(52,211,153,0.8)" }}
                    />
                  )}
                </motion.div>
              ))}
          </AnimatePresence>

          {/* Camera controls overlay */}
          <div className="absolute bottom-3 right-3 flex flex-col gap-2">
            {/* Flash button - only shown if available */}
            {flashAvailable && (
              <button
                onClick={toggleFlash}
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
        </div>

        {/* Mic button and quick actions */}
        <div
          onClick={handleMicPress}
          className="flex flex-col fixed bottom-0 w-full items-center pb-6 pt-2"
        >
          <p style={{ fontSize: "12px" }} className="text-gray-400 mb-3">
            {isAnalyzing
              ? "Analizando... Toca para cancelar"
              : isListening
                ? "Escuchando... Toca para analizar"
                : isBackgroundListening
                  ? "Di 'analiza' o toca para hablar"
                  : "Toca para hablar"}
          </p>

          {/* Neumorphic mic button */}
          <motion.button
            whileTap={{ scale: 0.93 }}
            aria-label={
              isAnalyzing
                ? "Cancelar análisis"
                : isListening
                  ? "Detener y analizar"
                  : "Activar micrófono"
            }
            aria-pressed={isListening || isAnalyzing}
            className="relative flex items-center justify-center rounded-full transition-all duration-200 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-400"
            style={{
              width: 80,
              height: 80,
              background: isAnalyzing
                ? "linear-gradient(145deg, #F59E0B, #D97706)"
                : isListening
                  ? "linear-gradient(145deg, #3B82F6, #2563EB)"
                  : "#F1F5F9",
              boxShadow: isAnalyzing
                ? "0 8px 24px rgba(245,158,11,0.45), inset 0 1px 0 rgba(255,255,255,0.2)"
                : isListening
                  ? "0 8px 24px rgba(59,130,246,0.45), inset 0 1px 0 rgba(255,255,255,0.2)"
                  : "8px 8px 16px #d1d9e0, -8px -8px 16px #ffffff",
            }}
          >
            {/* Pulse rings when analyzing or listening */}
            {(isAnalyzing || isListening) && (
              <>
                <motion.div
                  className="absolute inset-0 rounded-full bg-white/30"
                  animate={{ scale: [1, 1.5, 1.5], opacity: [0.4, 0, 0] }}
                  transition={{
                    duration: 1.5,
                    repeat: Infinity,
                    ease: "easeOut",
                  }}
                />
                <motion.div
                  className="absolute inset-0 rounded-full bg-white/20"
                  animate={{ scale: [1, 1.8, 1.8], opacity: [0.3, 0, 0] }}
                  transition={{
                    duration: 1.5,
                    repeat: Infinity,
                    ease: "easeOut",
                    delay: 0.3,
                  }}
                />
              </>
            )}

            {isAnalyzing ? (
              <svg
                width="30"
                height="30"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="relative z-10"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : isListening ? (
              <MicOff
                size={30}
                className="text-white relative z-10"
                strokeWidth={2}
              />
            ) : (
              <Mic
                size={30}
                strokeWidth={2}
                style={{ color: "#1E3A5F" }}
                className="relative z-10"
              />
            )}
          </motion.button>
        </div>

        {/* Error messages */}
        {(cameraError || audioError || geminiError || voiceError) && (
          <div className="mx-4 mt-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
            <p style={{ fontSize: "11px" }} className="text-red-600">
              {cameraError || audioError || geminiError || voiceError}
            </p>
          </div>
        )}
      </div>
    </>
  );
}
