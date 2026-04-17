import { useState, useRef, useCallback, useEffect } from "react";

type VoiceActivationOptions = {
  wakeWords?: string[];
  silenceTimeout?: number;
  language?: string;
  onActivation?: () => void;
  onSilence?: (transcript: string) => void | Promise<void>;
};

type RecognitionMode = "idle" | "wake" | "manual";

const normalizeText = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const joinTranscript = (parts: string[]): string =>
  parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

const extractCommandAfterWakeWord = (
  transcript: string,
  wakeWords: string[],
): string | null => {
  const normalizedTranscript = normalizeText(transcript);
  if (!normalizedTranscript) {
    return null;
  }

  for (const wakeWord of wakeWords) {
    const normalizedWakeWord = normalizeText(wakeWord);
    const index = normalizedTranscript.indexOf(normalizedWakeWord);

    if (index >= 0) {
      return normalizedTranscript
        .slice(index + normalizedWakeWord.length)
        .trim();
    }
  }

  return null;
};

export function useVoiceActivation(options: VoiceActivationOptions = {}) {
  const {
    wakeWords = ["analiza", "quiero que", "ok visiont", "visont", "analizando"],
    silenceTimeout = 2000,
    language = "es-ES",
  } = options;

  const [isBackgroundListening, setIsBackgroundListening] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [isManualListening, setIsManualListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");

  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldKeepRecognitionAliveRef = useRef(false);
  const isActiveRef = useRef(false);
  const transcriptPartsRef = useRef<string[]>([]);
  const interimTranscriptRef = useRef("");
  const lastFinalChunkRef = useRef("");
  const ignoreResultsUntilRef = useRef(0);
  const optionsRef = useRef(options);
  const modeRef = useRef<RecognitionMode>("idle");

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const clearTranscriptBuffers = useCallback(() => {
    transcriptPartsRef.current = [];
    interimTranscriptRef.current = "";
    lastFinalChunkRef.current = "";
    setTranscript("");
  }, []);

  const updateTranscriptState = useCallback(() => {
    setTranscript(
      joinTranscript([...transcriptPartsRef.current, interimTranscriptRef.current]),
    );
  }, []);

  const completeActiveListening = useCallback(
    async (shouldSubmit: boolean) => {
      clearSilenceTimer();

      const fullTranscript = joinTranscript([
        ...transcriptPartsRef.current,
        interimTranscriptRef.current,
      ]);

      if (!isActiveRef.current && !fullTranscript) {
        return;
      }

      ignoreResultsUntilRef.current = Date.now() + 300;
      isActiveRef.current = false;
      modeRef.current = "idle";
      setIsActive(false);
      setIsManualListening(false);
      clearTranscriptBuffers();

      if (!shouldSubmit || !fullTranscript) {
        return;
      }

      try {
        setIsProcessing(true);
        await optionsRef.current.onSilence?.(fullTranscript);
      } finally {
        setIsProcessing(false);
      }
    },
    [clearSilenceTimer, clearTranscriptBuffers],
  );

  const submitActiveListening = useCallback(async () => {
    await completeActiveListening(true);
  }, [completeActiveListening]);

  const cancelActiveListening = useCallback(() => {
    void completeActiveListening(false);
  }, [completeActiveListening]);

  const scheduleSilenceTimeout = useCallback(() => {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      void completeActiveListening(true);
    }, silenceTimeout);
  }, [clearSilenceTimer, completeActiveListening, silenceTimeout]);

  const activateListening = useCallback(
    (mode: Exclude<RecognitionMode, "idle">, initialTranscript = "") => {
      isActiveRef.current = true;
      modeRef.current = mode;
      setIsActive(true);
      setIsManualListening(mode === "manual");
      clearTranscriptBuffers();

      const normalizedInitial = joinTranscript([initialTranscript]);
      if (normalizedInitial) {
        interimTranscriptRef.current = normalizedInitial;
        updateTranscriptState();
      }

      optionsRef.current.onActivation?.();
      scheduleSilenceTimeout();
    },
    [clearTranscriptBuffers, scheduleSilenceTimeout, updateTranscriptState],
  );

  const startBackgroundListening = useCallback(() => {
    try {
      setError(null);
      shouldKeepRecognitionAliveRef.current = true;

      if (recognitionRef.current) {
        setIsBackgroundListening(true);
        return;
      }

      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (!SpeechRecognition) {
        setError("Reconocimiento de voz no soportado en este navegador");
        shouldKeepRecognitionAliveRef.current = false;
        return;
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = language;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setIsBackgroundListening(true);
      };

      recognition.onresult = (event: any) => {
        if (Date.now() < ignoreResultsUntilRef.current) {
          return;
        }

        let finalChunk = "";
        let interimChunk = "";

        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const piece = result?.[0]?.transcript?.trim();

          if (!piece) {
            continue;
          }

          if (result.isFinal) {
            finalChunk = joinTranscript([finalChunk, piece]);
          } else {
            interimChunk = joinTranscript([interimChunk, piece]);
          }
        }

        const latestChunk = joinTranscript([finalChunk, interimChunk]);

        if (!isActiveRef.current) {
          const commandAfterWakeWord = extractCommandAfterWakeWord(
            latestChunk,
            wakeWords,
          );

          if (commandAfterWakeWord !== null) {
            activateListening("wake", commandAfterWakeWord);
          }
          return;
        }

        if (finalChunk) {
          const normalizedFinalChunk = normalizeText(finalChunk);

          if (
            normalizedFinalChunk &&
            normalizedFinalChunk !== lastFinalChunkRef.current
          ) {
            transcriptPartsRef.current = [
              ...transcriptPartsRef.current,
              joinTranscript([finalChunk]),
            ];
            lastFinalChunkRef.current = normalizedFinalChunk;
          }
        }

        interimTranscriptRef.current = joinTranscript([interimChunk]);
        updateTranscriptState();
        scheduleSilenceTimeout();
      };

      recognition.onerror = (event: any) => {
        if (event.error === "no-speech" || event.error === "aborted") {
          return;
        }

        if (event.error === "not-allowed") {
          setError("Permiso de micrófono denegado");
          shouldKeepRecognitionAliveRef.current = false;
          return;
        }

        if (event.error === "audio-capture") {
          setError("No se pudo acceder al micrófono");
          return;
        }

        setError(`Error de reconocimiento de voz: ${event.error}`);
      };

      recognition.onend = () => {
        if (shouldKeepRecognitionAliveRef.current) {
          try {
            recognition.start();
            return;
          } catch (restartError) {
            console.warn("No se pudo reiniciar el reconocimiento:", restartError);
          }
        }

        recognitionRef.current = null;
        setIsBackgroundListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: any) {
      shouldKeepRecognitionAliveRef.current = false;
      setError(`Error al iniciar reconocimiento de voz: ${err.message}`);
    }
  }, [
    activateListening,
    language,
    scheduleSilenceTimeout,
    updateTranscriptState,
    wakeWords,
  ]);

  const stopBackgroundListening = useCallback(() => {
    shouldKeepRecognitionAliveRef.current = false;
    void completeActiveListening(false);

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (stopError) {
        console.warn("No se pudo detener el reconocimiento:", stopError);
      }
      recognitionRef.current = null;
    }

    setIsBackgroundListening(false);
  }, [completeActiveListening]);

  const startManualListening = useCallback(() => {
    setError(null);
    startBackgroundListening();
    activateListening("manual");
  }, [activateListening, startBackgroundListening]);

  const resetActive = useCallback(() => {
    cancelActiveListening();
  }, [cancelActiveListening]);

  useEffect(() => {
    return () => {
      shouldKeepRecognitionAliveRef.current = false;
      clearSilenceTimer();

      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (stopError) {
          console.warn("No se pudo detener el reconocimiento al desmontar:", stopError);
        }
      }
    };
  }, [clearSilenceTimer]);

  return {
    isBackgroundListening,
    isActive,
    isManualListening,
    isProcessing,
    transcript,
    error,
    startBackgroundListening,
    stopBackgroundListening,
    startManualListening,
    submitActiveListening,
    cancelActiveListening,
    resetActive,
  };
}
