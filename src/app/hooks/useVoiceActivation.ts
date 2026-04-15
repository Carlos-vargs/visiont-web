import { useState, useRef, useCallback, useEffect } from "react";

type VoiceActivationOptions = {
  wakeWords?: string[];
  silenceTimeout?: number;
  language?: string;
  onActivation?: () => void;
  onSilence?: (transcript: string) => void;
};

/**
 * Hook for intelligent voice activation
 * Always listens in background for wake words
 * Auto-activates when wake words are detected
 * Auto-stops after silence timeout
 */
export function useVoiceActivation(options: VoiceActivationOptions = {}) {
  const {
    wakeWords = ["analiza", "quiero que", "ok visiont", "visont", "analizando"],
    silenceTimeout = 2000,
    language = "es-ES",
  } = options;

  const [isBackgroundListening, setIsBackgroundListening] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>("");

  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSpeechTimeRef = useRef<number>(0);
  const transcriptBufferRef = useRef<string>("");
  const isActiveRef = useRef(false);
  const isProcessingRef = useRef(false);
  const isBackgroundListeningRef = useRef(false);
  const optionsRef = useRef(options);

  // Keep options ref updated
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  // Check if transcript contains wake words
  const containsWakeWord = useCallback((text: string): boolean => {
    const lowerText = text.toLowerCase().trim();
    return wakeWords.some(word => lowerText.includes(word.toLowerCase()));
  }, [wakeWords]);

  // Handle silence timeout - auto-stop and send
  const handleSilenceTimeout = useCallback(() => {
    if (isActiveRef.current && !isProcessingRef.current) {
      console.log("Silence detected, auto-stopping...");
      setIsProcessing(true);
      setIsActive(false);

      // Stop recognition
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (err) {
          // ignore
        }
      }

      // Call the onSilence callback to trigger analysis with transcript
      if (optionsRef.current.onSilence && transcriptBufferRef.current) {
        optionsRef.current.onSilence(transcriptBufferRef.current.trim());
      }

      isProcessingRef.current = false;
      setIsProcessing(false);
    }
  }, []);

  // Start background listening (always on)
  const startBackgroundListening = useCallback(() => {
    try {
      setError(null);

      // Check for SpeechRecognition API
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) {
        setError("Reconocimiento de voz no soportado en este navegador");
        return;
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = language;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setIsBackgroundListening(true);
        isBackgroundListeningRef.current = true;
        console.log("Background voice activation started");
      };

      recognition.onresult = (event: any) => {
        let interimTranscript = "";
        let finalTranscript = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript;
          } else {
            interimTranscript += transcript;
          }
        }

        // Update last speech time
        lastSpeechTimeRef.current = Date.now();

        // Clear existing silence timer
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
        }

        // Check for wake words in interim or final transcript
        const fullTranscript = finalTranscript || interimTranscript;
        if (fullTranscript && containsWakeWord(fullTranscript) && !isActiveRef.current) {
          console.log("Wake word detected:", fullTranscript);

          // Activate listening mode
          isActiveRef.current = true;
          setIsActive(true);
          // Start fresh transcript buffer (exclude wake word if possible)
          transcriptBufferRef.current = fullTranscript + " ";
          setTranscript(fullTranscript);

          // Call activation callback
          if (optionsRef.current.onActivation) {
            optionsRef.current.onActivation();
          }

          // Start silence timer for auto-stop
          silenceTimerRef.current = setTimeout(handleSilenceTimeout, silenceTimeout);
        }

        // If already active, buffer the transcript and keep checking for silence
        if (isActiveRef.current && fullTranscript) {
          transcriptBufferRef.current += fullTranscript + " ";
          setTranscript(transcriptBufferRef.current.trim());

          // Reset silence timer on each speech input
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
          }
          silenceTimerRef.current = setTimeout(handleSilenceTimeout, silenceTimeout);
        }
      };

      recognition.onerror = (event: any) => {
        if (event.error === "no-speech") {
          // Ignore no-speech errors (normal during silence)
          return;
        }
        if (event.error === "not-allowed") {
          setError("Permiso de micrófono denegado");
        } else {
          console.warn("Speech recognition error:", event.error);
        }
      };

      recognition.onend = () => {
        // Auto-restart if we're supposed to be listening
        if (isBackgroundListeningRef.current && !isActiveRef.current) {
          try {
            recognition.start();
          } catch (err) {
            // ignore restart errors
          }
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: any) {
      setError(`Error al iniciar reconocimiento de voz: ${err.message}`);
    }
  }, [language, containsWakeWord, handleSilenceTimeout, silenceTimeout]);

  // Stop background listening
  const stopBackgroundListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (err) {
        // ignore
      }
      recognitionRef.current = null;
    }

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    setIsBackgroundListening(false);
    setIsActive(false);
    isActiveRef.current = false;
    isBackgroundListeningRef.current = false;
  }, []);

  // Reset active state (called after analysis is complete)
  const resetActive = useCallback(() => {
    isActiveRef.current = false;
    setIsActive(false);
    transcriptBufferRef.current = "";
    setTranscript("");

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    // Restart background listening
    if (isBackgroundListeningRef.current) {
      stopBackgroundListening();
      setTimeout(() => {
        startBackgroundListening();
      }, 100);
    }
  }, [startBackgroundListening, stopBackgroundListening]);

  // Cleanup on unmount
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
    resetActive,
  };
}
