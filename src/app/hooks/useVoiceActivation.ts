import { useState, useRef, useCallback, useEffect } from "react";

type VoiceActivationOptions = {
  wakeWords?: string[];
  silenceTimeout?: number;
  language?: string;
  onActivation?: () => void;
  onSilence?: (transcript: string) => void;
};

export function useVoiceActivation(options: VoiceActivationOptions = {}) {
  const {
    wakeWords = ["analiza", "quiero que", "ok visiont", "visont", "analizando"],
    silenceTimeout = 4000,
    language = "es-ES",
  } = options;

  const [isBackgroundListening, setIsBackgroundListening] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>("");

  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptBufferRef = useRef<string>("");

  // State flags tracked in refs to avoid stale closures in recognition callbacks
  const isActiveRef = useRef(false);
  const isBackgroundListeningRef = useRef(false);
  // Paused when TTS is speaking — prevents the mic from picking up synthesized voice
  const isPausedRef = useRef(false);
  const isRecognitionStartingRef = useRef(false);

  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const containsWakeWord = useCallback(
    (text: string): boolean => {
      const lower = text.toLowerCase().trim();
      return wakeWords.some((w) => lower.includes(w.toLowerCase()));
    },
    [wakeWords]
  );

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const handleSilenceTimeout = useCallback(() => {
    if (!isActiveRef.current) return;

    const captured = transcriptBufferRef.current.trim();
    // Do not fire if nothing was actually said after wake word
    if (!captured) {
      isActiveRef.current = false;
      setIsActive(false);
      return;
    }

    isActiveRef.current = false;
    setIsActive(false);
    setIsProcessing(true);

    optionsRef.current.onSilence?.(captured);

    setIsProcessing(false);
  }, []);

  // Builds a fresh recognition instance with all event handlers wired up.
  // Called both on initial start and after resuming from pause.
  const buildRecognition = useCallback(() => {
    const SR =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SR) return null;

    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = language;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      isRecognitionStartingRef.current = false;
      setIsBackgroundListening(true);
      isBackgroundListeningRef.current = true;
    };

    rec.onresult = (event: any) => {
      let final = "";
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        event.results[i].isFinal ? (final += t) : (interim += t);
      }

      const full = final || interim;
      if (!full) return;

      // Detect wake word only when not already active
      if (!isActiveRef.current && containsWakeWord(full)) {
        isActiveRef.current = true;
        setIsActive(true);
        transcriptBufferRef.current = "";
        setTranscript("");
        optionsRef.current.onActivation?.();
      }

      // Buffer speech while active and reset the silence deadline
      if (isActiveRef.current) {
        transcriptBufferRef.current +=
          (transcriptBufferRef.current ? " " : "") + full;
        setTranscript(transcriptBufferRef.current.trim());
        clearSilenceTimer();
        silenceTimerRef.current = setTimeout(
          handleSilenceTimeout,
          silenceTimeout
        );
      }
    };

    rec.onerror = (event: any) => {
      // no-speech and aborted are normal during silence / intentional stop
      if (event.error === "no-speech" || event.error === "aborted") return;
      if (event.error === "not-allowed") {
        isBackgroundListeningRef.current = false;
        isPausedRef.current = false;
        isRecognitionStartingRef.current = false;
        recognitionRef.current = null;
        setIsBackgroundListening(false);
        setIsActive(false);
        isActiveRef.current = false;
        setError("Permiso de microfono denegado");
        return;
      }
      console.warn("[useVoiceActivation] error:", event.error);
    };

    rec.onend = () => {
      recognitionRef.current = null;
      isRecognitionStartingRef.current = false;
      // Auto-restart only if we are supposed to be listening AND not paused.
      // This is what keeps background listening alive through natural end events,
      // while respecting deliberate pauses during TTS playback.
      if (isBackgroundListeningRef.current && !isPausedRef.current) {
        if (recognitionRef.current || isRecognitionStartingRef.current) return;
        const next = buildRecognition();
        if (!next) return;
        recognitionRef.current = next;
        isRecognitionStartingRef.current = true;
        try {
          next.start();
        } catch {
          isRecognitionStartingRef.current = false;
          recognitionRef.current = null;
          // Already starting — ignore
        }
      }
    };

    return rec;
  }, [
    language,
    containsWakeWord,
    handleSilenceTimeout,
    silenceTimeout,
    clearSilenceTimer,
  ]);

  const startBackgroundListening = useCallback(() => {
    const SR =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SR) {
      setError("Reconocimiento de voz no soportado en este navegador");
      return;
    }

    setError(null);
    isBackgroundListeningRef.current = true;
    isPausedRef.current = false;

    if (recognitionRef.current || isRecognitionStartingRef.current) {
      return;
    }

    const rec = buildRecognition();
    if (!rec) return;
    recognitionRef.current = rec;
    isRecognitionStartingRef.current = true;
    try {
      rec.start();
    } catch (err: any) {
      isBackgroundListeningRef.current = false;
      isRecognitionStartingRef.current = false;
      recognitionRef.current = null;
      setIsBackgroundListening(false);
      setError(`Error al iniciar reconocimiento: ${err.message}`);
    }
  }, [buildRecognition]);

  const stopBackgroundListening = useCallback(() => {
    isBackgroundListeningRef.current = false;
    isPausedRef.current = false;
    isRecognitionStartingRef.current = false;
    clearSilenceTimer();

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }

    setIsBackgroundListening(false);
    setIsActive(false);
    isActiveRef.current = false;
  }, [clearSilenceTimer]);

  /**
   * Pause recognition while TTS is speaking.
   * The onend handler will NOT auto-restart while isPausedRef is true,
   * so the microphone stays closed and cannot pick up synthesized speech.
   */
  const pauseRecognition = useCallback(() => {
    isPausedRef.current = true;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }
  }, []);

  /**
   * Resume recognition after TTS finishes.
   * A short delay ensures the speaker has fully stopped before the mic reopens,
   * preventing the tail end of synthesized audio from triggering wake words.
   */
  const resumeRecognition = useCallback(() => {
    if (!isBackgroundListeningRef.current) return;
    isPausedRef.current = false;

    // 350ms gives the OS audio pipeline time to flush the TTS output
    setTimeout(() => {
      if (isPausedRef.current || !isBackgroundListeningRef.current) return;
      if (recognitionRef.current || isRecognitionStartingRef.current) return;

      const rec = buildRecognition();
      if (!rec) return;
      recognitionRef.current = rec;
      isRecognitionStartingRef.current = true;
      try {
        rec.start();
      } catch {
        isRecognitionStartingRef.current = false;
        recognitionRef.current = null;
      }
    }, 350);
  }, [buildRecognition]);

  /**
   * Reset active state after an analysis cycle completes.
   * Does NOT restart recognition manually — the onend handler handles that
   * automatically once isPausedRef is false, avoiding the previous
   * setTimeout(100) race condition.
   */
  const resetActive = useCallback(() => {
    isActiveRef.current = false;
    setIsActive(false);
    transcriptBufferRef.current = "";
    setTranscript("");
    clearSilenceTimer();
  }, [clearSilenceTimer]);

  useEffect(() => {
    return () => {
      stopBackgroundListening();
    };
  }, [stopBackgroundListening]);

  return {
    isBackgroundListening,
    isActive,
    isProcessing,
    transcript,
    error,
    startBackgroundListening,
    stopBackgroundListening,
    pauseRecognition,
    resumeRecognition,
    resetActive,
  };
}
