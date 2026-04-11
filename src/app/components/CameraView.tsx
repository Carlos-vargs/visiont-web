import { useState, useEffect, useRef } from "react";
import { AppHeader } from "./AppHeader";
import { BottomNav } from "./BottomNav";
import { motion, AnimatePresence } from "motion/react";
import { Flashlight, ZoomIn, Info, Mic, MicOff, MessageSquare } from "lucide-react";
import { useCamera } from "../hooks/useCamera";
import { useAudio } from "../hooks/useAudio";
import { useGemini } from "../hooks/useGemini";
import { FeedbackModal } from "./FeedbackModal";

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

const mockDetections: BoundingBox[] = [
  { id: 1, label: "Silla", distance: "1.2 m", x: 15, y: 45, w: 28, h: 38, confidence: 97 },
  { id: 2, label: "Mesa", distance: "1.8 m", x: 50, y: 52, w: 35, h: 28, confidence: 94 },
  { id: 3, label: "Persona", distance: "3.4 m", x: 62, y: 10, w: 22, h: 55, confidence: 99 },
  { id: 4, label: "Puerta", distance: "4.1 m", x: 6, y: 8, w: 18, h: 72, confidence: 91 },
];

const PROFILE_IMAGE = "https://images.unsplash.com/photo-1577565177023-d0f29c354b69?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxwZXJzb24lMjBwb3J0cmFpdCUyMGNsb3NlJTIwdXAlMjBwcm9maWxlfGVufDF8fHx8MTc3NTUyODg1Mnww&ixlib=rb-4.1.0&q=80&w=400";

export function CameraView() {
  const [flashOn, setFlashOn] = useState(false);
  const [activeBoxes, setActiveBoxes] = useState<BoundingBox[]>([]);
  const [scanning, setScanning] = useState(true);
  const [scanLine, setScanLine] = useState(0);
  const [geminiMode, setGeminiMode] = useState<"none" | "voice" | "text">("none");
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);

  const captureIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Hooks
  const {
    isActive: cameraActive,
    error: cameraError,
    permissionGranted: cameraPermission,
    videoRef,
    startCamera,
    stopCamera,
    captureFrame,
  } = useCamera({
    width: 1280,
    height: 720,
    facingMode: "environment",
    frameRate: 30,
  });

  const {
    isListening,
    isSpeaking,
    error: audioError,
    audioLevel,
    startListening,
    stopListening,
    speakText,
  } = useAudio({
    sendSampleRate: 16000,
    enableEchoCancellation: true,
  });

  const {
    isConnected: geminiConnected,
    isLoading: geminiLoading,
    error: geminiError,
    sendImageWithPrompt,
    sendTextMessage,
  } = useGemini();

  // Scan line animation
  useEffect(() => {
    let prog = 0;
    const scanInterval = setInterval(() => {
      prog += 2;
      setScanLine(prog % 100);
    }, 40);
    return () => clearInterval(scanInterval);
  }, []);

  // Start camera on mount
  useEffect(() => {
    if (!cameraEnabled) return;

    startCamera().then(() => {
      // Start periodic frame capture for Gemini
      if (geminiMode !== "none") {
        startGeminiAnalysis();
      }
    });

    return () => {
      stopCamera();
      stopGeminiAnalysis();
    };
  }, [cameraEnabled, geminiMode]);

  const startGeminiAnalysis = () => {
    captureIntervalRef.current = setInterval(async () => {
      const frame = captureFrame();
      if (!frame) return;

      setIsAnalyzing(true);
      try {
        const result = await sendImageWithPrompt(
          frame,
          "Describe lo que ves en esta imagen de la cámara. Identifica objetos, personas, texto y obstáculos. Proporciona distancias aproximadas."
        );

        setFeedbackText(result.feedback);
        setShowFeedback(true);

        // Convert detections to bounding boxes
        const boxes: BoundingBox[] = result.detections.map((det, idx) => ({
          id: idx + 1,
          ...det,
          confidence: det.confidence || 90,
        }));

        if (boxes.length > 0) {
          setActiveBoxes(boxes);
        }

        // Speak feedback if in voice mode
        if (geminiMode === "voice" && result.feedback) {
          speakText(result.feedback);
        }
      } catch (err) {
        console.error("Error analyzing frame:", err);
      } finally {
        setIsAnalyzing(false);
      }
    }, 3000); // Analyze every 3 seconds
  };

  const stopGeminiAnalysis = () => {
    if (captureIntervalRef.current) {
      clearInterval(captureIntervalRef.current);
      captureIntervalRef.current = null;
    }
  };

  const toggleCamera = async () => {
    if (cameraEnabled) {
      stopCamera();
      stopGeminiAnalysis();
      setCameraEnabled(false);
    } else {
      setCameraEnabled(true);
    }
  };

  const toggleGeminiMode = () => {
    if (geminiMode === "none") {
      setGeminiMode("voice");
      if (cameraEnabled) {
        startGeminiAnalysis();
      }
    } else if (geminiMode === "voice") {
      setGeminiMode("text");
    } else {
      setGeminiMode("none");
      stopGeminiAnalysis();
    }
  };

  const handleSpeakFeedback = () => {
    if (feedbackText) {
      speakText(feedbackText);
    }
  };

  // Stagger appearance of bounding boxes (mock data for initial display)
  useEffect(() => {
    const all = mockDetections;
    all.forEach((box, i) => {
      setTimeout(() => {
        setActiveBoxes((prev) => [...prev, box]);
      }, 600 + i * 300);
    });
    setTimeout(() => setScanning(false), 2200);
  }, []);

  return (
    <>
      <AppHeader profileImage={PROFILE_IMAGE} />
      <div className="flex flex-col flex-1 overflow-hidden pb-20" style={{ background: "#F8FAFC" }}>
        {/* Status bar */}
        <div className="mx-4 mt-3 mb-2 flex gap-2 flex-wrap">
          {/* Info banner */}
          <div className="flex-1 min-w-[200px] bg-blue-50 border border-blue-100 rounded-2xl px-4 py-2 flex items-center gap-2">
            <Info size={14} className="text-blue-500 shrink-0" />
            <span style={{ fontSize: "12px" }} className="text-blue-700">
              {scanning
                ? "Analizando entorno..."
                : `${activeBoxes.length} objetos detectados`}
            </span>
            {scanning && (
              <span className="ml-auto w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            )}
          </div>

          {/* Gemini mode indicator */}
          {geminiMode !== "none" && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-3 py-2 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span style={{ fontSize: "12px" }} className="text-emerald-700 font-medium">
                {geminiMode === "voice" ? "🎤 Voz activa" : "💬 Texto activo"}
              </span>
              {isAnalyzing && (
                <span className="w-3 h-3 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              )}
            </div>
          )}
        </div>

        {/* Camera frame */}
        <div className="mx-4 min-h-[44dvh] flex-1 relative overflow-hidden rounded-3xl bg-slate-800 shadow-md">
          {/* Camera feed or simulated gradient */}
          {cameraEnabled && cameraActive ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
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

          {/* Scan line */}
          <AnimatePresence>
            {scanning && (
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
            { bottom: "8px", left: "8px", borderBottom: true, borderLeft: true },
            { bottom: "8px", right: "8px", borderBottom: true, borderRight: true },
          ].map((corner, i) => {
            const { top, left, right, bottom, borderTop, borderLeft, borderRight, borderBottom } = corner;
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
            {activeBoxes.map((box) => (
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
                      <span className="text-emerald-400" style={{ fontSize: "9px" }}>
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

          {/* Flash overlay */}
          {flashOn && (
            <div className="absolute inset-0 bg-yellow-50/10 pointer-events-none" />
          )}

          {/* Camera controls overlay */}
          <div className="absolute bottom-3 right-3 flex flex-col gap-2">
            <button
              onClick={() => setFlashOn((f) => !f)}
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
              <svg width="16" height="16" viewBox="0 0 24 24" fill={flashOn ? "#1a1a1a" : "white"} stroke="none">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </button>
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

        {/* Detections list */}
        <div className="mx-4 mt-3 mb-2">
          <p style={{ fontSize: "11px" }} className="text-gray-400 uppercase tracking-wider mb-2 px-1">
            Objetos detectados
          </p>
          <div className="flex flex-col gap-1.5">
            {activeBoxes.slice(0, 3).map((box) => (
              <motion.div
                key={box.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="bg-white rounded-2xl px-4 py-2 flex items-center justify-between shadow-sm border border-gray-100"
              >
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-400" />
                  <span style={{ fontSize: "13px" }} className="text-slate-700 font-medium">
                    {box.label}
                  </span>
                </div>
                {box.distance && (
                  <span
                    className="bg-slate-100 text-slate-600 rounded-full px-2 py-0.5"
                    style={{ fontSize: "11px" }}
                  >
                    {box.distance}
                  </span>
                )}
              </motion.div>
            ))}
          </div>
        </div>

        {/* Action buttons */}
        <div className="mx-4 mt-2 flex gap-2">
          {/* Camera toggle */}
          <button
            onClick={toggleCamera}
            className="flex-1 bg-white border border-gray-200 rounded-2xl px-4 py-3 shadow-sm active:bg-gray-50 transition-colors"
          >
            <span style={{ fontSize: "13px" }} className="font-medium text-slate-700">
              {cameraEnabled ? "📷 Apagar cámara" : "📷 Encender cámara"}
            </span>
          </button>

          {/* Gemini mode toggle */}
          <button
            onClick={toggleGeminiMode}
            className="flex-1 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-2xl px-4 py-3 shadow-md active:opacity-90 transition-opacity"
          >
            <span style={{ fontSize: "13px" }} className="font-medium flex items-center justify-center gap-2">
              {geminiMode === "none" && <>🤖 Activar Gemini</>}
              {geminiMode === "voice" && <><Mic size={14} /> Modo voz</>}
              {geminiMode === "text" && <><MessageSquare size={14} /> Modo texto</>}
            </span>
          </button>
        </div>

        {/* Error messages */}
        {(cameraError || audioError || geminiError) && (
          <div className="mx-4 mt-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
            <p style={{ fontSize: "11px" }} className="text-red-600">
              {cameraError || audioError || geminiError}
            </p>
          </div>
        )}
      </div>

      {/* Feedback Modal */}
      <FeedbackModal
        isOpen={showFeedback}
        onClose={() => setShowFeedback(false)}
        feedback={feedbackText}
        onSpeak={handleSpeakFeedback}
        isLoading={isAnalyzing}
      />

      <BottomNav />
    </>
  );
}
