import { useState, useRef, useCallback, useEffect } from "react";

type AudioOptions = {
  sendSampleRate?: number;
  receiveSampleRate?: number;
  chunkSize?: number;
  enableEchoCancellation?: boolean;
};

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
  resolved?: boolean;
};

const MICROPHONE_PERMISSION_CACHE_KEY = "visiont:microphone-permission";
const MICROPHONE_RECOVERY_MESSAGE =
  "El navegador no permitio abrir el microfono aunque ya estaba autorizado. Revisa ajustes o intenta recargar.";

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

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
  const workletBlobUrlRef = useRef<string | null>(null);
  const onAudioChunkRef = useRef<((chunkBase64: string) => void) | null>(null);
  const isListeningRef = useRef(false);
  const isStartingRef = useRef(false);
  const hasKnownMicrophoneAccessRef = useRef(
    Boolean(readMicrophonePermissionCache()),
  );

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

  useEffect(() => {
    let isMounted = true;

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

  const cleanupInput = useCallback(() => {
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
    setIsListening(false);
    setAudioLevel(0);
  }, [cleanupWorkletUrl]);

  const startListening = useCallback(
    async (onAudioChunk?: (chunkBase64: string) => void): Promise<boolean> => {
      if (isListeningRef.current || isStartingRef.current) {
        return true;
      }

      try {
        if (
          typeof navigator === "undefined" ||
          !navigator.mediaDevices?.getUserMedia
        ) {
          setPermissionStatus("unavailable");
          setPermissionGranted(false);
          setError("Este navegador no permite abrir el microfono.");
          return false;
        }

        isStartingRef.current = true;
        setError(null);
        onAudioChunkRef.current = onAudioChunk ?? null;

        const browserPermissionStatus = await queryMicrophonePermission();
        if (browserPermissionStatus !== "unknown") {
          setPermissionStatus(browserPermissionStatus);
        }

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
          }
        );
        audioWorkletNodeRef.current = workletNode;

        workletNode.port.onmessage = (event: MessageEvent) => {
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

        isListeningRef.current = true;
        isStartingRef.current = false;
        hasKnownMicrophoneAccessRef.current = true;
        writeMicrophonePermissionGranted();
        setIsListening(true);
        setPermissionGranted(true);
        setPermissionStatus("granted");
        return true;
      } catch (err: any) {
        const hadKnownAccess =
          hasKnownMicrophoneAccessRef.current ||
          permissionStatus === "granted" ||
          Boolean(readMicrophonePermissionCache());
        const msg =
          err.name === "NotAllowedError"
            ? hadKnownAccess
              ? MICROPHONE_RECOVERY_MESSAGE
              : "Permiso de microfono denegado. Habilita el acceso en la configuracion del navegador."
            : `Error al acceder al microfono: ${err.message}`;
        setError(msg);
        setPermissionGranted(false);
        setPermissionStatus(
          err.name === "NotAllowedError" ? "denied" : "unknown",
        );
        cleanupInput();
        return false;
      }
    },
    [
      sendSampleRate,
      chunkSize,
      enableEchoCancellation,
      loadWorkletModule,
      cleanupInput,
      permissionStatus,
    ]
  );

  const stopListening = useCallback(() => {
    cleanupInput();
  }, [cleanupInput]);

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
          await processPlaybackQueue(ctx);
        }
      } catch (err: any) {
        setError(`Error al reproducir audio: ${err.message}`);
        setIsSpeaking(false);
        isPlayingRef.current = false;
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

    while (
      speechQueueRef.current.length > 0 &&
      generation === speechGenerationRef.current
    ) {
      const item = speechQueueRef.current.shift()!;
      currentSpeechItemRef.current = item;

      await new Promise<void>((innerResolve) => {
        const utterance = new SpeechSynthesisUtterance(item.text);
        utterance.lang = "es-ES";
        utterance.rate = 1.0;
        utterance.pitch = 1.0;

        // Resolve the caller's outer promise when this utterance finishes
        utterance.onend = () => {
          if (currentUtteranceRef.current === utterance) {
            currentUtteranceRef.current = null;
          }
          resolveSpeechItem(item);
          innerResolve();
        };
        utterance.onerror = () => {
          if (currentUtteranceRef.current === utterance) {
            currentUtteranceRef.current = null;
          }
          resolveSpeechItem(item);
          innerResolve();
        };

        // Voice selection deferred to speak time so voices are loaded
        const voices = window.speechSynthesis.getVoices();
        const spanish = voices.find(
          (v) => v.lang.startsWith("es") || v.lang.includes("Spanish")
        );
        if (spanish) utterance.voice = spanish;

        currentUtteranceRef.current = utterance;
        window.speechSynthesis.speak(utterance);
      });

      if (currentSpeechItemRef.current === item) {
        currentSpeechItemRef.current = null;
      }
    }

    if (generation === speechGenerationRef.current) {
      isSpeechProcessingRef.current = false;
      setIsSpeaking(false);
    }
  }, []);

  /**
   * Speak text sequentially.
   * If the queue is already running, the new text is appended and will play
   * after the current utterance finishes — no overlap, no cancellation.
   * Returns a promise that resolves when this specific text has been spoken.
   */
  const speakText = useCallback(
    async (text: string): Promise<void> => {
      if (!("speechSynthesis" in window)) {
        setError("Web Speech API no disponible en este navegador");
        return;
      }
      return new Promise<void>((resolve) => {
        speechQueueRef.current.push({ text, resolve });
        processSpeechQueue();
      });
    },
    [processSpeechQueue]
  );

  /**
   * Immediately stop all pending and in-progress speech.
   * Resolves all queued promises so callers do not hang.
   * Use this before cancelling an analysis or when the user requests stop.
   */
  const cancelSpeech = useCallback(() => {
    speechGenerationRef.current += 1;

    // Resolve and discard all pending items
    const pending = speechQueueRef.current.splice(0);
    pending.forEach((item) => resolveSpeechItem(item));
    resolveSpeechItem(currentSpeechItemRef.current);
    currentSpeechItemRef.current = null;

    // Stop whatever is currently being spoken
    window.speechSynthesis.cancel();
    currentUtteranceRef.current = null;
    isSpeechProcessingRef.current = false;
    setIsSpeaking(false);
  }, []);

  // --- Cleanup ---

  useEffect(() => {
    return () => {
      stopListening();
      cancelSpeech();
      if (
        playbackContextRef.current &&
        playbackContextRef.current.state !== "closed"
      ) {
        playbackContextRef.current.close();
        playbackContextRef.current = null;
      }
      playbackQueueRef.current = [];
      isPlayingRef.current = false;
    };
  }, [stopListening, cancelSpeech]);

  return {
    isListening,
    isSpeaking,
    error,
    permissionGranted,
    permissionStatus,
    hasKnownMicrophoneAccess:
      hasKnownMicrophoneAccessRef.current || permissionStatus === "granted",
    audioLevel,
    startListening,
    stopListening,
    playAudioChunk,
    speakText,
    cancelSpeech,
  };
}
