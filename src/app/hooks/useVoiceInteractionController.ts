import { useCallback, useEffect, useRef, useState } from "react";
import type { useAudio } from "./useAudio";

type AudioApi = ReturnType<typeof useAudio>;

type GeminiImageResponse = {
  feedback: string;
};

type VoiceMessage = {
  id: number;
  text: string;
  sender: "assistant" | "user";
};

export type VoiceInteractionMode =
  | "idle"
  | "starting"
  | "listening"
  | "loading"
  | "speaking"
  | "cancelling"
  | "error";

type UseVoiceInteractionControllerOptions = {
  audio: AudioApi;
  geminiLoading: boolean;
  geminiError: string | null;
  cameraError: string | null;
  cameraPreview: string | null;
  showCamera: boolean;
  captureFrame: () => string | null;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  setCameraPreview: (frame: string | null) => void;
  setShowCamera: (value: boolean) => void;
  sendTextMessage: (message: string) => Promise<string>;
  sendImageWithPrompt: (
    imageBase64: string,
    prompt: string,
  ) => Promise<GeminiImageResponse>;
  cancelActiveRequest: () => void;
};

const MICROPHONE_RECOVERY_MESSAGE =
  "El navegador no permitio abrir el microfono aunque ya estaba autorizado. Revisa ajustes o intenta recargar.";
const PREPARING_MICROPHONE_MESSAGE = "Preparando micrófono";
const IMAGE_REQUIRED_MESSAGE =
  "Necesito una imagen de la camara para responder eso. Activa la camara o captura una imagen primero.";
const GENERAL_SCENE_PROMPT =
  'Solicitud del usuario: "¿Qué hay frente a mí?". Describe brevemente los objetos principales frente al usuario, personas, obstaculos y texto visible importante. Proporciona distancias aproximadas si son utiles.';
const READ_TEXT_PROMPT =
  'Solicitud del usuario: "Lee el texto visible en la imagen". Transcribe directamente el texto visible. No describas el entorno salvo que ayude a ubicar el texto o exista una alerta critica.';

const INITIAL_MESSAGES: VoiceMessage[] = [
  {
    id: 0,
    text: "Hola, estoy listo para ayudarte. ¿Qué necesitas?",
    sender: "assistant",
  },
];

const isAbortLikeError = (error: unknown) => {
  const err = error as { name?: string; message?: string };
  return err?.name === "AbortError" || /abort/i.test(err?.message || "");
};

export function useVoiceInteractionController({
  audio,
  geminiLoading,
  geminiError,
  cameraError,
  cameraPreview,
  showCamera,
  captureFrame,
  startCamera,
  stopCamera,
  setCameraPreview,
  setShowCamera,
  sendTextMessage,
  sendImageWithPrompt,
  cancelActiveRequest,
}: UseVoiceInteractionControllerOptions) {
  const [mode, setMode] = useState<VoiceInteractionMode>("idle");
  const [statusMessage, setStatusMessage] = useState("En espera");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [messages, setMessages] = useState<VoiceMessage[]>(INITIAL_MESSAGES);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");

  const modeRef = useRef<VoiceInteractionMode>("idle");
  const cycleIdRef = useRef(0);
  const operationLockedRef = useRef(false);
  const cameraCaptureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const cleanupDepsRef = useRef({ audio, cancelActiveRequest });

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    cleanupDepsRef.current = { audio, cancelActiveRequest };
  }, [audio, cancelActiveRequest]);

  useEffect(() => {
    if (geminiError || cameraError || audio.error) {
      setErrorMessage(geminiError || cameraError || audio.error);
      setMode((current) => (current === "idle" ? "error" : current));
    }
  }, [audio.error, cameraError, geminiError]);

  const setModeState = useCallback(
    (nextMode: VoiceInteractionMode, message?: string) => {
      modeRef.current = nextMode;
      setMode(nextMode);
      if (message) {
        setStatusMessage(message);
      }
    },
    [],
  );

  const isCurrentCycle = useCallback(
    (cycleId: number) => cycleIdRef.current === cycleId,
    [],
  );

  const appendMessage = useCallback((text: string, sender: "assistant" | "user") => {
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now() + prev.length,
        text,
        sender,
      },
    ]);
  }, []);

  const cancelCurrentInteraction = useCallback(
    async (nextMessage = "En espera") => {
      if (modeRef.current === "cancelling") {
        return;
      }

      cycleIdRef.current += 1;
      operationLockedRef.current = true;
      cancelActiveRequest();
      audio.stopAllAudio("voice-interaction-cancelled");
      setModeState("cancelling", "Cancelando");
      setErrorMessage(null);

      await audio.speakText("Cancelando");

      operationLockedRef.current = false;
      setModeState("idle", nextMessage);
    },
    [audio, cancelActiveRequest, setModeState],
  );

  const beginListening = useCallback(async () => {
    if (operationLockedRef.current) {
      return;
    }

    operationLockedRef.current = true;
    const cycleId = cycleIdRef.current + 1;
    cycleIdRef.current = cycleId;
    setModeState("starting", `${PREPARING_MICROPHONE_MESSAGE}...`);
    setErrorMessage(null);

    try {
      await audio.speakText(PREPARING_MICROPHONE_MESSAGE);
      if (!isCurrentCycle(cycleId)) {
        return;
      }

      const started = await audio.startListening();
      if (!started) {
        const message = audio.hasKnownMicrophoneAccess
          ? MICROPHONE_RECOVERY_MESSAGE
          : audio.lastAudioError || "No pude abrir el microfono.";
        setErrorMessage(message);
        setModeState("error", "Toca para intentar de nuevo");
        return;
      }

      setModeState("listening", "Escuchando...");
    } finally {
      operationLockedRef.current = false;
    }
  }, [audio, isCurrentCycle, setModeState]);

  const publishAssistantResponse = useCallback(
    async (response: string, cycleId: number) => {
      if (!isCurrentCycle(cycleId)) {
        return;
      }

      appendMessage(response, "assistant");
      setFeedbackText(response);
      setShowFeedback(true);
      setModeState("speaking", "Respuesta lista");

      await audio.speakText(response);

      if (isCurrentCycle(cycleId)) {
        setModeState("idle", "En espera");
      }
    },
    [appendMessage, audio, isCurrentCycle, setModeState],
  );

  const sendUserText = useCallback(
    async (userText: string) => {
      const cycleId = cycleIdRef.current + 1;
      cycleIdRef.current = cycleId;
      setModeState("loading", "Procesando...");
      setErrorMessage(null);
      appendMessage(userText, "user");

      try {
        const response = await sendTextMessage(userText);
        await publishAssistantResponse(response, cycleId);
      } catch (err) {
        if (isAbortLikeError(err) || !isCurrentCycle(cycleId)) {
          return;
        }
        console.error("Error getting Gemini response:", err);
        setErrorMessage("No pude completar la respuesta.");
        setModeState("error", "Toca para intentar de nuevo");
      }
    },
    [
      appendMessage,
      isCurrentCycle,
      publishAssistantResponse,
      sendTextMessage,
      setModeState,
    ],
  );

  const finishListening = useCallback(async () => {
    if (operationLockedRef.current) {
      return;
    }

    operationLockedRef.current = true;
    audio.stopListening();
    operationLockedRef.current = false;
    await sendUserText("¿Qué hay frente a mí?");
  }, [audio, sendUserText]);

  const cancelAndStartListening = useCallback(async () => {
    await cancelCurrentInteraction(`${PREPARING_MICROPHONE_MESSAGE}...`);
    await beginListening();
  }, [beginListening, cancelCurrentInteraction]);

  const handleMicPress = useCallback(async () => {
    const currentMode = modeRef.current;

    if (currentMode === "starting" || currentMode === "cancelling") {
      return;
    }

    if (currentMode === "listening") {
      await finishListening();
      return;
    }

    if (
      currentMode === "loading" ||
      currentMode === "speaking" ||
      geminiLoading ||
      audio.isSpeaking
    ) {
      await cancelAndStartListening();
      return;
    }

    await beginListening();
  }, [
    audio.isSpeaking,
    beginListening,
    cancelAndStartListening,
    finishListening,
    geminiLoading,
  ]);

  const handleQuickAction = useCallback(
    async (action: string) => {
      if (action === "camera") {
        if (cameraCaptureTimerRef.current) {
          clearTimeout(cameraCaptureTimerRef.current);
          cameraCaptureTimerRef.current = null;
        }

        if (showCamera) {
          setShowCamera(false);
          setCameraPreview(null);
          stopCamera();
          return;
        }

        setShowCamera(true);
        await startCamera();

        cameraCaptureTimerRef.current = setTimeout(() => {
          const frame = captureFrame();
          if (frame) {
            setCameraPreview(frame);
          }
        }, 1000);
        return;
      }

      if (modeRef.current === "loading" || modeRef.current === "speaking") {
        await cancelCurrentInteraction();
      }

      const cycleId = cycleIdRef.current + 1;
      cycleIdRef.current = cycleId;
      setModeState("loading", "Procesando...");
      setErrorMessage(null);
      appendMessage(action, "user");

      try {
        let response: string;

        if (action === "¿Qué hay frente a mí?") {
          const imageForPrompt = cameraPreview ?? captureFrame();
          response = imageForPrompt
            ? (await sendImageWithPrompt(imageForPrompt, GENERAL_SCENE_PROMPT))
                .feedback
            : IMAGE_REQUIRED_MESSAGE;
        } else if (action === "Lee el texto visible en la imagen") {
          const imageForPrompt = cameraPreview ?? captureFrame();
          response = imageForPrompt
            ? (await sendImageWithPrompt(imageForPrompt, READ_TEXT_PROMPT))
                .feedback
            : IMAGE_REQUIRED_MESSAGE;
        } else {
          response = await sendTextMessage(action);
        }

        await publishAssistantResponse(response, cycleId);
      } catch (err) {
        if (isAbortLikeError(err) || !isCurrentCycle(cycleId)) {
          return;
        }
        console.error("Error getting Gemini response:", err);
        setErrorMessage("No pude completar la respuesta.");
        setModeState("error", "Toca para intentar de nuevo");
      }
    },
    [
      appendMessage,
      audio,
      cameraError,
      cameraPreview,
      cancelCurrentInteraction,
      captureFrame,
      isCurrentCycle,
      publishAssistantResponse,
      sendImageWithPrompt,
      sendTextMessage,
      setCameraPreview,
      setModeState,
      setShowCamera,
      showCamera,
      startCamera,
      stopCamera,
    ],
  );

  const handleSpeakFeedback = useCallback(() => {
    if (feedbackText) {
      void audio.speakText(feedbackText);
    }
  }, [audio, feedbackText]);

  const cleanup = useCallback(() => {
    if (cameraCaptureTimerRef.current) {
      clearTimeout(cameraCaptureTimerRef.current);
      cameraCaptureTimerRef.current = null;
    }
    cycleIdRef.current += 1;
    cleanupDepsRef.current.cancelActiveRequest();
    cleanupDepsRef.current.audio.stopAllAudio("voice-unmount");
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const displayError = errorMessage || geminiError || cameraError || audio.error;

  return {
    mode,
    messages,
    statusMessage,
    errorMessage: displayError,
    feedbackText,
    showFeedback,
    isListening: mode === "listening",
    isLoading: mode === "loading",
    isSpeaking: mode === "speaking" || audio.isSpeaking,
    isActive:
      mode === "listening" ||
      mode === "speaking" ||
      mode === "loading" ||
      audio.isSpeaking,
    audioLevel: audio.inputStatus === "active" ? audio.audioLevel : 0,
    hasRealAudioLevel: audio.inputStatus === "active",
    setShowFeedback,
    handleMicPress,
    handleQuickAction,
    handleSpeakFeedback,
    cancelCurrentInteraction,
    cleanup,
  };
}
