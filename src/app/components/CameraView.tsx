import { useState, useEffect, useRef, useCallback } from "react";
import { AppHeader } from "./AppHeader";
import { motion, AnimatePresence } from "motion/react";
import { Flashlight, ZoomIn, Mic, MicOff } from "lucide-react";
import { useCamera } from "../hooks/useCamera";
import { useAudio } from "../hooks/useAudio";
import { useGemini } from "../hooks/useGemini";
import { useVoiceActivation } from "../hooks/useVoiceActivation";
import { isLikelyMobileBrowser } from "../lib/browserSupport";

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

export function CameraView() {
  const [activeBoxes, setActiveBoxes] = useState<BoundingBox[]>([]);
  const [scanning, setScanning] = useState(true);
  const [scanLine, setScanLine] = useState(0);
  const [feedbackText, setFeedbackText] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceActivationEnabled] = useState(true);

  const captureTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isSpeakingRef = useRef(false);
  const isAnalysisInProgressRef = useRef(false);
  const isListeningRef = useRef(false);
  const isAnalyzingRef = useRef(false);
  const executeSingleAnalysisRef = useRef<
    ((transcript?: string) => Promise<void>) | null
  >(null);

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  useEffect(() => {
    isAnalyzingRef.current = isAnalyzing;
  }, [isAnalyzing]);

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
  } = useCamera({
    width: 1280,
    height: 720,
    facingMode: "environment",
    frameRate: 30,
  });

  const {
    isSpeaking: audioSpeaking,
    error: audioError,
    speakText,
  } = useAudio({
    sendSampleRate: 16000,
    enableEchoCancellation: true,
  });

  const { error: geminiError, sendImageWithPrompt } = useGemini();
  const shouldAutoStartVoice = voiceActivationEnabled && !isLikelyMobileBrowser();

  const {
    isBackgroundListening,
    isActive: voiceActive,
    isProcessing: voiceProcessing,
    transcript: userTranscript,
    error: voiceError,
    startBackgroundListening,
    stopBackgroundListening,
    startManualListening,
    submitActiveListening,
    cancelActiveListening,
    resetActive,
  } = useVoiceActivation({
    silenceTimeout: 3500,
    onActivation: () => {
      if (!isAnalyzingRef.current) {
        setIsListening(true);
      }
    },
    onSilence: async (transcript: string) => {
      setIsListening(false);

      if (executeSingleAnalysisRef.current) {
        const trimmedTranscript = transcript.trim();
        await executeSingleAnalysisRef.current(trimmedTranscript || undefined);
      }
    },
  });

  useEffect(() => {
    if (userTranscript) {
      console.log("[Voice Transcript]", userTranscript);
    }
  }, [userTranscript]);

  useEffect(() => {
    if (voiceError) {
      setIsListening(false);
    }
  }, [voiceError]);

  useEffect(() => {
    let progress = 0;
    const scanInterval = setInterval(() => {
      progress += 2;
      setScanLine(progress % 100);
    }, 40);

    return () => clearInterval(scanInterval);
  }, []);

  const speakStatus = useCallback(
    async (text: string) => {
      window.speechSynthesis.cancel();
      isSpeakingRef.current = true;

      try {
        await speakText(text);
      } finally {
        isSpeakingRef.current = false;
      }
    },
    [speakText],
  );

  const executeSingleAnalysis = useCallback(
    async (spokenTranscript?: string) => {
      if (isAnalysisInProgressRef.current) {
        console.warn("Analysis already in progress, ignoring request");
        return;
      }

      isAnalysisInProgressRef.current = true;
      setIsAnalyzing(true);
      setIsListening(false);

      speakStatus("Analizando");
      abortControllerRef.current = new AbortController();

      try {
        const frame = captureFrame();
        if (!frame || !abortControllerRef.current) {
          return;
        }

        const prompt = spokenTranscript
          ? `El usuario dijo: "${spokenTranscript}". Responde a lo que pide el usuario basándote en lo que ves en la imagen. Si el usuario pide identificar objetos, proporciona máximo 4 objetos con distancias aproximadas. Responde en formato JSON con "feedback" y "detections".`
          : `Describe lo que ves en esta imagen de la cámara. Identifica máximo 4 objetos principales y sus distancias aproximadas. Responde en formato JSON con "feedback" y "detections".`;

        const result = await sendImageWithPrompt(frame, prompt);

        if (abortControllerRef.current?.signal.aborted) {
          return;
        }

        setFeedbackText(result.feedback);

        const now = Date.now();
        const boxes: BoundingBox[] = result.detections
          .slice(0, 4)
          .map((item, index) => ({
            id: now + index,
            ...item,
            confidence: item.confidence || 90,
          }));
        setActiveBoxes(boxes);

        if (result.feedback && !isSpeakingRef.current) {
          isSpeakingRef.current = true;
          await speakText(result.feedback);
          isSpeakingRef.current = false;
        }

        resetActive();
      } catch (error: any) {
        if (error?.name !== "AbortError") {
          console.error("Error analyzing frame:", error);
        }
        resetActive();
      } finally {
        isAnalysisInProgressRef.current = false;
        setIsAnalyzing(false);
        abortControllerRef.current = null;
      }
    },
    [captureFrame, resetActive, sendImageWithPrompt, speakStatus, speakText],
  );

  useEffect(() => {
    executeSingleAnalysisRef.current = executeSingleAnalysis;
  }, [executeSingleAnalysis]);

  const cancelAnalysis = useCallback(() => {
    const hadAnalysis =
      isAnalysisInProgressRef.current || abortControllerRef.current;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    if (captureTimeoutRef.current) {
      clearTimeout(captureTimeoutRef.current);
      captureTimeoutRef.current = null;
    }

    window.speechSynthesis.cancel();
    isSpeakingRef.current = false;
    isAnalysisInProgressRef.current = false;
    setIsAnalyzing(false);
    setIsListening(false);
    void cancelActiveListening();

    if (hadAnalysis) {
      void speakStatus("Cancelando");
    }
  }, [cancelActiveListening, speakStatus]);

  useEffect(() => {
    startCamera();

    if (shouldAutoStartVoice) {
      const timer = setTimeout(() => {
        startBackgroundListening();
      }, 1000);

      return () => {
        clearTimeout(timer);
        stopBackgroundListening();
        stopCamera();
        cancelAnalysis();
      };
    }

    return () => {
      stopCamera();
      cancelAnalysis();
    };
  }, [
    cancelAnalysis,
    shouldAutoStartVoice,
    startBackgroundListening,
    startCamera,
    stopBackgroundListening,
    stopCamera,
  ]);

  const handleMicPress = useCallback(async () => {
    if (isAnalyzing) {
      cancelAnalysis();
      return;
    }

    if (isListening || voiceActive) {
      await submitActiveListening({ allowEmpty: true });
      return;
    }

    setIsListening(true);
    const started = startManualListening();

    if (!started) {
      setIsListening(false);
    }
  }, [
    cancelAnalysis,
    isAnalyzing,
    isListening,
    startManualListening,
    submitActiveListening,
    voiceActive,
  ]);

  const transcriptToShow = userTranscript.trim() || feedbackText.trim();

  return (
    <>
      <AppHeader />
      <div
        className="flex flex-col flex-1 overflow-hidden"
        style={{ background: "#F8FAFC" }}
      >
        <div
          className="m-4 relative overflow-hidden rounded-3xl bg-slate-800 shadow-md"
          style={{ minHeight: "calc(100dvh - 220px)" }}
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 h-full w-full object-cover"
            style={{ display: cameraActive ? "block" : "none" }}
          />

          {cameraError && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900 px-4 text-center text-white">
              <span className="text-lg font-semibold">{cameraError}</span>
            </div>
          )}

          {!cameraActive && !cameraError && (
            <div
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(160deg, #1a2332 0%, #243447 40%, #1c2d3f 70%, #0f1923 100%)",
              }}
            />
          )}

          <div
            className="absolute inset-0 opacity-10"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.15) 1px, transparent 1px)",
              backgroundSize: "40px 40px",
            }}
          />

          {isListening && (
            <div className="absolute top-3 left-3 rounded-full bg-black/50 px-3 py-1.5 backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <Mic size={12} className="text-red-400" />
                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/20">
                  <motion.div
                    className="h-full bg-red-400"
                    animate={{ width: ["20%", "95%", "35%"] }}
                    transition={{
                      duration: 1.2,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {isBackgroundListening && !isListening && !isAnalyzing && (
            <div className="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-black/50 px-3 py-1.5 backdrop-blur-sm">
              <div className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs text-green-400">
                Escuchando comandos de voz
              </span>
            </div>
          )}

          {transcriptToShow &&
            (isListening || voiceProcessing || voiceActive) && (
              <div
                className="absolute left-4 bottom-4 z-50 rounded-xl bg-black/60 px-4 py-2 text-white shadow-lg"
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
                {transcriptToShow}
              </div>
            )}

          <AnimatePresence>
            {scanning && cameraActive && (
              <motion.div
                className="absolute left-0 right-0 z-10 h-px"
                style={{
                  top: `${scanLine}%`,
                  background:
                    "linear-gradient(90deg, transparent, #3B82F6 20%, #60A5FA 50%, #3B82F6 80%, transparent)",
                  boxShadow: "0 0 8px 2px rgba(59,130,246,0.6)",
                }}
              />
            )}
          </AnimatePresence>

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
          ].map((corner, index) => {
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
                key={index}
                className="absolute h-5 w-5"
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
                  <div
                    className="absolute inset-0 rounded-lg"
                    style={{
                      border: "1.5px dashed rgba(96, 165, 250, 0.85)",
                      boxShadow:
                        "inset 0 0 8px rgba(59,130,246,0.1), 0 0 4px rgba(59,130,246,0.2)",
                    }}
                  />

                  <div
                    className="absolute -top-5 left-0 flex items-center gap-1 rounded-md px-1.5 py-0.5"
                    style={{
                      background: "rgba(15, 23, 42, 0.85)",
                      backdropFilter: "blur(4px)",
                    }}
                  >
                    <span
                      className="font-medium text-blue-300"
                      style={{ fontSize: "9px", whiteSpace: "nowrap" }}
                    >
                      {box.label}
                    </span>
                    {box.distance && (
                      <>
                        <span className="h-3 w-px bg-slate-500" />
                        <span
                          className="text-emerald-400"
                          style={{ fontSize: "9px" }}
                        >
                          {box.distance}
                        </span>
                      </>
                    )}
                  </div>

                  {box.confidence >= 90 && (
                    <div
                      className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-emerald-400"
                      style={{ boxShadow: "0 0 4px rgba(52,211,153,0.8)" }}
                    />
                  )}
                </motion.div>
              ))}
          </AnimatePresence>

          <div className="absolute bottom-3 right-3 flex flex-col gap-2">
            {flashAvailable && (
              <button
                onClick={toggleFlash}
                aria-label={flashOn ? "Apagar linterna" : "Encender linterna"}
                className="flex h-9 w-9 items-center justify-center rounded-full transition-all"
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
              className="flex h-9 w-9 items-center justify-center rounded-full"
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

        <div
          onClick={() => {
            void handleMicPress();
          }}
          className="fixed bottom-0 flex w-full flex-col items-center pb-6 pt-2"
        >
          <p style={{ fontSize: "12px" }} className="mb-3 text-gray-400">
            {isAnalyzing
              ? "Analizando... Toca para cancelar"
              : isListening
                ? "Escuchando... Toca para analizar"
                : isBackgroundListening
                  ? "Di 'analiza' o toca para hablar"
                  : "Toca para hablar"}
          </p>

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
                className="relative z-10 text-white"
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

        {(cameraError || audioError || geminiError || voiceError) && (
          <div className="mx-4 mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2">
            <p style={{ fontSize: "11px" }} className="text-red-600">
              {cameraError || audioError || geminiError || voiceError}
            </p>
          </div>
        )}
      </div>
    </>
  );
}
