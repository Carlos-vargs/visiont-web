import { useCallback, useEffect, useRef, useState } from "react";
import type { useAudio } from "./useAudio";
import { sendDebugEvent } from "../lib/debugTelemetry";
import type { CapturedFrame } from "./useCamera";
import type { GeminiImageMetadata } from "./useGemini";

type AudioApi = ReturnType<typeof useAudio>;

type DetectionResult = {
  label: string;
  distance: string;
  confidence?: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

type GeminiResponse = {
  feedback: string;
  detections: DetectionResult[];
};

export type CameraDetectionBox = {
  id: number;
  label: string;
  distance: string;
  confidence: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type CameraInteractionMode =
  | "idle"
  | "starting"
  | "listening"
  | "analyzing"
  | "speaking"
  | "cancelling"
  | "error";

type UseCameraInteractionControllerOptions = {
  audio: AudioApi;
  captureFrame: () => string | null;
  captureFrameData: () => CapturedFrame | null;
  sendImageWithPrompt: (
    imageBase64: string,
    prompt: string,
    imageMetadata?: GeminiImageMetadata,
  ) => Promise<GeminiResponse>;
  cancelActiveRequest: () => void;
};

const MICROPHONE_RECOVERY_MESSAGE =
  "El navegador no permitio abrir el microfono aunque ya estaba autorizado. Revisa ajustes o intenta recargar.";
const PREPARING_MICROPHONE_MESSAGE = "Preparando micrófono";
const SPEECH_RECOGNITION_UNSUPPORTED_MESSAGE =
  "Reconocimiento de voz no soportado en este navegador. Analizare la imagen sin transcripcion.";

const buildAnalysisPrompt = (transcript?: string) =>
  transcript
    ? `Solicitud del usuario: "${transcript}". Responde primero exactamente esa solicitud usando la imagen. ` +
      `No describas toda la escena ni enumeres objetos alrededor si no ayudan a responder. ` +
      `Si lo solicitado no es visible, dilo claramente y agrega solo contexto minimo util. ` +
      `Incluye riesgos criticos evidentes despues de responder lo pedido. ` +
      `Las detecciones deben ser solo elementos relacionados con la solicitud o riesgos criticos. ` +
      `Responde en JSON con 'feedback' y 'detections' (maximo 4 objetos si aplica).`
    : `Describe lo que ves. Identifica maximo 4 objetos principales con distancias aproximadas. ` +
      `Responde en JSON con 'feedback' y 'detections'.`;

export function useCameraInteractionController({
  audio,
  captureFrame,
  captureFrameData,
  sendImageWithPrompt,
  cancelActiveRequest,
}: UseCameraInteractionControllerOptions) {
  const [mode, setMode] = useState<CameraInteractionMode>("idle");
  const [statusMessage, setStatusMessage] = useState("Toca para hablar");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [activeBoxes, setActiveBoxes] = useState<CameraDetectionBox[]>([]);

  const modeRef = useRef<CameraInteractionMode>("idle");
  const cycleIdRef = useRef(0);
  const operationLockedRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastStateRef = useRef<string | null>(null);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    const snapshot = JSON.stringify({
      mode,
      statusMessage,
      errorMessage,
      activeBoxes: activeBoxes.length,
    });

    if (lastStateRef.current === snapshot) {
      return;
    }

    lastStateRef.current = snapshot;
    sendDebugEvent({
      type: "camera_interaction.state_changed",
      source: "useCameraInteractionController",
      message: "Camera interaction state changed",
      payload: {
        mode,
        statusMessage,
        errorMessage,
        activeBoxes,
      },
    });
  }, [activeBoxes, errorMessage, mode, statusMessage]);

  const setModeState = useCallback(
    (nextMode: CameraInteractionMode, message?: string) => {
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

  const invalidateCurrentCycle = useCallback(() => {
    cycleIdRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    cancelActiveRequest();
  }, [cancelActiveRequest]);

  const executeAnalysis = useCallback(
    async (transcript: string | undefined, cycleId: number) => {
      setModeState("analyzing", "Analizando...");
      setErrorMessage(null);
      audio.stopManualRecognition();
      audio.stopListening();

      const controller = new AbortController();
      abortControllerRef.current = controller;

      void audio.speakText("Analizando");

      try {
        const frame = captureFrameData();
        if (!frame || controller.signal.aborted || !isCurrentCycle(cycleId)) {
          if (!frame && isCurrentCycle(cycleId)) {
            setErrorMessage("No pude capturar una imagen para analizar.");
            setModeState("error", "No pude capturar imagen");
          }
          return;
        }

        const result = await sendImageWithPrompt(
          frame.base64,
          buildAnalysisPrompt(transcript),
          {
            width: frame.width,
            height: frame.height,
            mimeType: frame.mimeType,
            captureSource: "analysis",
            imageFilename: `visiont-analysis-${Date.now()}.jpg`,
          },
        );

        if (controller.signal.aborted || !isCurrentCycle(cycleId)) {
          return;
        }

        setFeedbackText(result.feedback);
        setShowFeedback(true);
        setActiveBoxes(
          result.detections.slice(0, 4).map((det, index) => ({
            id: Date.now() + index,
            ...det,
            confidence: det.confidence ?? 90,
          })),
        );

        setModeState("speaking", "Respuesta lista");
        await audio.speakText(result.feedback);

        if (isCurrentCycle(cycleId)) {
          setModeState("idle", "Toca para hablar");
        }
      } catch (err: any) {
        if (controller.signal.aborted || !isCurrentCycle(cycleId)) {
          return;
        }

        const message = err?.message || "No pude completar el analisis.";
        setErrorMessage(message);
        setModeState("error", "Toca para intentar de nuevo");
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [audio, captureFrameData, isCurrentCycle, sendImageWithPrompt, setModeState],
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
      audio.stopListening();
      await audio.speakText(PREPARING_MICROPHONE_MESSAGE);
      if (!isCurrentCycle(cycleId)) {
        return;
      }

      const recognitionStarted = audio.startManualRecognition();

      if (!recognitionStarted) {
        setErrorMessage(SPEECH_RECOGNITION_UNSUPPORTED_MESSAGE);
        setStatusMessage("Analizando imagen sin transcripcion");
        await executeAnalysis(undefined, cycleId);
        return;
      }

      const audioStarted = await audio.startListening();
      if (!isCurrentCycle(cycleId)) {
        return;
      }

      if (!audioStarted && audio.hasKnownMicrophoneAccess) {
        setErrorMessage(MICROPHONE_RECOVERY_MESSAGE);
        setStatusMessage("Escuchando sin medidor de volumen");
      } else if (!audioStarted) {
        setStatusMessage("Escuchando sin medidor de volumen");
      } else if (audio.inputStatus !== "active") {
        setStatusMessage("Escuchando sin medidor de volumen");
      } else {
        setStatusMessage("Escuchando... Toca para analizar");
      }

      setModeState("listening");
    } finally {
      operationLockedRef.current = false;
    }
  }, [audio, executeAnalysis, isCurrentCycle, setModeState]);

  const finishListeningAndAnalyze = useCallback(async () => {
    if (operationLockedRef.current) {
      return;
    }

    operationLockedRef.current = true;
    const cycleId = cycleIdRef.current + 1;
    cycleIdRef.current = cycleId;

    try {
      const capturedTranscript = audio.stopManualRecognition();
      audio.stopListening();
      const transcript = (capturedTranscript || audio.transcript).trim();
      await executeAnalysis(transcript || undefined, cycleId);
    } finally {
      operationLockedRef.current = false;
    }
  }, [audio, executeAnalysis]);

  const cancelCurrentInteraction = useCallback(async () => {
    if (modeRef.current === "cancelling") {
      return;
    }

    operationLockedRef.current = true;
    invalidateCurrentCycle();
    setModeState("cancelling", "Cancelando");
    setErrorMessage(null);
    audio.stopAllAudio("camera-interaction-cancelled");

    await audio.speakText("Cancelando");

    operationLockedRef.current = false;
    setModeState("idle", "Toca para hablar");
  }, [audio, invalidateCurrentCycle, setModeState]);

  const handleMicPress = useCallback(async () => {
    const currentMode = modeRef.current;

    if (currentMode === "starting" || currentMode === "cancelling") {
      return;
    }

    if (currentMode === "listening") {
      await finishListeningAndAnalyze();
      return;
    }

    if (currentMode === "analyzing" || currentMode === "speaking") {
      await cancelCurrentInteraction();
      return;
    }

    await beginListening();
  }, [beginListening, cancelCurrentInteraction, finishListeningAndAnalyze]);

  const cleanup = useCallback(() => {
    operationLockedRef.current = false;
    invalidateCurrentCycle();
    audio.stopAllAudio("camera-unmount");
  }, [audio, invalidateCurrentCycle]);

  return {
    mode,
    transcript: audio.transcript,
    audioLevel: audio.inputStatus === "active" ? audio.audioLevel : 0,
    hasRealAudioLevel: audio.inputStatus === "active",
    statusMessage,
    errorMessage,
    feedbackText,
    showFeedback,
    activeBoxes,
    handleMicPress,
    cancelCurrentInteraction,
    cleanup,
  };
}
