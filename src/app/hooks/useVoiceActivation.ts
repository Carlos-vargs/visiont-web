import { useState, useRef, useCallback, useEffect } from "react";

type VoiceActivationOptions = {
  wakeWords?: string[];
  silenceTimeout?: number;
  language?: string;
  onActivation?: () => void;
  onSilence?: (transcript: string) => void | Promise<void>;
};

type RecognitionMode = "idle" | "wake" | "manual";
type RecognitionStatus = "idle" | "starting" | "running" | "stopping";
type SubmitOptions = {
  allowEmpty?: boolean;
};

const RESTART_DELAY_MS = 450;
const IGNORE_RESULTS_DELAY_MS = 1200;
const DUPLICATE_WAKE_WORD_WINDOW_MS = 1500;

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
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldKeepRecognitionAliveRef = useRef(false);
  const recognitionStatusRef = useRef<RecognitionStatus>("idle");
  const isActiveRef = useRef(false);
  const transcriptPartsRef = useRef<string[]>([]);
  const transcriptSetRef = useRef<Set<string>>(new Set());
  const interimTranscriptRef = useRef("");
  const ignoreResultsUntilRef = useRef(0);
  const optionsRef = useRef(options);
  const modeRef = useRef<RecognitionMode>("idle");
  const lastWakeActivationRef = useRef({ text: "", at: 0 });

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const clearTranscriptBuffers = useCallback(() => {
    transcriptPartsRef.current = [];
    transcriptSetRef.current = new Set();
    interimTranscriptRef.current = "";
    setTranscript("");
  }, []);

  const updateTranscriptState = useCallback(() => {
    setTranscript(
      joinTranscript([...transcriptPartsRef.current, interimTranscriptRef.current]),
    );
  }, []);

  const completeActiveListening = useCallback(
    async (shouldSubmit: boolean, allowEmpty = false) => {
      clearSilenceTimer();

      const submittedTranscript = joinTranscript([
        ...transcriptPartsRef.current,
        interimTranscriptRef.current,
      ]);

      if (!isActiveRef.current && !submittedTranscript) {
        return;
      }

      ignoreResultsUntilRef.current = Date.now() + IGNORE_RESULTS_DELAY_MS;
      isActiveRef.current = false;
      modeRef.current = "idle";
      setIsActive(false);
      setIsManualListening(false);
      clearTranscriptBuffers();

      if (!shouldSubmit || (!submittedTranscript && !allowEmpty)) {
        return;
      }

      try {
        setIsProcessing(true);
        await optionsRef.current.onSilence?.(submittedTranscript);
      } finally {
        setIsProcessing(false);
      }
    },
    [clearSilenceTimer, clearTranscriptBuffers],
  );

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

      const initial = joinTranscript([initialTranscript]);
      if (initial) {
        interimTranscriptRef.current = initial;
        updateTranscriptState();
      }

      optionsRef.current.onActivation?.();
      scheduleSilenceTimeout();
    },
    [clearTranscriptBuffers, scheduleSilenceTimeout, updateTranscriptState],
  );

  const handleRecognitionResult = useCallback(
    (event: any) => {
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
      if (!latestChunk) {
        return;
      }

      if (!isActiveRef.current) {
        const commandAfterWakeWord = extractCommandAfterWakeWord(
          latestChunk,
          wakeWords,
        );

        if (commandAfterWakeWord === null) {
          return;
        }

        const normalizedLatestChunk = normalizeText(latestChunk);
        const now = Date.now();

        if (
          normalizedLatestChunk &&
          normalizedLatestChunk === lastWakeActivationRef.current.text &&
          now - lastWakeActivationRef.current.at < DUPLICATE_WAKE_WORD_WINDOW_MS
        ) {
          return;
        }

        lastWakeActivationRef.current = {
          text: normalizedLatestChunk,
          at: now,
        };

        activateListening("wake", commandAfterWakeWord);
        return;
      }

      if (finalChunk) {
        const normalizedFinalChunk = normalizeText(finalChunk);

        if (
          normalizedFinalChunk &&
          !transcriptSetRef.current.has(normalizedFinalChunk)
        ) {
          transcriptSetRef.current.add(normalizedFinalChunk);
          transcriptPartsRef.current = [
            ...transcriptPartsRef.current,
            joinTranscript([finalChunk]),
          ];
        }
      }

      interimTranscriptRef.current = joinTranscript([interimChunk]);
      updateTranscriptState();
      scheduleSilenceTimeout();
    },
    [activateListening, scheduleSilenceTimeout, updateTranscriptState, wakeWords],
  );

  const createRecognition = useCallback(() => {
    if (recognitionRef.current) {
      return recognitionRef.current;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError("Reconocimiento de voz no soportado en este navegador");
      shouldKeepRecognitionAliveRef.current = false;
      return null;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = language;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      recognitionStatusRef.current = "running";
      setIsBackgroundListening(true);
    };

    recognition.onresult = handleRecognitionResult;

    recognition.onerror = (event: any) => {
      if (event.error === "no-speech") {
        return;
      }

      if (event.error === "aborted") {
        return;
      }

      if (event.error === "not-allowed") {
        setError("Permiso de micrófono denegado");
        shouldKeepRecognitionAliveRef.current = false;
        setIsBackgroundListening(false);
        return;
      }

      if (event.error === "audio-capture") {
        setError("No se pudo acceder al micrófono");
        return;
      }

      setError(`Error de reconocimiento de voz: ${event.error}`);
    };

    recognition.onend = () => {
      const wasStopping = recognitionStatusRef.current === "stopping";
      recognitionStatusRef.current = "idle";

      if (wasStopping && !shouldKeepRecognitionAliveRef.current) {
        setIsBackgroundListening(false);
        return;
      }

      if (shouldKeepRecognitionAliveRef.current) {
        clearRestartTimer();
        restartTimerRef.current = setTimeout(() => {
          if (!shouldKeepRecognitionAliveRef.current) {
            return;
          }

          if (recognitionStatusRef.current !== "idle") {
            return;
          }

          try {
            recognitionStatusRef.current = "starting";
            recognition.start();
          } catch (restartError) {
            recognitionStatusRef.current = "idle";
            console.warn("No se pudo reiniciar el reconocimiento:", restartError);
          }
        }, RESTART_DELAY_MS);
        return;
      }

      setIsBackgroundListening(false);
    };

    recognitionRef.current = recognition;
    return recognition;
  }, [clearRestartTimer, handleRecognitionResult, language]);

  const ensureRecognitionStarted = useCallback(() => {
    const recognition = createRecognition();
    if (!recognition) {
      return;
    }

    if (
      recognitionStatusRef.current === "running" ||
      recognitionStatusRef.current === "starting"
    ) {
      return;
    }

    clearRestartTimer();

    try {
      recognitionStatusRef.current = "starting";
      recognition.start();
    } catch (startError) {
      recognitionStatusRef.current = "idle";
      console.warn("No se pudo iniciar el reconocimiento:", startError);
    }
  }, [clearRestartTimer, createRecognition]);

  const startBackgroundListening = useCallback(() => {
    setError(null);
    shouldKeepRecognitionAliveRef.current = true;
    ensureRecognitionStarted();
  }, [ensureRecognitionStarted]);

  const stopBackgroundListening = useCallback(() => {
    shouldKeepRecognitionAliveRef.current = false;
    clearRestartTimer();
    void completeActiveListening(false);

    if (recognitionRef.current) {
      recognitionStatusRef.current = "stopping";
      try {
        recognitionRef.current.stop();
      } catch (stopError) {
        recognitionStatusRef.current = "idle";
        console.warn("No se pudo detener el reconocimiento:", stopError);
      }
    } else {
      setIsBackgroundListening(false);
    }
  }, [clearRestartTimer, completeActiveListening]);

  const startManualListening = useCallback(() => {
    setError(null);
    shouldKeepRecognitionAliveRef.current = true;
    ensureRecognitionStarted();
    activateListening("manual");
  }, [activateListening, ensureRecognitionStarted]);

  const submitActiveListening = useCallback(
    async (submitOptions?: SubmitOptions) => {
      await completeActiveListening(true, submitOptions?.allowEmpty ?? false);
    },
    [completeActiveListening],
  );

  const cancelActiveListening = useCallback(() => {
    void completeActiveListening(false);
  }, [completeActiveListening]);

  const resetActive = useCallback(() => {
    cancelActiveListening();
  }, [cancelActiveListening]);

  useEffect(() => {
    return () => {
      shouldKeepRecognitionAliveRef.current = false;
      clearSilenceTimer();
      clearRestartTimer();

      if (recognitionRef.current) {
        recognitionStatusRef.current = "stopping";
        try {
          recognitionRef.current.stop();
        } catch (stopError) {
          console.warn("No se pudo detener el reconocimiento al desmontar:", stopError);
        }
      }
    };
  }, [clearRestartTimer, clearSilenceTimer]);

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
