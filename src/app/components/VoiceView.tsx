import { useState, useEffect, useCallback, useRef } from "react";
import { AppHeader } from "./AppHeader";
import { BottomNav } from "./BottomNav";
import { Mic, MicOff, Volume2, Camera } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { AudioWave } from "./AudioWave";
import { useGemini } from "../hooks/useGemini";
import { useAudio } from "../hooks/useAudio";
import { useCamera } from "../hooks/useCamera";
import { FeedbackModal } from "./FeedbackModal";

const PROFILE_IMAGE = "https://images.unsplash.com/photo-1577565177023-d0f29c354b69?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxwZXJzb24lMjBwb3J0cmFpdCUyMGNsb3NlJTIwdXAlMjBwcm9maWxlfGVufDF8fHx8MTc3NTUyODg1Mnww&ixlib=rb-4.1.0&q=80&w=400";

export function VoiceView() {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [messages, setMessages] = useState<
    Array<{ id: number; text: string; sender: "assistant" | "user" }>
  >([{ id: 0, text: "Hola, estoy listo para ayudarte. ¿Qué necesitas?", sender: "assistant" }]);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [cameraPreview, setCameraPreview] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Hooks
  const {
    isLoading: geminiLoading,
    error: geminiError,
    sendTextMessage,
    sendImageWithPrompt,
  } = useGemini();

  const {
    isListening: audioListening,
    isSpeaking: audioSpeaking,
    error: audioError,
    audioLevel,
    startListening,
    stopListening,
    speakText,
    requestMicrophonePermission,
  } = useAudio({
    sendSampleRate: 16000,
    enableEchoCancellation: true,
  });

  const {
    isActive: cameraActive,
    error: cameraError,
    videoRef,
    startCamera,
    stopCamera,
    captureFrame,
  } = useCamera({
    width: 640,
    height: 480,
    facingMode: "environment",
  });

  const isActive = audioListening || audioSpeaking;

  // Handle mic press
  const handleMicPress = useCallback(async () => {
    if (isListening) {
      // Stop listening and send audio to Gemini
      stopListening();
      setIsListening(false);

      // For now, simulate with text input
      // In a full implementation, we'd convert the recorded audio to text
      const userText = "¿Qué hay frente a mí?";
      setMessages((prev) => [
        ...prev,
        { id: Date.now(), text: userText, sender: "user" },
      ]);

      // Get response from Gemini
      try {
        const response = await sendTextMessage(userText);
        setMessages((prev) => [
          ...prev,
          { id: Date.now() + 1, text: response, sender: "assistant" },
        ]);
        setFeedbackText(response);
        setShowFeedback(true);

        // Speak the response
        speakText(response);
      } catch (err) {
        console.error("Error getting Gemini response:", err);
      }
    } else {
      // Request permission first
      const granted = await requestMicrophonePermission();
      if (granted) {
        setIsListening(true);

        // Start listening with callback for audio chunks
        startListening();
      }
    }
  }, [isListening, startListening, stopListening, sendTextMessage, speakText, requestMicrophonePermission]);

  // Quick action handlers
  const handleQuickAction = useCallback(
    async (action: string) => {
      if (action === "camera") {
        // Toggle camera preview
        if (showCamera) {
          setShowCamera(false);
          stopCamera();
        } else {
          setShowCamera(true);
          await startCamera();

          // Capture a frame after camera is ready
          setTimeout(() => {
            const frame = captureFrame();
            if (frame) {
              setCameraPreview(frame);
            }
          }, 1000);
        }
        return;
      }

      // Text-based quick actions
      const userText = action;
      setMessages((prev) => [
        ...prev,
        { id: Date.now(), text: userText, sender: "user" },
      ]);

      try {
        let response: string;

        if (action === "¿Qué hay frente a mí?" && cameraPreview) {
          // Send captured frame to Gemini
          response = await sendImageWithPrompt(
            cameraPreview,
            "Describe detalladamente lo que ves en esta imagen. ¿Qué objetos hay? ¿Hay personas? ¿Hay obstáculos? ¿Hay texto visible? Proporciona distancias aproximadas."
          );
        } else {
          response = await sendTextMessage(userText);
        }

        setMessages((prev) => [
          ...prev,
          { id: Date.now() + 1, text: response, sender: "assistant" },
        ]);
        setFeedbackText(response);
        setShowFeedback(true);

        // Speak the response
        speakText(response);
      } catch (err) {
        console.error("Error getting Gemini response:", err);
      }
    },
    [
      showCamera,
      cameraPreview,
      startCamera,
      stopCamera,
      captureFrame,
      sendImageWithPrompt,
      sendTextMessage,
      speakText,
    ]
  );

  const handleSpeakFeedback = useCallback(() => {
    if (feedbackText) {
      speakText(feedbackText);
    }
  }, [feedbackText, speakText]);

  return (
    <>
      <AppHeader profileImage={PROFILE_IMAGE} />
      <div className="flex flex-col flex-1 overflow-hidden pb-20" style={{ background: "#F8FAFC" }}>
        {/* Status pills */}
        <div className="flex items-center justify-center gap-2 px-5 pt-3 pb-1">
          <AnimatePresence mode="wait">
            {audioListening && (
              <motion.div
                key="listening"
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                className="flex items-center gap-1.5 bg-blue-50 border border-blue-200 rounded-full px-3 py-1"
              >
                <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                <span style={{ fontSize: "12px" }} className="text-blue-700 font-medium">
                  Escuchando...
                </span>
              </motion.div>
            )}
            {audioSpeaking && !audioListening && (
              <motion.div
                key="speaking"
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1"
              >
                <Volume2 size={12} className="text-emerald-600" />
                <span style={{ fontSize: "12px" }} className="text-emerald-700 font-medium">
                  Asistente hablando
                </span>
              </motion.div>
            )}
            {!audioListening && !audioSpeaking && (
              <motion.div
                key="idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-1.5 bg-gray-100 rounded-full px-3 py-1"
              >
                <span className="w-2 h-2 rounded-full bg-gray-400" />
                <span style={{ fontSize: "12px" }} className="text-gray-500 font-medium">
                  En espera
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Camera preview (when enabled) */}
        {showCamera && (
          <div className="mx-5 mt-2 bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="relative h-48 bg-slate-800">
              {cameraActive && videoRef.current ? (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-white text-sm">Cámara activada</p>
                </div>
              )}

              {/* Camera controls */}
              <div className="absolute top-2 right-2 flex gap-2">
                <button
                  onClick={() => {
                    const frame = captureFrame();
                    if (frame) {
                      setCameraPreview(frame);
                    }
                  }}
                  className="bg-black/50 backdrop-blur-sm text-white rounded-full p-2 hover:bg-black/60 transition-colors"
                  aria-label="Capturar frame"
                >
                  <Camera size={16} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Wave visualizer card */}
        <div className="mx-5 mt-2 bg-white rounded-3xl shadow-sm border border-gray-100 p-4">
          <AudioWave isActive={isActive} color={audioListening ? "#3B82F6" : audioSpeaking ? "#10B981" : "#CBD5E1"} />
        </div>

        {/* Chat messages */}
        <div className="flex-1 overflow-y-auto px-5 py-3 flex flex-col justify-end gap-2">
          <AnimatePresence initial={false}>
            {messages.slice(-4).map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 16, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.3 }}
                className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-sm
                    ${
                      msg.sender === "user"
                        ? "bg-slate-900 text-white rounded-br-sm"
                        : "bg-white text-slate-800 border border-gray-100 rounded-bl-sm"
                    }`}
                >
                  {msg.sender === "assistant" && (
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <div className="w-4 h-4 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                        <Volume2 size={8} className="text-white" />
                      </div>
                      <span style={{ fontSize: "10px" }} className="text-slate-400 font-medium uppercase tracking-wider">
                        VisionAI
                      </span>
                    </div>
                  )}
                  <p
                    style={{ fontSize: "15px", lineHeight: "1.5" }}
                    className="font-medium"
                  >
                    {msg.text}
                  </p>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Mic button */}
        <div className="flex flex-col items-center pb-6 pt-2">
          <p style={{ fontSize: "12px" }} className="text-gray-400 mb-3">
            {isListening ? "Toca para enviar" : "Toca para hablar"}
          </p>

          {/* Neumorphic mic button */}
          <motion.button
            whileTap={{ scale: 0.93 }}
            onClick={handleMicPress}
            aria-label={isListening ? "Detener escucha" : "Activar micrófono"}
            aria-pressed={isListening}
            className="relative flex items-center justify-center rounded-full transition-all duration-200 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-400"
            style={{
              width: 80,
              height: 80,
              background: isListening
                ? "linear-gradient(145deg, #3B82F6, #2563EB)"
                : "#F1F5F9",
              boxShadow: isListening
                ? "0 8px 24px rgba(59,130,246,0.45), inset 0 1px 0 rgba(255,255,255,0.2)"
                : "8px 8px 16px #d1d9e0, -8px -8px 16px #ffffff",
            }}
          >
            {/* Pulse rings when listening */}
            {isListening && (
              <>
                <motion.div
                  className="absolute inset-0 rounded-full bg-blue-400"
                  animate={{ scale: [1, 1.5, 1.5], opacity: [0.4, 0, 0] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut" }}
                />
                <motion.div
                  className="absolute inset-0 rounded-full bg-blue-300"
                  animate={{ scale: [1, 1.8, 1.8], opacity: [0.3, 0, 0] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut", delay: 0.3 }}
                />
              </>
            )}

            {isListening ? (
              <MicOff size={30} className="text-white relative z-10" strokeWidth={2} />
            ) : (
              <Mic
                size={30}
                strokeWidth={2}
                style={{ color: "#1E3A5F" }}
                className="relative z-10"
              />
            )}
          </motion.button>

          {/* Quick action chips */}
          <div className="flex gap-2 mt-4 flex-wrap justify-center px-4">
            {[
              { label: "¿Qué hay frente a mí?", action: "¿Qué hay frente a mí?" },
              { label: "Leer texto", action: "Lee el texto visible en la imagen" },
              { label: showCamera ? "Ocultar cámara" : "Mostrar cámara", action: "camera" },
            ].map((chip) => (
              <button
                key={chip.action}
                onClick={() => handleQuickAction(chip.action)}
                className="bg-white border border-gray-200 rounded-2xl px-3 py-1.5 text-slate-600 shadow-sm active:bg-gray-50 transition-colors"
                style={{ fontSize: "12px" }}
                aria-label={chip.label}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>

        {/* Error messages */}
        {(audioError || geminiError || cameraError) && (
          <div className="mx-5 mb-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
            <p style={{ fontSize: "11px" }} className="text-red-600">
              {audioError || geminiError || cameraError}
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
        isLoading={geminiLoading}
      />

      <BottomNav />
    </>
  );
}
