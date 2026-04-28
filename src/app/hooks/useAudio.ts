import { useState, useRef, useCallback, useEffect } from "react";
import { sendDebugEvent, serializeError } from "../lib/debugTelemetry";

type AudioOptions = {
  sendSampleRate?: number;
  receiveSampleRate?: number;
  chunkSize?: number;
  enableEchoCancellation?: boolean;
};

type VoiceRecognitionOptions = {
  wakeWords?: string[];
  silenceTimeout?: number;
  language?: string;
  onActivation?: () => void;
  onSilence?: (transcript: string) => void;
};

type RecognitionMode = "background" | "manual";

export type AudioInputStatus =
  | "idle"
  | "starting"
  | "active"
  | "blocked"
  | "unavailable"
  | "error";

export type AudioRecognitionStatus =
  | "idle"
  | "starting"
  | "manual"
  | "background"
  | "paused"
  | "unsupported"
  | "error";

export type AudioSpeechStatus =
  | "idle"
  | "queued"
  | "speaking"
  | "cancelled"
  | "unsupported"
  | "error";

type MicrophonePermissionStatus =
  | "unknown"
  | "granted"
  | "prompt"
  | "denied"
  | "unavailable";

type MicrophonePermissionCache = {
  status: "granted";
  updatedAt: number;
  lastSuccessAt: number;
};

type SpeechQueueItem = {
  text: string;
  resolve: () => void;
  timeoutMs: number;
  resolved?: boolean;
};

type SpeakTextOptions = {
  timeoutMs?: number;
};

const MICROPHONE_PERMISSION_CACHE_KEY = "visiont:microphone-permission";
const MICROPHONE_RECOVERY_MESSAGE =
  "El navegador no permitio abrir el microfono aunque ya estaba autorizado. Revisa ajustes o intenta recargar.";
const SPEECH_PLAYBACK_ERROR_MESSAGE =
  "No pude reproducir la respuesta hablada. Puedes leerla en pantalla.";
const DEFAULT_RECOGNITION_LANGUAGE = "es-ES";
const DEFAULT_SILENCE_TIMEOUT = 4000;
const DEFAULT_SPEECH_TIMEOUT_MS = 12000;
const MIN_SPEECH_CHUNK_TIMEOUT_MS = 6000;
const MAX_SPEECH_CHUNK_TIMEOUT_MS = 22000;
const SPEECH_CHARS_PER_SECOND = 12;
const MAX_SPEECH_CHUNK_LENGTH = 220;
const DEFAULT_WAKE_WORDS = [
  "analiza",
  "quiero que",
  "ok visiont",
  "visont",
  "analizando",
];

// Int16Array -> Base64
const int16ToBase64 = (int16Array: Int16Array): string => {
  const uint8Array = new Uint8Array(int16Array.buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    const chunk = uint8Array.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const getInlineWorkletCode = (chunkSize: number) => `
  class AudioProcessor extends AudioWorkletProcessor {
    constructor(options) {
      super();
      this.chunkSize = options?.processorOptions?.chunkSize || ${chunkSize};
      this.buffer = new Float32Array(this.chunkSize);
      this.bufferIndex = 0;
      this.port.onmessage = (e) => {
        if (e.data?.type === 'stop') { this.bufferIndex = 0; this.buffer.fill(0); }
      };
    }
    process(inputs) {
      const input = inputs[0];
      if (input?.[0]) {
        const inputData = input[0];
        for (let i = 0; i < inputData.length; i++) {
          this.buffer[this.bufferIndex++] = inputData[i];
          if (this.bufferIndex >= this.chunkSize) {
            const int16Data = new Int16Array(this.chunkSize);
            for (let j = 0; j < this.chunkSize; j++) {
              const s = Math.max(-1, Math.min(1, this.buffer[j]));
              int16Data[j] = s < 0 ? s * 0x8000 : s * 0x7fff;
            }
            const rms = Math.sqrt(
              this.buffer.reduce((sum, val) => sum + val * val, 0) / this.chunkSize
            );
            this.port.postMessage(
              { type: 'audio-chunk', pcmData: int16Data.buffer, audioLevel: Math.min(rms * 5, 1) },
              [int16Data.buffer]
            );
            this.bufferIndex = 0;
          }
        }
      }
      return true;
    }
  }
  registerProcessor('audio-processor', AudioProcessor);
`;

const resolveSpeechItem = (item: SpeechQueueItem | null) => {
  if (!item || item.resolved) {
    return;
  }

  item.resolved = true;
  item.resolve();
};

const splitSpeechText = (text: string): string[] => {
  const cleanText = text.replace(/\s+/g, " ").trim();
  if (!cleanText) {
    return [];
  }

  const sentenceParts =
    cleanText.match(/[^.!?;:\n]+[.!?;:]?/g)?.map((part) => part.trim()) ?? [
      cleanText,
    ];
  const chunks: string[] = [];
  let current = "";

  const pushLongPart = (part: string) => {
    const words = part.split(/\s+/);
    let buffer = "";

    for (const word of words) {
      const next = buffer ? `${buffer} ${word}` : word;
      if (next.length > MAX_SPEECH_CHUNK_LENGTH && buffer) {
        chunks.push(buffer);
        buffer = word;
      } else {
        buffer = next;
      }
    }

    if (buffer) {
      chunks.push(buffer);
    }
  };

  for (const part of sentenceParts) {
    if (!part) {
      continue;
    }

    if (part.length > MAX_SPEECH_CHUNK_LENGTH) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      pushLongPart(part);
      continue;
    }

    const next = current ? `${current} ${part}` : part;
    if (next.length > MAX_SPEECH_CHUNK_LENGTH && current) {
      chunks.push(current);
      current = part;
    } else {
      current = next;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.length > 0 ? chunks : [cleanText];
};

const getSpeechChunkTimeoutMs = (text: string, overrideMs: number) => {
  if (overrideMs !== DEFAULT_SPEECH_TIMEOUT_MS) {
    return overrideMs;
  }

  const estimatedMs = (text.length / SPEECH_CHARS_PER_SECOND) * 1000 + 3000;
  return Math.max(
    MIN_SPEECH_CHUNK_TIMEOUT_MS,
    Math.min(MAX_SPEECH_CHUNK_TIMEOUT_MS, Math.ceil(estimatedMs)),
  );
};

const isIntentionalSpeechError = (event: any) => {
  const error = String(event?.error || "").toLowerCase();
  return (
    error === "canceled" ||
    error === "cancelled" ||
    error === "interrupted" ||
    error === "aborted"
  );
};

const readMicrophonePermissionCache = (): MicrophonePermissionCache | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(MICROPHONE_PERMISSION_CACHE_KEY);
    if (!stored) {
      return null;
    }

    const parsed = JSON.parse(stored) as Partial<MicrophonePermissionCache>;
    return parsed.status === "granted"
      ? (parsed as MicrophonePermissionCache)
      : null;
  } catch {
    return null;
  }
};

const writeMicrophonePermissionGranted = () => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const now = Date.now();
    window.localStorage.setItem(
      MICROPHONE_PERMISSION_CACHE_KEY,
      JSON.stringify({
        status: "granted",
        updatedAt: now,
        lastSuccessAt: now,
      } satisfies MicrophonePermissionCache),
    );
  } catch {
    // Permission cache is a UX hint only; storage failure must not block audio.
  }
};

const queryMicrophonePermission =
  async (): Promise<MicrophonePermissionStatus> => {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) {
      return "unknown";
    }

    try {
      const status = await navigator.permissions.query({
        name: "microphone" as PermissionName,
      });
      return status.state;
    } catch {
      return "unknown";
    }
  };

const getSpeechRecognitionConstructor = () => {
  if (typeof window === "undefined") {
    return null;
  }

  return (
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition ||
    null
  );
};

const isTransientMicrophoneError = (err: any) =>
  err?.name === "AbortError" || err?.name === "NotReadableError";

export function useAudio(options: AudioOptions = {}) {
  const {
    sendSampleRate = 16000,
    chunkSize = 1024,
    enableEchoCancellation = false,
    receiveSampleRate = 24000,
  } = options;

  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] =
    useState<MicrophonePermissionStatus>(() =>
      readMicrophonePermissionCache() ? "granted" : "unknown",
    );
  const [permissionGranted, setPermissionGranted] = useState(
    () => permissionStatus === "granted",
  );
  const [audioLevel, setAudioLevel] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [isRecognitionSupported, setIsRecognitionSupported] = useState(false);
  const [isManualListening, setIsManualListening] = useState(false);
  const [isBackgroundListening, setIsBackgroundListening] = useState(false);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [isVoiceProcessing, setIsVoiceProcessing] = useState(false);
  const [inputStatus, setInputStatus] = useState<AudioInputStatus>("idle");
  const [recognitionStatus, setRecognitionStatus] =
    useState<AudioRecognitionStatus>("idle");
  const [speechStatus, setSpeechStatus] = useState<AudioSpeechStatus>("idle");
  const [lastAudioError, setLastAudioError] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
  const workletBlobUrlRef = useRef<string | null>(null);
  const onAudioChunkRef = useRef<((chunkBase64: string) => void) | null>(null);
  const isListeningRef = useRef(false);
  const isStartingRef = useRef(false);
  const inputStartPromiseRef = useRef<Promise<boolean> | null>(null);
  const audioGenerationRef = useRef(0);
  const hasKnownMicrophoneAccessRef = useRef(
    Boolean(readMicrophonePermissionCache()),
  );
  const lastReportedErrorRef = useRef<string | null>(null);

  // Playback
  const playbackContextRef = useRef<AudioContext | null>(null);
  const playbackQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef(false);

  // Speech synthesis queue — ensures utterances play sequentially with no overlap
  const speechQueueRef = useRef<SpeechQueueItem[]>([]);
  const isSpeechProcessingRef = useRef(false);
  // Tracks the utterance currently being spoken so cancelSpeech can abort it
  const currentUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const currentSpeechItemRef = useRef<SpeechQueueItem | null>(null);
  const speechGenerationRef = useRef(0);

  // SpeechRecognition state
  const recognitionRef = useRef<any>(null);
  const recognitionOptionsRef = useRef<VoiceRecognitionOptions>({});
  const recognitionModeRef = useRef<RecognitionMode | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptBufferRef = useRef("");
  const latestTranscriptRef = useRef("");
  const isVoiceActiveRef = useRef(false);
  const isBackgroundListeningRef = useRef(false);
  const isRecognitionPausedRef = useRef(false);
  const isRecognitionStartingRef = useRef(false);
  const recognitionGenerationRef = useRef(0);

  useEffect(() => {
    let isMounted = true;

    setIsRecognitionSupported(Boolean(getSpeechRecognitionConstructor()));

    const syncPermissionStatus = async () => {
      const browserPermissionStatus = await queryMicrophonePermission();
      if (!isMounted || browserPermissionStatus === "unknown") {
        return;
      }

      setPermissionStatus(browserPermissionStatus);
      setPermissionGranted(browserPermissionStatus === "granted");
    };

    void syncPermissionStatus();

    return () => {
      isMounted = false;
    };
  }, []);

  // --- Worklet helpers ---

  const cleanupWorkletUrl = useCallback(() => {
    if (workletBlobUrlRef.current) {
      URL.revokeObjectURL(workletBlobUrlRef.current);
      workletBlobUrlRef.current = null;
    }
  }, []);

  const loadWorkletModule = useCallback(
    async (context: AudioContext): Promise<void> => {
      try {
        const isDev = import.meta.env.DEV;
        let src: string;
        if (isDev) {
          const mod = await import("./audio-processor.worklet.ts?worker&url");
          src = mod.default;
        } else {
          src = new URL(
            "./audio-processor.worklet.ts?worker&url",
            import.meta.url
          ).href;
        }
        await context.audioWorklet.addModule(src);
      } catch {
        // Fallback: inline worklet via blob URL
        const blob = new Blob([getInlineWorkletCode(chunkSize)], {
          type: "application/javascript",
        });
        const url = URL.createObjectURL(blob);
        workletBlobUrlRef.current = url;
        await context.audioWorklet.addModule(url);
      }
    },
    [chunkSize]
  );

  // --- Microphone ---

  const setAudioError = useCallback((message: string | null) => {
    setError(message);
    setLastAudioError(message);
  }, []);

  useEffect(() => {
    if (!error) {
      lastReportedErrorRef.current = null;
      return;
    }

    const snapshot = JSON.stringify({
      error,
      inputStatus,
      recognitionStatus,
      speechStatus,
    });

    if (lastReportedErrorRef.current === snapshot) {
      return;
    }

    lastReportedErrorRef.current = snapshot;

    sendDebugEvent({
      type: "audio.error",
      source: "useAudio",
      level: "error",
      message: error,
      payload: {
        inputStatus,
        recognitionStatus,
        speechStatus,
      },
    });
  }, [error, inputStatus, recognitionStatus, speechStatus]);

  const cleanupInput = useCallback(() => {
    audioGenerationRef.current += 1;
    if (audioWorkletNodeRef.current) {
      audioWorkletNodeRef.current.port.postMessage({ type: "stop" });
      audioWorkletNodeRef.current.disconnect();
      audioWorkletNodeRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    cleanupWorkletUrl();
    isListeningRef.current = false;
    isStartingRef.current = false;
    inputStartPromiseRef.current = null;
    setIsListening(false);
    setAudioLevel(0);
    setInputStatus("idle");
  }, [cleanupWorkletUrl]);

  const startListening = useCallback(
    async (onAudioChunk?: (chunkBase64: string) => void): Promise<boolean> => {
      if (isListeningRef.current) {
        return true;
      }

      if (inputStartPromiseRef.current) {
        return inputStartPromiseRef.current;
      }

      const startPromise = (async () => {
        const openGeneration = audioGenerationRef.current + 1;
        audioGenerationRef.current = openGeneration;

        try {
          if (
            typeof navigator === "undefined" ||
            !navigator.mediaDevices?.getUserMedia
          ) {
            const message = "Este navegador no permite abrir el microfono.";
            setPermissionStatus("unavailable");
            setPermissionGranted(false);
            setInputStatus("unavailable");
            setAudioError(message);
            return false;
          }

          isStartingRef.current = true;
          setInputStatus("starting");
          setAudioError(null);
          onAudioChunkRef.current = onAudioChunk ?? null;

          const browserPermissionStatus = await queryMicrophonePermission();
          if (browserPermissionStatus !== "unknown") {
            setPermissionStatus(browserPermissionStatus);
          }

          const openInputOnce = async () => {
            const audioContext = new AudioContext({ sampleRate: sendSampleRate });
            audioContextRef.current = audioContext;

            const stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: enableEchoCancellation,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: sendSampleRate,
              },
            });
            streamRef.current = stream;

            const source = audioContext.createMediaStreamSource(stream);

            await loadWorkletModule(audioContext);

            const workletNode = new AudioWorkletNode(
              audioContext,
              "audio-processor",
              {
                processorOptions: { chunkSize },
                numberOfInputs: 1,
                numberOfOutputs: 1,
                outputChannelCount: [1],
              },
            );
            audioWorkletNodeRef.current = workletNode;

            workletNode.port.onmessage = (event: MessageEvent) => {
              if (openGeneration !== audioGenerationRef.current) {
                return;
              }

              const { type, pcmData, audioLevel: level } = event.data;
              if (type === "audio-chunk") {
                setAudioLevel(level);
                if (onAudioChunkRef.current && pcmData) {
                  const base64 = int16ToBase64(new Int16Array(pcmData));
                  onAudioChunkRef.current(base64);
                }
              }
            };

            source.connect(workletNode);
            workletNode.connect(audioContext.destination);
          };

          try {
            await openInputOnce();
          } catch (err: any) {
            cleanupInput();
            if (isTransientMicrophoneError(err)) {
              audioGenerationRef.current = openGeneration;
              isStartingRef.current = true;
              setInputStatus("starting");
              await openInputOnce();
            } else {
              throw err;
            }
          }

          if (openGeneration !== audioGenerationRef.current) {
            cleanupInput();
            return false;
          }

          isListeningRef.current = true;
          isStartingRef.current = false;
          hasKnownMicrophoneAccessRef.current = true;
          writeMicrophonePermissionGranted();
          setIsListening(true);
          setInputStatus("active");
          setPermissionGranted(true);
          setPermissionStatus("granted");
          sendDebugEvent({
            type: "audio.input_started",
            source: "useAudio",
            message: "Microphone input started",
            payload: {
              sampleRate: sendSampleRate,
              chunkSize,
              enableEchoCancellation,
            },
          });
          return true;
        } catch (err: any) {
          const hadKnownAccess =
            hasKnownMicrophoneAccessRef.current ||
            permissionStatus === "granted" ||
            Boolean(readMicrophonePermissionCache());
          const isBlocked = err.name === "NotAllowedError";
          const msg = isBlocked
            ? hadKnownAccess
              ? MICROPHONE_RECOVERY_MESSAGE
              : "Permiso de microfono denegado. Habilita el acceso en la configuracion del navegador."
            : `Error al acceder al microfono: ${err.message}`;
          setAudioError(msg);
          setPermissionGranted(false);
          setPermissionStatus(isBlocked ? "denied" : "unknown");
          setInputStatus(isBlocked ? "blocked" : "error");
          cleanupInput();
          setInputStatus(isBlocked ? "blocked" : "error");
          sendDebugEvent({
            type: "audio.input_error",
            source: "useAudio",
            level: "error",
            message: msg,
            payload: serializeError(err),
          });
          return false;
        } finally {
          isStartingRef.current = false;
          inputStartPromiseRef.current = null;
        }
      })();

      inputStartPromiseRef.current = startPromise;
      return startPromise;
    },
    [
      sendSampleRate,
      chunkSize,
      enableEchoCancellation,
      loadWorkletModule,
      cleanupInput,
      setAudioError,
      permissionStatus,
    ]
  );

  const stopListening = useCallback(() => {
    if (isListeningRef.current) {
      sendDebugEvent({
        type: "audio.input_stopped",
        source: "useAudio",
        message: "Microphone input stopped",
      });
    }
    cleanupInput();
  }, [cleanupInput]);

  // --- Speech recognition ---

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const resetTranscript = useCallback(() => {
    transcriptBufferRef.current = "";
    latestTranscriptRef.current = "";
    setTranscript("");
  }, []);

  const resetRecognition = useCallback(() => {
    resetTranscript();
    isVoiceActiveRef.current = false;
    setIsVoiceActive(false);
    setIsVoiceProcessing(false);
    clearSilenceTimer();
  }, [clearSilenceTimer, resetTranscript]);

  const appendFinalTranscript = useCallback((value: string) => {
    const clean = value.trim();
    if (!clean) {
      return;
    }

    transcriptBufferRef.current =
      `${transcriptBufferRef.current} ${clean}`.trim();
  }, []);

  const updateTranscript = useCallback((interim = "") => {
    const next = `${transcriptBufferRef.current} ${interim}`.trim();
    latestTranscriptRef.current = next;
    setTranscript(next);
  }, []);

  const getRecognitionOptions = useCallback(() => {
    const current = recognitionOptionsRef.current;
    return {
      wakeWords: current.wakeWords ?? DEFAULT_WAKE_WORDS,
      silenceTimeout: current.silenceTimeout ?? DEFAULT_SILENCE_TIMEOUT,
      language: current.language ?? DEFAULT_RECOGNITION_LANGUAGE,
      onActivation: current.onActivation,
      onSilence: current.onSilence,
    };
  }, []);

  const containsWakeWord = useCallback(
    (text: string) => {
      const { wakeWords } = getRecognitionOptions();
      const lower = text.toLowerCase().trim();
      return wakeWords.some((word) => lower.includes(word.toLowerCase()));
    },
    [getRecognitionOptions],
  );

  const handleSilenceTimeout = useCallback(() => {
    if (!isVoiceActiveRef.current) {
      return;
    }

    const captured = transcriptBufferRef.current.trim();
    if (!captured) {
      isVoiceActiveRef.current = false;
      setIsVoiceActive(false);
      return;
    }

    const { onSilence } = getRecognitionOptions();
    isVoiceActiveRef.current = false;
    setIsVoiceActive(false);
    setIsVoiceProcessing(true);
    sendDebugEvent({
      type: "audio.background_transcript",
      source: "useAudio",
      message: "Background voice transcript captured",
      payload: { transcript: captured },
    });
    onSilence?.(captured);
    setIsVoiceProcessing(false);
  }, [getRecognitionOptions]);

  const buildRecognition = useCallback(
    (mode: RecognitionMode) => {
      const SpeechRecognition = getSpeechRecognitionConstructor();
      if (!SpeechRecognition) {
        setIsRecognitionSupported(false);
        return null;
      }

      setIsRecognitionSupported(true);
      const generation = recognitionGenerationRef.current;
      const { language, silenceTimeout, onActivation } =
        getRecognitionOptions();
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = language;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        if (generation !== recognitionGenerationRef.current) {
          return;
        }

        isRecognitionStartingRef.current = false;
        recognitionModeRef.current = mode;

        if (mode === "manual") {
          setIsManualListening(true);
          setRecognitionStatus("manual");
          return;
        }

        isBackgroundListeningRef.current = true;
        setIsBackgroundListening(true);
        setRecognitionStatus("background");
      };

      recognition.onresult = (event: any) => {
        if (generation !== recognitionGenerationRef.current) {
          return;
        }

        let final = "";
        let interim = "";

        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const resultText = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            final += resultText;
          } else {
            interim += resultText;
          }
        }

        const full = final || interim;
        if (!full) {
          return;
        }

        if (mode === "manual") {
          appendFinalTranscript(final);
          updateTranscript(interim);
          return;
        }

        if (!isVoiceActiveRef.current && containsWakeWord(full)) {
          isVoiceActiveRef.current = true;
          setIsVoiceActive(true);
          resetTranscript();
          onActivation?.();
          sendDebugEvent({
            type: "audio.wake_word_detected",
            source: "useAudio",
            message: "Wake word detected",
            payload: { transcript: full.trim() },
          });
        }

        if (isVoiceActiveRef.current) {
          appendFinalTranscript(full);
          updateTranscript();
          clearSilenceTimer();
          silenceTimerRef.current = setTimeout(
            handleSilenceTimeout,
            silenceTimeout,
          );
        }
      };

      recognition.onerror = (event: any) => {
        if (generation !== recognitionGenerationRef.current) {
          return;
        }

        if (event.error === "no-speech" || event.error === "aborted") {
          return;
        }

        if (event.error === "not-allowed") {
          isBackgroundListeningRef.current = false;
          isRecognitionPausedRef.current = false;
          isRecognitionStartingRef.current = false;
          recognitionModeRef.current = null;
          recognitionRef.current = null;
          isVoiceActiveRef.current = false;
          clearSilenceTimer();
          setIsBackgroundListening(false);
          setIsManualListening(false);
          setIsVoiceActive(false);
          setRecognitionStatus("error");
          setAudioError("Permiso de microfono denegado");
          return;
        }

        console.warn("[useAudio] SpeechRecognition error:", event.error);
        setRecognitionStatus("error");
        sendDebugEvent({
          type: "audio.recognition_error",
          source: "useAudio",
          level: "error",
          message: `SpeechRecognition error: ${event.error}`,
          payload: { error: event.error },
        });
      };

      recognition.onend = () => {
        if (generation !== recognitionGenerationRef.current) {
          return;
        }

        recognitionRef.current = null;
        isRecognitionStartingRef.current = false;

        if (mode === "manual") {
          recognitionModeRef.current = null;
          setIsManualListening(false);
          setRecognitionStatus("idle");
          return;
        }

        if (isBackgroundListeningRef.current && !isRecognitionPausedRef.current) {
          if (recognitionRef.current || isRecognitionStartingRef.current) {
            return;
          }

          const nextRecognition = buildRecognition("background");
          if (!nextRecognition) {
            return;
          }

          recognitionRef.current = nextRecognition;
          isRecognitionStartingRef.current = true;
          try {
            nextRecognition.start();
          } catch {
            isRecognitionStartingRef.current = false;
            recognitionRef.current = null;
          }
        }
      };

      return recognition;
    },
    [
      appendFinalTranscript,
      clearSilenceTimer,
      containsWakeWord,
      getRecognitionOptions,
      handleSilenceTimeout,
      resetTranscript,
      setAudioError,
      updateTranscript,
    ],
  );

  const startBackgroundRecognition = useCallback(
    (recognitionOptions: VoiceRecognitionOptions = {}) => {
      const SpeechRecognition = getSpeechRecognitionConstructor();
      if (!SpeechRecognition) {
        setIsRecognitionSupported(false);
        setRecognitionStatus("unsupported");
        setAudioError("Reconocimiento de voz no soportado en este navegador");
        return;
      }

      recognitionOptionsRef.current = recognitionOptions;
      setIsRecognitionSupported(true);
      setAudioError(null);
      isBackgroundListeningRef.current = true;
      isRecognitionPausedRef.current = false;
      setRecognitionStatus("starting");

      if (recognitionRef.current || isRecognitionStartingRef.current) {
        return;
      }

      recognitionModeRef.current = "background";
      recognitionGenerationRef.current += 1;
      const recognition = buildRecognition("background");
      if (!recognition) {
        return;
      }

      recognitionRef.current = recognition;
      isRecognitionStartingRef.current = true;
      try {
        recognition.start();
        sendDebugEvent({
          type: "audio.background_recognition_started",
          source: "useAudio",
          message: "Background speech recognition started",
        });
      } catch (err: any) {
        isBackgroundListeningRef.current = false;
        isRecognitionStartingRef.current = false;
        recognitionRef.current = null;
        recognitionModeRef.current = null;
        setIsBackgroundListening(false);
        setRecognitionStatus("error");
        setAudioError(`Error al iniciar reconocimiento: ${err.message}`);
        sendDebugEvent({
          type: "audio.background_recognition_error",
          source: "useAudio",
          level: "error",
          message: err.message || "Error al iniciar reconocimiento",
          payload: serializeError(err),
        });
      }
    },
    [buildRecognition, setAudioError],
  );

  const startManualRecognition = useCallback(
    (recognitionOptions: Pick<VoiceRecognitionOptions, "language"> = {}) => {
      const SpeechRecognition = getSpeechRecognitionConstructor();
      if (!SpeechRecognition) {
        setIsRecognitionSupported(false);
        setRecognitionStatus("unsupported");
        setAudioError("Reconocimiento de voz no soportado en este navegador");
        return false;
      }

      recognitionOptionsRef.current = {
        ...recognitionOptionsRef.current,
        ...recognitionOptions,
      };
      setIsRecognitionSupported(true);
      setAudioError(null);
      clearSilenceTimer();
      resetRecognition();
      isBackgroundListeningRef.current = false;
      isRecognitionPausedRef.current = false;
      setIsBackgroundListening(false);
      setRecognitionStatus("starting");

      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
        recognitionRef.current = null;
      }

      isRecognitionStartingRef.current = false;

      recognitionModeRef.current = "manual";
      recognitionGenerationRef.current += 1;
      const recognition = buildRecognition("manual");
      if (!recognition) {
        return false;
      }

      recognitionRef.current = recognition;
      isRecognitionStartingRef.current = true;
      try {
        recognition.start();
        sendDebugEvent({
          type: "audio.manual_recognition_started",
          source: "useAudio",
          message: "Manual speech recognition started",
        });
        return true;
      } catch (err: any) {
        isRecognitionStartingRef.current = false;
        recognitionModeRef.current = null;
        recognitionRef.current = null;
        setIsManualListening(false);
        setRecognitionStatus("error");
        setAudioError(`Error al iniciar reconocimiento: ${err.message}`);
        sendDebugEvent({
          type: "audio.manual_recognition_error",
          source: "useAudio",
          level: "error",
          message: err.message || "Error al iniciar reconocimiento",
          payload: serializeError(err),
        });
        return false;
      }
    },
    [buildRecognition, clearSilenceTimer, resetRecognition, setAudioError],
  );

  const stopManualRecognition = useCallback(() => {
    const captured =
      latestTranscriptRef.current.trim() || transcriptBufferRef.current.trim();

    isRecognitionStartingRef.current = false;
    recognitionModeRef.current = null;
    recognitionGenerationRef.current += 1;

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }

    setIsManualListening(false);
    setRecognitionStatus("idle");

    if (captured) {
      sendDebugEvent({
        type: "audio.manual_transcript",
        source: "useAudio",
        message: "Manual voice transcript captured",
        payload: { transcript: captured },
      });
    }

    return captured;
  }, []);

  const stopBackgroundRecognition = useCallback(() => {
    isBackgroundListeningRef.current = false;
    isRecognitionPausedRef.current = false;
    isRecognitionStartingRef.current = false;
    recognitionModeRef.current = null;
    recognitionGenerationRef.current += 1;
    clearSilenceTimer();

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }

    isVoiceActiveRef.current = false;
    setIsBackgroundListening(false);
    setIsManualListening(false);
    setIsVoiceActive(false);
    setIsVoiceProcessing(false);
    setRecognitionStatus("idle");
  }, [clearSilenceTimer]);

  const pauseRecognition = useCallback(() => {
    isRecognitionPausedRef.current = true;
    setRecognitionStatus("paused");
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }
  }, []);

  const resumeRecognition = useCallback(() => {
    if (!isBackgroundListeningRef.current) {
      return;
    }

    isRecognitionPausedRef.current = false;

    setTimeout(() => {
      if (
        isRecognitionPausedRef.current ||
        !isBackgroundListeningRef.current ||
        recognitionRef.current ||
        isRecognitionStartingRef.current
      ) {
        return;
      }

      const recognition = buildRecognition("background");
      if (!recognition) {
        return;
      }

      recognitionRef.current = recognition;
      isRecognitionStartingRef.current = true;
      setRecognitionStatus("starting");
      try {
        recognition.start();
      } catch {
        isRecognitionStartingRef.current = false;
        recognitionRef.current = null;
      }
    }, 350);
  }, [buildRecognition]);

  // --- PCM playback ---

  const processPlaybackQueue = useCallback(async (ctx: AudioContext) => {
    while (playbackQueueRef.current.length > 0) {
      const buffer = playbackQueueRef.current.shift();
      if (!buffer) continue;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      await new Promise<void>((resolve) => {
        source.onended = () => resolve();
        source.start();
      });
    }
    isPlayingRef.current = false;
    setIsSpeaking(false);
  }, []);

  const playAudioChunk = useCallback(
    async (chunkBase64: string) => {
      try {
        const bytes = Uint8Array.from(atob(chunkBase64), (c) =>
          c.charCodeAt(0)
        );
        const int16 = new Int16Array(bytes.buffer);
        const float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) {
          float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
        }

        if (
          !playbackContextRef.current ||
          playbackContextRef.current.state === "closed"
        ) {
          playbackContextRef.current = new AudioContext({
            sampleRate: receiveSampleRate,
          });
        }
        const ctx = playbackContextRef.current;
        const buf = ctx.createBuffer(1, float32.length, receiveSampleRate);
        buf.getChannelData(0).set(float32);
        playbackQueueRef.current.push(buf);

        if (!isPlayingRef.current) {
          isPlayingRef.current = true;
          setIsSpeaking(true);
          sendDebugEvent({
            type: "audio.playback_started",
            source: "useAudio",
            message: "PCM audio playback started",
            payload: { sampleRate: receiveSampleRate },
          });
          await processPlaybackQueue(ctx);
        }
      } catch (err: any) {
        setError(`Error al reproducir audio: ${err.message}`);
        setIsSpeaking(false);
        isPlayingRef.current = false;
        sendDebugEvent({
          type: "audio.playback_error",
          source: "useAudio",
          level: "error",
          message: err.message || "Error al reproducir audio",
          payload: serializeError(err),
        });
      }
    },
    [receiveSampleRate, processPlaybackQueue]
  );

  // --- Speech synthesis queue ---

  /**
   * Internal processor: dequeues and speaks one item at a time.
   * The lock (isSpeechProcessingRef) prevents concurrent invocations.
   */
  const processSpeechQueue = useCallback(async () => {
    if (isSpeechProcessingRef.current) return;
    isSpeechProcessingRef.current = true;
    const generation = speechGenerationRef.current;
    setIsSpeaking(true);
    setSpeechStatus("speaking");

    while (
      speechQueueRef.current.length > 0 &&
      generation === speechGenerationRef.current
    ) {
      const item = speechQueueRef.current.shift()!;
      currentSpeechItemRef.current = item;
      const speechChunks = splitSpeechText(item.text);

      for (const speechChunk of speechChunks) {
        if (generation !== speechGenerationRef.current) {
          break;
        }

        await new Promise<void>((innerResolve) => {
          const utterance = new SpeechSynthesisUtterance(speechChunk);
          let timeoutId: ReturnType<typeof setTimeout> | null = null;

          const finishUtterance = () => {
            if (timeoutId) {
              clearTimeout(timeoutId);
              timeoutId = null;
            }
            if (currentUtteranceRef.current === utterance) {
              currentUtteranceRef.current = null;
            }
            innerResolve();
          };

          utterance.lang = "es-ES";
          utterance.rate = 1.0;
          utterance.pitch = 1.0;

          utterance.onend = finishUtterance;
          utterance.onerror = (event) => {
            if (
              generation !== speechGenerationRef.current ||
              isIntentionalSpeechError(event)
            ) {
              finishUtterance();
              return;
            }

            setSpeechStatus("error");
            setAudioError(SPEECH_PLAYBACK_ERROR_MESSAGE);
            finishUtterance();
          };

          const voices = window.speechSynthesis.getVoices();
          const spanish = voices.find(
            (v) => v.lang.startsWith("es") || v.lang.includes("Spanish")
          );
          if (spanish) utterance.voice = spanish;

          currentUtteranceRef.current = utterance;
          timeoutId = setTimeout(() => {
            if (generation === speechGenerationRef.current) {
              window.speechSynthesis.cancel();
            }
            finishUtterance();
          }, getSpeechChunkTimeoutMs(speechChunk, item.timeoutMs));
          window.speechSynthesis.speak(utterance);
        });
      }

      resolveSpeechItem(item);

      if (currentSpeechItemRef.current === item) {
        currentSpeechItemRef.current = null;
      }
    }

    if (generation === speechGenerationRef.current) {
      isSpeechProcessingRef.current = false;
      setIsSpeaking(false);
      setSpeechStatus("idle");
    }
  }, [setAudioError]);

  /**
   * Speak text sequentially.
   * If the queue is already running, the new text is appended and will play
   * after the current utterance finishes — no overlap, no cancellation.
   * Returns a promise that resolves when this specific text has been spoken.
   */
  const speakText = useCallback(
    async (text: string, options: SpeakTextOptions = {}): Promise<void> => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        setSpeechStatus("unsupported");
        setAudioError("Web Speech API no disponible en este navegador");
        return;
      }
      return new Promise<void>((resolve) => {
        sendDebugEvent({
          type: "audio.speech_enqueued",
          source: "useAudio",
          message: "Speech synthesis queued",
          payload: { text },
        });
        speechQueueRef.current.push({
          text,
          resolve,
          timeoutMs: options.timeoutMs ?? DEFAULT_SPEECH_TIMEOUT_MS,
        });
        setSpeechStatus(isSpeechProcessingRef.current ? "speaking" : "queued");
        processSpeechQueue();
      });
    },
    [processSpeechQueue, setAudioError]
  );

  /**
   * Immediately stop all pending and in-progress speech.
   * Resolves all queued promises so callers do not hang.
   * Use this before cancelling an analysis or when the user requests stop.
   */
  const cancelSpeech = useCallback(() => {
    speechGenerationRef.current += 1;
    sendDebugEvent({
      type: "audio.speech_cancelled",
      source: "useAudio",
      message: "Speech synthesis cancelled",
    });

    // Resolve and discard all pending items
    const pending = speechQueueRef.current.splice(0);
    pending.forEach((item) => resolveSpeechItem(item));
    resolveSpeechItem(currentSpeechItemRef.current);
    currentSpeechItemRef.current = null;

    // Stop whatever is currently being spoken
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    currentUtteranceRef.current = null;
    isSpeechProcessingRef.current = false;
    setIsSpeaking(false);
    setSpeechStatus("cancelled");
  }, []);

  const stopAllAudio = useCallback(
    (_reason?: string) => {
      sendDebugEvent({
        type: "audio.stop_all",
        source: "useAudio",
        message: "All audio activity stopped",
        payload: { reason: _reason },
      });
      audioGenerationRef.current += 1;
      recognitionGenerationRef.current += 1;
      stopBackgroundRecognition();
      cleanupInput();
      clearSilenceTimer();
      cancelSpeech();

      if (
        playbackContextRef.current &&
        playbackContextRef.current.state !== "closed"
      ) {
        void playbackContextRef.current.close();
      }
      playbackContextRef.current = null;
      playbackQueueRef.current = [];
      isPlayingRef.current = false;
      onAudioChunkRef.current = null;
      recognitionRef.current = null;
      recognitionModeRef.current = null;
      isRecognitionStartingRef.current = false;
      isRecognitionPausedRef.current = false;
      isBackgroundListeningRef.current = false;
      isVoiceActiveRef.current = false;
      setIsBackgroundListening(false);
      setIsManualListening(false);
      setIsVoiceActive(false);
      setIsVoiceProcessing(false);
      setRecognitionStatus("idle");
      setInputStatus("idle");
      setAudioLevel(0);
    },
    [cancelSpeech, cleanupInput, clearSilenceTimer, stopBackgroundRecognition],
  );

  // --- Cleanup ---

  useEffect(() => {
    return () => {
      stopAllAudio("unmount");
    };
  }, [stopAllAudio]);

  return {
    isListening,
    isSpeaking,
    error,
    permissionGranted,
    permissionStatus,
    hasKnownMicrophoneAccess:
      hasKnownMicrophoneAccessRef.current || permissionStatus === "granted",
    audioLevel,
    inputStatus,
    recognitionStatus,
    speechStatus,
    lastAudioError,
    transcript,
    isRecognitionSupported,
    isManualListening,
    isBackgroundListening,
    isVoiceActive,
    isVoiceProcessing,
    startListening,
    stopListening,
    startManualRecognition,
    stopManualRecognition,
    startBackgroundRecognition,
    stopBackgroundRecognition,
    pauseRecognition,
    resumeRecognition,
    resetRecognition,
    stopAllAudio,
    playAudioChunk,
    speakText,
    cancelSpeech,
  };
}
