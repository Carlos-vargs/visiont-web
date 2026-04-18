import { useState, useRef, useCallback, useEffect } from "react";

type VoiceActivationOptions = {
  wakeWords?: string[];
  silenceTimeout?: number;
  language?: string;
  continuous?: boolean;
  onActivation?: () => void;
  onSilence?: (transcript: string) => void | Promise<void>;
};

type SubmitOptions = {
  allowEmpty?: boolean;
};

const DEFAULT_WAKE_WORDS = [
  "analiza",
  "quiero que",
  "ok visiont",
  "visont",
  "analizando",
];

const DEFAULT_LANGUAGE = "es-ES";
const DEFAULT_SILENCE_TIMEOUT = 2000;
const RESTART_DELAY_MS = 100;

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

const isSpeechRecognitionSupported = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }

  return Boolean(
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition,
  );
};

export function useVoiceActivation(options: VoiceActivationOptions = {}) {
  const [isBackgroundListening, setIsBackgroundListening] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [isManualListening, setIsManualListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");

  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptBufferRef = useRef("");
  const lastTranscriptChunkRef = useRef("");
  const isActiveRef = useRef(false);
  const isManualListeningRef = useRef(false);
  const isProcessingRef = useRef(false);
  const isBackgroundListeningRef = useRef(false);
  const optionsRef = useRef<Required<VoiceActivationOptions>>({
    wakeWords: DEFAULT_WAKE_WORDS,
    silenceTimeout: DEFAULT_SILENCE_TIMEOUT,
    language: DEFAULT_LANGUAGE,
    continuous: true,
    onActivation: () => {},
    onSilence: async () => {},
  });

  useEffect(() => {
    optionsRef.current = {
      wakeWords: options.wakeWords ?? DEFAULT_WAKE_WORDS,
      silenceTimeout: options.silenceTimeout ?? DEFAULT_SILENCE_TIMEOUT,
      language: options.language ?? DEFAULT_LANGUAGE,
      continuous: options.continuous ?? true,
      onActivation: options.onActivation ?? (() => {}),
      onSilence: options.onSilence ?? (async () => {}),
    };
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

  const containsWakeWord = useCallback((text: string): boolean => {
    const normalizedText = normalizeText(text);

    return optionsRef.current.wakeWords.some((wakeWord) =>
      normalizedText.includes(normalizeText(wakeWord)),
    );
  }, []);

  const appendTranscript = useCallback((text: string) => {
    const normalizedText = normalizeText(text);

    if (!normalizedText || normalizedText === lastTranscriptChunkRef.current) {
      return;
    }

    lastTranscriptChunkRef.current = normalizedText;
    transcriptBufferRef.current = joinTranscript([
      transcriptBufferRef.current,
      text,
    ]);
    setTranscript(transcriptBufferRef.current);
  }, []);

  const stopRecognition = useCallback(() => {
    if (!recognitionRef.current) {
      return;
    }

    try {
      recognitionRef.current.stop();
    } catch {
      // SpeechRecognition throws if it is already stopped. That is safe here.
    }
  }, []);

  const completeActiveListening = useCallback(
    async (shouldSubmit: boolean, allowEmpty = false) => {
      if (!isActiveRef.current && !transcriptBufferRef.current) {
        return;
      }

      clearSilenceTimer();

      const submittedTranscript = transcriptBufferRef.current.trim();
      isActiveRef.current = false;
      isManualListeningRef.current = false;
      isProcessingRef.current = shouldSubmit;
      setIsActive(false);
      setIsManualListening(false);

      stopRecognition();

      if (!shouldSubmit || (!submittedTranscript && !allowEmpty)) {
        return;
      }

      try {
        setIsProcessing(true);
        await optionsRef.current.onSilence(submittedTranscript);
      } finally {
        isProcessingRef.current = false;
        setIsProcessing(false);
      }
    },
    [clearSilenceTimer, stopRecognition],
  );

  const scheduleSilenceTimeout = useCallback(() => {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      void completeActiveListening(true);
    }, optionsRef.current.silenceTimeout);
  }, [clearSilenceTimer, completeActiveListening]);

  const activateListening = useCallback(
    (manual = false, initialTranscript = "") => {
      isActiveRef.current = true;
      isManualListeningRef.current = manual;
      lastTranscriptChunkRef.current = "";
      transcriptBufferRef.current = "";
      setIsActive(true);
      setIsManualListening(manual);
      setTranscript("");

      if (initialTranscript) {
        appendTranscript(initialTranscript);
      }

      optionsRef.current.onActivation();
      scheduleSilenceTimeout();
    },
    [appendTranscript, scheduleSilenceTimeout],
  );

  const handleRecognitionResult = useCallback(
    (event: any) => {
      let interimTranscript = "";
      let finalTranscript = "";

      for (
        let index = event.resultIndex;
        index < event.results.length;
        index += 1
      ) {
        const result = event.results[index];
        const transcriptPiece = result?.[0]?.transcript?.trim();

        if (!transcriptPiece) {
          continue;
        }

        if (result.isFinal) {
          finalTranscript = joinTranscript([finalTranscript, transcriptPiece]);
        } else {
          interimTranscript = joinTranscript([interimTranscript, transcriptPiece]);
        }
      }

      const latestTranscript = joinTranscript([
        finalTranscript || interimTranscript,
      ]);

      if (!latestTranscript) {
        return;
      }

      setError(null);

      if (!isActiveRef.current && containsWakeWord(latestTranscript)) {
        activateListening(false, latestTranscript);
        return;
      }

      if (isActiveRef.current) {
        appendTranscript(latestTranscript);
        scheduleSilenceTimeout();
      }
    },
    [activateListening, appendTranscript, containsWakeWord, scheduleSilenceTimeout],
  );

  const createRecognition = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError("Reconocimiento de voz no soportado en este navegador");
      return null;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = optionsRef.current.continuous;
    recognition.interimResults = true;
    recognition.lang = optionsRef.current.language;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsBackgroundListening(true);
      isBackgroundListeningRef.current = true;
    };

    recognition.onresult = handleRecognitionResult;

    recognition.onerror = (event: any) => {
      if (event.error === "no-speech" || event.error === "aborted") {
        return;
      }

      if (event.error === "not-allowed") {
        setError("Permiso de microfono denegado");
        isBackgroundListeningRef.current = false;
        setIsBackgroundListening(false);
        return;
      }

      if (event.error === "audio-capture") {
        setError("No se pudo acceder al microfono");
        return;
      }

      console.warn("Speech recognition error:", event.error);
    };

    recognition.onend = () => {
      setIsBackgroundListening(false);

      if (!isBackgroundListeningRef.current || isActiveRef.current) {
        return;
      }

      clearRestartTimer();
      restartTimerRef.current = setTimeout(() => {
        if (!isBackgroundListeningRef.current || isActiveRef.current) {
          return;
        }

        try {
          recognition.lang = optionsRef.current.language;
          recognition.continuous = optionsRef.current.continuous;
          recognition.start();
        } catch {
          // Mobile browsers can reject rapid restarts. The next user tap can recover.
        }
      }, RESTART_DELAY_MS);
    };

    return recognition;
  }, [clearRestartTimer, handleRecognitionResult]);

  const startBackgroundListening = useCallback(() => {
    try {
      setError(null);
      clearRestartTimer();

      if (recognitionRef.current && isBackgroundListeningRef.current) {
        return true;
      }

      const recognition = recognitionRef.current ?? createRecognition();
      if (!recognition) {
        return false;
      }

      recognitionRef.current = recognition;
      isBackgroundListeningRef.current = true;
      recognition.lang = optionsRef.current.language;
      recognition.continuous = optionsRef.current.continuous;
      recognition.start();
      return true;
    } catch (err: any) {
      setError(`Error al iniciar reconocimiento de voz: ${err?.message || "desconocido"}`);
      return false;
    }
  }, [clearRestartTimer, createRecognition]);

  const stopBackgroundListening = useCallback(() => {
    isBackgroundListeningRef.current = false;
    isActiveRef.current = false;
    isManualListeningRef.current = false;
    isProcessingRef.current = false;
    clearRestartTimer();
    clearSilenceTimer();
    stopRecognition();

    recognitionRef.current = null;
    transcriptBufferRef.current = "";
    lastTranscriptChunkRef.current = "";
    setIsBackgroundListening(false);
    setIsActive(false);
    setIsManualListening(false);
    setIsProcessing(false);
    setTranscript("");
  }, [clearRestartTimer, clearSilenceTimer, stopRecognition]);

  const startManualListening = useCallback(() => {
    const started = startBackgroundListening();

    if (!started) {
      return false;
    }

    activateListening(true);
    return true;
  }, [activateListening, startBackgroundListening]);

  const submitActiveListening = useCallback(
    async (submitOptions?: SubmitOptions) => {
      await completeActiveListening(true, submitOptions?.allowEmpty ?? false);
    },
    [completeActiveListening],
  );

  const cancelActiveListening = useCallback(async () => {
    await completeActiveListening(false);
  }, [completeActiveListening]);

  const resetActive = useCallback(() => {
    isActiveRef.current = false;
    isManualListeningRef.current = false;
    transcriptBufferRef.current = "";
    lastTranscriptChunkRef.current = "";
    clearSilenceTimer();
    setIsActive(false);
    setIsManualListening(false);
    setTranscript("");

    if (isBackgroundListeningRef.current && !recognitionRef.current) {
      restartTimerRef.current = setTimeout(() => {
        startBackgroundListening();
      }, RESTART_DELAY_MS);
    }
  }, [clearSilenceTimer, startBackgroundListening]);

  useEffect(() => {
    return () => {
      stopBackgroundListening();
    };
  }, [stopBackgroundListening]);

  return {
    isBackgroundListening,
    isActive,
    isManualListening,
    isProcessing,
    transcript,
    error,
    isSupported: isSpeechRecognitionSupported(),
    startBackgroundListening,
    stopBackgroundListening,
    startManualListening,
    submitActiveListening,
    cancelActiveListening,
    resetActive,
  };
}
