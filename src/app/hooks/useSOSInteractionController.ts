import { useCallback, useEffect, useRef, useState } from "react";
import type { useAudio } from "./useAudio";
import { sendDebugEvent } from "../lib/debugTelemetry";

type AudioApi = ReturnType<typeof useAudio>;

export type SOSInteractionMode =
  | "idle"
  | "starting"
  | "listening"
  | "processing"
  | "cancelling"
  | "error";

type UseSOSInteractionControllerOptions = {
  audio: AudioApi;
  processTranscript: (transcript: string, cycleId: number) => Promise<void>;
  speakStatus: (text: string) => Promise<void>;
  onStatus: (message: string) => void;
  onBeforeManualStart?: () => void;
  onCycleChange?: (cycleId: number) => void;
};

const MICROPHONE_RECOVERY_MESSAGE =
  "El navegador no permitio abrir el microfono aunque ya estaba autorizado. Revisa ajustes o intenta recargar.";
const PREPARING_MICROPHONE_MESSAGE = "Preparando micrófono";

export function useSOSInteractionController({
  audio,
  processTranscript,
  speakStatus,
  onStatus,
  onBeforeManualStart,
  onCycleChange,
}: UseSOSInteractionControllerOptions) {
  const [mode, setMode] = useState<SOSInteractionMode>("idle");
  const [statusMessage, setStatusMessage] = useState("Toca para hablar");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const modeRef = useRef<SOSInteractionMode>("idle");
  const cycleIdRef = useRef(0);
  const operationLockedRef = useRef(false);
  const audioRef = useRef(audio);
  const lastStateRef = useRef<string | null>(null);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    audioRef.current = audio;
  }, [audio]);

  useEffect(() => {
    const snapshot = JSON.stringify({
      mode,
      statusMessage,
      errorMessage,
    });

    if (lastStateRef.current === snapshot) {
      return;
    }

    lastStateRef.current = snapshot;
    sendDebugEvent({
      type: "sos.state_changed",
      source: "useSOSInteractionController",
      message: "SOS interaction state changed",
      payload: {
        mode,
        statusMessage,
        errorMessage,
      },
    });
  }, [errorMessage, mode, statusMessage]);

  const setModeState = useCallback(
    (nextMode: SOSInteractionMode, message?: string) => {
      modeRef.current = nextMode;
      setMode(nextMode);
      if (message) {
        setStatusMessage(message);
      }
    },
    [],
  );

  const setCycle = useCallback(
    (cycleId: number) => {
      cycleIdRef.current = cycleId;
      onCycleChange?.(cycleId);
    },
    [onCycleChange],
  );

  const nextCycle = useCallback(() => {
    const cycleId = cycleIdRef.current + 1;
    setCycle(cycleId);
    return cycleId;
  }, [setCycle]);

  const startVoiceListening = useCallback(
    async (message = "Escuchando, toca para procesar") => {
      if (
        operationLockedRef.current ||
        modeRef.current === "listening" ||
        modeRef.current === "processing" ||
        modeRef.current === "cancelling"
      ) {
        return;
      }

      operationLockedRef.current = true;
      const startCycleId = nextCycle();
      setModeState("starting", `${PREPARING_MICROPHONE_MESSAGE}...`);
      setErrorMessage(null);

      try {
        await speakStatus(PREPARING_MICROPHONE_MESSAGE);
        if (cycleIdRef.current !== startCycleId) {
          return;
        }

        const recognitionStarted = audio.startManualRecognition();
        if (!recognitionStarted) {
          const message =
            audio.lastAudioError ||
            "Reconocimiento de voz no soportado en este navegador.";
          setErrorMessage(message);
          setModeState("error", "Toca para intentar de nuevo");
          void speakStatus(message);
          return;
        }

        const started = await audio.startListening();
        let nextStatusMessage = message;
        if (!started && !audio.hasKnownMicrophoneAccess) {
          nextStatusMessage = "Escuchando sin medidor de volumen";
        } else if (!started) {
          const recovery = audio.hasKnownMicrophoneAccess
            ? MICROPHONE_RECOVERY_MESSAGE
            : audio.lastAudioError || "No pude abrir el microfono.";
          setErrorMessage(recovery);
          nextStatusMessage = "Escuchando sin medidor de volumen";
          void speakStatus(recovery);
        }

        setModeState("listening", nextStatusMessage);
        onStatus(nextStatusMessage);
      } finally {
        operationLockedRef.current = false;
      }
    },
    [audio, nextCycle, onStatus, setModeState, speakStatus],
  );

  const executeVoiceCommand = useCallback(
    async (transcript?: string) => {
      if (operationLockedRef.current || modeRef.current === "processing") {
        return;
      }

      operationLockedRef.current = true;
      const cycleId = nextCycle();
      setModeState("processing", "Procesando...");
      setErrorMessage(null);
      const capturedTranscript = audio.stopManualRecognition();
      audio.stopListening();

      void speakStatus("Procesando");

      try {
        const command = (
          transcript ||
          capturedTranscript ||
          audio.transcript
        ).trim();
        if (command) {
          await processTranscript(command, cycleId);
        } else if (cycleIdRef.current === cycleId) {
          const message =
            "No escuche un comando. Puedes decir llama a mama o activa emergencia.";
          onStatus(message);
          void speakStatus(message);
        }

        if (cycleIdRef.current === cycleId) {
          audio.resetRecognition();
          setModeState("idle", "Toca para hablar");
        }
      } catch (err: any) {
        console.error("Error processing voice command:", err);
        if (cycleIdRef.current === cycleId) {
          setErrorMessage("No pude procesar el comando de voz.");
          audio.resetRecognition();
          setModeState("error", "Toca para intentar de nuevo");
        }
      } finally {
        if (cycleIdRef.current === cycleId) {
          operationLockedRef.current = false;
        }
      }
    },
    [audio, nextCycle, onStatus, processTranscript, setModeState, speakStatus],
  );

  const cancelCurrentInteraction = useCallback(async () => {
    if (modeRef.current === "cancelling") {
      return;
    }

    operationLockedRef.current = true;
    nextCycle();
    setModeState("cancelling", "Cancelando");
    setErrorMessage(null);
    audio.stopAllAudio("sos-interaction-cancelled");
    onStatus("Cancelando");

    await speakStatus("Cancelando");

    operationLockedRef.current = false;
    setModeState("idle", "Toca para hablar");
  }, [audio, nextCycle, onStatus, setModeState, speakStatus]);

  const handleMicPress = useCallback(async () => {
    onBeforeManualStart?.();

    if (modeRef.current === "starting" || modeRef.current === "cancelling") {
      return;
    }

    if (modeRef.current === "listening") {
      await executeVoiceCommand();
      return;
    }

    if (modeRef.current === "processing" || audio.isSpeaking) {
      await cancelCurrentInteraction();
      return;
    }

    await startVoiceListening();
  }, [
    audio.isSpeaking,
    cancelCurrentInteraction,
    executeVoiceCommand,
    onBeforeManualStart,
    startVoiceListening,
  ]);

  useEffect(() => {
    return () => {
      audioRef.current.stopAllAudio("sos-unmount");
    };
  }, []);

  const displayError = errorMessage || audio.error;

  return {
    mode,
    statusMessage,
    errorMessage: displayError,
    isListening: mode === "listening",
    isProcessingVoice: mode === "processing",
    audioLevel: audio.inputStatus === "active" ? audio.audioLevel : 0,
    hasRealAudioLevel: audio.inputStatus === "active",
    handleMicPress,
    cancelCurrentInteraction,
  };
}
