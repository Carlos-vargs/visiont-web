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
  
  // Refs para manejar el estado sin dependencias cíclicas
  const transcriptBufferRef = useRef<string>("");
  const processedResultsRef = useRef<Set<number>>(new Set()); // Track processed result indices
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

  // Limpiar y normalizar texto - eliminar duplicados consecutivos
  const cleanTranscript = useCallback((text: string): string => {
    if (!text) return "";
    
    // Eliminar espacios múltiples
    let cleaned = text.replace(/\s+/g, " ").trim();
    
    // Eliminar palabras duplicadas consecutivas
    const words = cleaned.split(" ");
    const uniqueWords: string[] = [];
    
    for (let i = 0; i < words.length; i++) {
      const word = words[i].toLowerCase();
      const prevWord = uniqueWords.length > 0 
        ? uniqueWords[uniqueWords.length - 1].toLowerCase() 
        : "";
      
      // Solo agregar si no es igual a la palabra anterior
      if (word !== prevWord || i === 0) {
        uniqueWords.push(words[i]);
      }
    }
    
    return uniqueWords.join(" ").trim();
  }, []);

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

      // Limpiar y entregar transcripción final
      const finalTranscript = cleanTranscript(transcriptBufferRef.current);
      
      if (optionsRef.current.onSilence && finalTranscript) {
        console.log("Final clean transcript:", finalTranscript);
        optionsRef.current.onSilence(finalTranscript);
      }

      isProcessingRef.current = false;
      setIsProcessing(false);
    }
  }, [cleanTranscript]);

  
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
        processedResultsRef.current.clear(); // Reset processed results on start
      };

      recognition.onresult = (event: any) => {
        let interimTranscript = "";
        let finalTranscript = "";

        // Procesar solo resultados nuevos (no procesados)
        for (let i = event.resultIndex; i < event.results.length; i++) {
          // Skip if already processed
          if (processedResultsRef.current.has(i)) {
            continue;
          }
          
          const transcript = event.results[i][0].transcript;
          const isFinal = event.results[i].isFinal;
          
          if (isFinal) {
            finalTranscript += transcript + " ";
            processedResultsRef.current.add(i); // Mark as processed
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

        // Check for wake words
        const currentTranscript = finalTranscript || interimTranscript;
        
        if (currentTranscript && containsWakeWord(currentTranscript) && !isActiveRef.current) {
          console.log("Wake word detected:", currentTranscript);

          // Activate listening mode
          isActiveRef.current = true;
          setIsActive(true);
          
          // Start fresh with cleaned transcript (exclude wake word context)
          const cleanedWakeTranscript = cleanTranscript(currentTranscript);
          transcriptBufferRef.current = cleanedWakeTranscript + " ";
          setTranscript(cleanedWakeTranscript);

          if (optionsRef.current.onActivation) {
            optionsRef.current.onActivation();
          }

          silenceTimerRef.current = setTimeout(handleSilenceTimeout, silenceTimeout);
        }

        // If already active, append ONLY final results to avoid duplicates
        if (isActiveRef.current && finalTranscript) {
          const cleanedFinal = cleanTranscript(finalTranscript);
          
          // Check if this is a duplicate of the last content
          const lastContent = transcriptBufferRef.current.trim().split(" ").slice(-3).join(" ");
          const newContent = cleanedFinal.split(" ").slice(0, 3).join(" ");
          
          // Only add if it's not a duplicate
          if (!lastContent.includes(newContent) || lastContent.length === 0) {
            transcriptBufferRef.current += cleanedFinal + " ";
            const fullCleanTranscript = cleanTranscript(transcriptBufferRef.current);
            setTranscript(fullCleanTranscript);
          }

          // Reset silence timer
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
          }
          silenceTimerRef.current = setTimeout(handleSilenceTimeout, silenceTimeout);
        }
      };

      recognition.onerror = (event: any) => {
        if (event.error === "no-speech") {
          return;
        }
        if (event.error === "not-allowed") {
          setError("Permiso de micrófono denegado");
        } else {
          console.warn("Speech recognition error:", event.error);
        }
      };

      recognition.onend = () => {
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
  }, [language, containsWakeWord, handleSilenceTimeout, silenceTimeout, cleanTranscript]);

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

  const resetActive = useCallback(() => {
    isActiveRef.current = false;
    setIsActive(false);
    transcriptBufferRef.current = "";
    setTranscript("");
    processedResultsRef.current.clear();

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    if (isBackgroundListeningRef.current) {
      stopBackgroundListening();
      setTimeout(() => {
        startBackgroundListening();
      }, 100);
    }
  }, [startBackgroundListening, stopBackgroundListening]);

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