import { useState, useRef, useCallback, useEffect } from "react";

type AudioOptions = {
  sendSampleRate?: number;
  receiveSampleRate?: number;
  chunkSize?: number;
  enableEchoCancellation?: boolean;
  workletUrl?: string;
};

const int16ToBase64 = (int16Array: Int16Array): string => {
  const uint8Array = new Uint8Array(int16Array.buffer);
  let binary = "";
  const maxChunkSize = 0x8000;

  for (let index = 0; index < uint8Array.length; index += maxChunkSize) {
    const chunk = uint8Array.subarray(index, index + maxChunkSize);
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
      this.port.onmessage = (event) => {
        if (event.data?.type === "stop") {
          this.bufferIndex = 0;
          this.buffer.fill(0);
        }
      };
    }

    process(inputs) {
      const input = inputs[0];
      if (input?.[0]) {
        const inputData = input[0];

        for (let index = 0; index < inputData.length; index += 1) {
          this.buffer[this.bufferIndex++] = inputData[index];

          if (this.bufferIndex >= this.chunkSize) {
            const int16Data = new Int16Array(this.chunkSize);

            for (let position = 0; position < this.chunkSize; position += 1) {
              const sample = Math.max(-1, Math.min(1, this.buffer[position]));
              int16Data[position] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
            }

            const rms = Math.sqrt(
              this.buffer.reduce((sum, value) => sum + value * value, 0) / this.chunkSize
            );

            this.port.postMessage(
              {
                type: "audio-chunk",
                pcmData: int16Data.buffer,
                audioLevel: Math.min(rms * 5, 1),
              },
              [int16Data.buffer]
            );

            this.bufferIndex = 0;
          }
        }
      }

      return true;
    }
  }

  registerProcessor("audio-processor", AudioProcessor);
`;

export function useAudio(options: AudioOptions = {}) {
  const {
    sendSampleRate = 16000,
    receiveSampleRate = 24000,
    chunkSize = 1024,
    enableEchoCancellation = false,
  } = options;

  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const playbackQueueRef = useRef<AudioBuffer[]>([]);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const isPlayingRef = useRef(false);
  const workletBlobUrlRef = useRef<string | null>(null);
  const onAudioChunkRef = useRef<((chunkBase64: string) => void) | null>(null);

  const cleanupWorkletUrl = useCallback(() => {
    if (workletBlobUrlRef.current) {
      URL.revokeObjectURL(workletBlobUrlRef.current);
      workletBlobUrlRef.current = null;
    }
  }, []);

  const loadWorkletModule = useCallback(
    async (context: AudioContext): Promise<string> => {
      try {
        const isDev = import.meta.env.DEV;
        let workletSource: string;

        if (isDev) {
          const workletModule = await import("./audio-processor.worklet.ts?worker&url");
          workletSource = workletModule.default;
        } else {
          workletSource = new URL(
            "./audio-processor.worklet.ts?worker&url",
            import.meta.url,
          ).href;
        }

        await context.audioWorklet.addModule(workletSource);
        return "audio-processor";
      } catch (workletError) {
        console.warn(
          "Error cargando worklet externo, usando fallback inline:",
          workletError,
        );

        const blob = new Blob([getInlineWorkletCode(chunkSize)], {
          type: "application/javascript",
        });
        const blobUrl = URL.createObjectURL(blob);
        workletBlobUrlRef.current = blobUrl;

        await context.audioWorklet.addModule(blobUrl);
        return "audio-processor";
      }
    },
    [chunkSize],
  );

  const stopListening = useCallback(() => {
    if (audioWorkletNodeRef.current) {
      audioWorkletNodeRef.current.port.postMessage({ type: "stop" });
      audioWorkletNodeRef.current.disconnect();
      audioWorkletNodeRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }

    cleanupWorkletUrl();
    setIsListening(false);
    setAudioLevel(0);
  }, [cleanupWorkletUrl]);

  const startListening = useCallback(
    async (onAudioChunk?: (chunkBase64: string) => void) => {
      try {
        setError(null);
        onAudioChunkRef.current = onAudioChunk || null;

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
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyserRef.current = analyser;
        source.connect(analyser);

        await loadWorkletModule(audioContext);

        const workletNode = new AudioWorkletNode(audioContext, "audio-processor", {
          processorOptions: { chunkSize },
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        audioWorkletNodeRef.current = workletNode;

        workletNode.port.onmessage = (event: MessageEvent) => {
          const { type, pcmData, audioLevel: level } = event.data;

          if (type !== "audio-chunk") {
            return;
          }

          setAudioLevel(level);

          if (onAudioChunkRef.current && pcmData) {
            const int16Array = new Int16Array(pcmData);
            onAudioChunkRef.current(int16ToBase64(int16Array));
          }
        };

        source.connect(workletNode);
        workletNode.connect(audioContext.destination);

        setIsListening(true);
        setPermissionGranted(true);
      } catch (err: any) {
        const message =
          err?.name === "NotAllowedError"
            ? "Permiso de microfono denegado. Habilita el acceso en la configuracion del navegador."
            : `Error al acceder al microfono: ${err?.message || "desconocido"}`;

        setError(message);
        setIsListening(false);
        cleanupWorkletUrl();

        if (audioContextRef.current) {
          void audioContextRef.current.close();
          audioContextRef.current = null;
        }

        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }
      }
    },
    [
      chunkSize,
      cleanupWorkletUrl,
      enableEchoCancellation,
      loadWorkletModule,
      sendSampleRate,
    ],
  );

  const processPlaybackQueue = useCallback(async (audioContext: AudioContext) => {
    while (playbackQueueRef.current.length > 0) {
      const buffer = playbackQueueRef.current.shift();
      if (!buffer) {
        continue;
      }

      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);

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
        const binaryString = atob(chunkBase64);
        const bytes = new Uint8Array(binaryString.length);

        for (let index = 0; index < binaryString.length; index += 1) {
          bytes[index] = binaryString.charCodeAt(index);
        }

        const int16Array = new Int16Array(bytes.buffer);
        const float32Array = new Float32Array(int16Array.length);

        for (let index = 0; index < int16Array.length; index += 1) {
          const sample = int16Array[index];
          float32Array[index] = sample / (sample < 0 ? 0x8000 : 0x7fff);
        }

        if (
          !playbackContextRef.current ||
          playbackContextRef.current.state === "closed"
        ) {
          playbackContextRef.current = new AudioContext({
            sampleRate: receiveSampleRate,
          });
        }

        const audioContext = playbackContextRef.current;
        const audioBuffer = audioContext.createBuffer(
          1,
          float32Array.length,
          receiveSampleRate,
        );
        audioBuffer.getChannelData(0).set(float32Array);
        playbackQueueRef.current.push(audioBuffer);

        if (!isPlayingRef.current) {
          isPlayingRef.current = true;
          setIsSpeaking(true);
          await processPlaybackQueue(audioContext);
        }
      } catch (err: any) {
        setError(`Error al reproducir audio: ${err?.message || "desconocido"}`);
        setIsSpeaking(false);
        isPlayingRef.current = false;
      }
    },
    [processPlaybackQueue, receiveSampleRate],
  );

  const playAudioFromBase64 = useCallback(
    async (audioBase64: string, mimeType = "audio/wav") => {
      try {
        setIsSpeaking(true);
        setError(null);

        const response = await fetch(`data:${mimeType};base64,${audioBase64}`);
        const arrayBuffer = await response.arrayBuffer();
        const audioContext = new AudioContext();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContext.destination);

        await new Promise<void>((resolve) => {
          source.onended = () => {
            void audioContext.close();
            resolve();
          };
          source.start();
        });
      } catch (err: any) {
        setError(`Error al reproducir audio: ${err?.message || "desconocido"}`);
      } finally {
        setIsSpeaking(false);
      }
    },
    [],
  );

  const speakText = useCallback(async (text: string) => {
    try {
      setIsSpeaking(true);

      if (!("speechSynthesis" in window)) {
        setError("Web Speech API no disponible en este navegador");
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "es-ES";
      utterance.rate = 1;
      utterance.pitch = 1;

      await new Promise<void>((resolve) => {
        if (window.speechSynthesis.onvoiceschanged !== undefined) {
          window.speechSynthesis.onvoiceschanged = () => resolve();
        }
        resolve();
      });

      const voices = window.speechSynthesis.getVoices();
      const spanishVoice = voices.find(
        (voice) => voice.lang.startsWith("es") || voice.lang.includes("Spanish"),
      );

      if (spanishVoice) {
        utterance.voice = spanishVoice;
      }

      await new Promise<void>((resolve) => {
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        window.speechSynthesis.speak(utterance);
      });
    } catch (err: any) {
      setError(`Error al hablar: ${err?.message || "desconocido"}`);
    } finally {
      setIsSpeaking(false);
    }
  }, []);

  const requestMicrophonePermission = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setPermissionGranted(true);
      return true;
    } catch {
      setPermissionGranted(false);
      return false;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopListening();

      if (
        playbackContextRef.current &&
        playbackContextRef.current.state !== "closed"
      ) {
        void playbackContextRef.current.close();
        playbackContextRef.current = null;
      }

      playbackQueueRef.current = [];
      isPlayingRef.current = false;
    };
  }, [stopListening]);

  return {
    isListening,
    isSpeaking,
    error,
    permissionGranted,
    audioLevel,
    startListening,
    stopListening,
    playAudioChunk,
    playAudioFromBase64,
    speakText,
    requestMicrophonePermission,
  };
}
