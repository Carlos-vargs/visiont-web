import { useCallback, useEffect, useRef, useState } from "react";
import type { useAudio } from "./useAudio";

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
  wakeWords: string[];
  silenceTimeout?: number;
  processTranscript: (transcript: string, cycleId: number) => Promise<void>;
  speakStatus: (text: string) => Promise<void>;
  onStatus: (message: string) => void;
  onBeforeManualStart?: () => void;
  onCycleChange?: (cycleId: number) => void;
};

const MICROPHONE_RECOVERY_MESSAGE =
  "El navegador no permitio abrir el microfono aunque ya estaba autorizado. Revisa ajustes o intenta recargar.";

export function useSOSInteractionController({
  audio,
  wakeWords,
  silenceTimeout = 4000,
  processTranscript,
  speakStatus,
  onStatus,
  onBeforeManualStart,
  onCycleChange,
}: UseSOSInteractionControllerOptions) {
  const [mode, setMode] = useState<SOSInteractionMode>("idle");
  const [statusMessage, setStatusMessage] = useState(
    "Toca para habilitar comandos de voz",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const modeRef = useRef<SOSInteractionMode>("idle");
  const cycleIdRef = useRef(0);
  const operationLockedRef = useRef(false);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

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
      setModeState("starting", "Preparando microfono...");
      setErrorMessage(null);

      try {
        const started = await audio.startListening();
        if (!started) {
          const recovery = audio.hasKnownMicrophoneAccess
            ? MICROPHONE_RECOVERY_MESSAGE
            : audio.lastAudioError || "No pude abrir el microfono.";
          setErrorMessage(recovery);
          setModeState("error", "Toca para intentar de nuevo");
          void speakStatus(recovery);
          return;
        }

        setModeState("listening", message);
        onStatus(message);
        void speakStatus("Escuchando");
      } finally {
        operationLockedRef.current = false;
      }
    },
    [audio, onStatus, setModeState, speakStatus],
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
      audio.stopListening();

      void speakStatus("Procesando");

      try {
        const command = (transcript || audio.transcript).trim();
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
          setModeState("idle", "Di un comando o toca para hablar");
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
    setModeState("idle", "Toca para habilitar comandos de voz");
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

  const startBackground = useCallback(() => {
    audio.startBackgroundRecognition({
        wakeWords,
        silenceTimeout,
        onActivation: () => {
          if (modeRef.current === "idle" || modeRef.current === "error") {
            void startVoiceListening("Escuchando comando de emergencia");
          }
        },
        onSilence: (transcript: string) => {
          if (modeRef.current === "listening") {
            void executeVoiceCommand(transcript);
          }
        },
      });
  }, [
    audio,
    executeVoiceCommand,
    silenceTimeout,
    startVoiceListening,
    wakeWords,
  ]);

  useEffect(() => {
    const timer = setTimeout(() => {
      startBackground();
    }, 500);

    return () => {
      clearTimeout(timer);
      audio.stopAllAudio("sos-unmount");
    };
  }, [audio, startBackground]);

  const displayError = errorMessage || audio.error;

  return {
    mode,
    statusMessage,
    errorMessage: displayError,
    isListening: mode === "listening",
    isProcessingVoice: mode === "processing",
    isBackgroundListening: audio.isBackgroundListening,
    audioLevel: audio.inputStatus === "active" ? audio.audioLevel : 0,
    hasRealAudioLevel: audio.inputStatus === "active",
    handleMicPress,
    cancelCurrentInteraction,
    startVoiceListening,
    executeVoiceCommand,
  };
}
