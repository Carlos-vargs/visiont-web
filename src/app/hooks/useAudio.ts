import { useState, useRef, useCallback, useEffect } from "react";

type AudioOptions = {
  sendSampleRate?: number;
  receiveSampleRate?: number;
  chunkSize?: number;
  enableEchoCancellation?: boolean;
};

type SpeechQueueItem = {
  text: string;
  resolve: () => void;
};

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
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
  const workletBlobUrlRef = useRef<string | null>(null);
  const onAudioChunkRef = useRef<((chunkBase64: string) => void) | null>(null);

  // Playback
  const playbackContextRef = useRef<AudioContext | null>(null);
  const playbackQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef(false);

  // Speech synthesis queue — ensures utterances play sequentially with no overlap
  const speechQueueRef = useRef<SpeechQueueItem[]>([]);
  const isSpeechProcessingRef = useRef(false);
  // Tracks the utterance currently being spoken so cancelSpeech can abort it
  const currentUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

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

  const startListening = useCallback(
    async (onAudioChunk?: (chunkBase64: string) => void) => {
      try {
        setError(null);
        onAudioChunkRef.current = onAudioChunk ?? null;

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

        setIsListening(true);
        setPermissionGranted(true);
      } catch (err: any) {
        const msg =
          err.name === "NotAllowedError"
            ? "Permiso de microfono denegado. Habilita el acceso en la configuracion del navegador."
            : `Error al acceder al microfono: ${err.message}`;
        setError(msg);
        setIsListening(false);
        cleanupWorkletUrl();
        audioContextRef.current?.close();
        audioContextRef.current = null;
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    },
    [sendSampleRate, chunkSize, enableEchoCancellation, loadWorkletModule, cleanupWorkletUrl]
  );

  const stopListening = useCallback(() => {
    if (audioWorkletNodeRef.current) {
      audioWorkletNodeRef.current.port.postMessage({ type: "stop" });
      audioWorkletNodeRef.current.disconnect();
      audioWorkletNodeRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioContextRef.current?.close();
    audioContextRef.current = null;
    cleanupWorkletUrl();
    setIsListening(false);
    setAudioLevel(0);
  }, [cleanupWorkletUrl]);

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
    setIsSpeaking(true);

    while (speechQueueRef.current.length > 0) {
      const item = speechQueueRef.current.shift()!;

      await new Promise<void>((innerResolve) => {
        const utterance = new SpeechSynthesisUtterance(item.text);
        utterance.lang = "es-ES";
        utterance.rate = 1.0;
        utterance.pitch = 1.0;

        // Resolve the caller's outer promise when this utterance finishes
        utterance.onend = () => {
          currentUtteranceRef.current = null;
          item.resolve();
          innerResolve();
        };
        utterance.onerror = () => {
          currentUtteranceRef.current = null;
          item.resolve();
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
    }

    isSpeechProcessingRef.current = false;
    setIsSpeaking(false);
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
    // Resolve and discard all pending items
    const pending = speechQueueRef.current.splice(0);
    pending.forEach((item) => item.resolve());

    // Stop whatever is currently being spoken
    window.speechSynthesis.cancel();
    currentUtteranceRef.current = null;
    isSpeechProcessingRef.current = false;
    setIsSpeaking(false);
  }, []);

  // --- Permission helper ---

  const requestMicrophonePermission = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setPermissionGranted(true);
      return true;
    } catch {
      setPermissionGranted(false);
      return false;
    }
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
    audioLevel,
    startListening,
    stopListening,
    playAudioChunk,
    speakText,
    cancelSpeech,
    requestMicrophonePermission,
  };
}