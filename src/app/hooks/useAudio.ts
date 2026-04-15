import { useState, useRef, useCallback, useEffect } from "react";

type AudioOptions = {
  sendSampleRate?: number;
  receiveSampleRate?: number;
  chunkSize?: number;
  enableEchoCancellation?: boolean;
  workletUrl?: string; // URL al worklet compilado (opcional)
};

// Función auxiliar: Int16Array → Base64
const int16ToBase64 = (int16Array: Int16Array): string => {
  const uint8Array = new Uint8Array(int16Array.buffer);
  let binary = '';
  const chunkSize = 0x8000; // Evitar stack overflow en strings grandes
  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    const chunk = uint8Array.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

// Código inline del worklet para fallback (desarrollo)
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

  // Cleanup de blob URLs del worklet
  const cleanupWorkletUrl = useCallback(() => {
    if (workletBlobUrlRef.current) {
      URL.revokeObjectURL(workletBlobUrlRef.current);
      workletBlobUrlRef.current = null;
    }
  }, []);

  const loadWorkletModule = useCallback(async (context: AudioContext): Promise<string> => {
    try {
      // En producción, el worklet se emite a assets/worklets/
      // En desarrollo, Vite sirve desde src/
      const isDev = import.meta.env.DEV;
      
      let workletSrc: string;
      
      if (isDev) {
        // Desarrollo: importar directamente y crear blob
        const workletModule = await import('./audio-processor.worklet.ts?worker&url');
        workletSrc = workletModule.default;
      } else {
        // Producción: usar ruta relativa a dist/assets/worklets/
        // Vite inyectará el hash correcto en build
        workletSrc = new URL(
          './audio-processor.worklet.ts?worker&url', 
          import.meta.url
        ).href;
      }
      
      await context.audioWorklet.addModule(workletSrc);
      return 'audio-processor';
      
    } catch (error) {
      console.warn('Error cargando worklet externo, usando fallback inline:', error);
      
      // Fallback inline si falla la carga externa
      const blob = new Blob([getInlineWorkletCode(chunkSize)], { 
        type: 'application/javascript' 
      });
      const blobUrl = URL.createObjectURL(blob);
      workletBlobUrlRef.current = blobUrl;
      
      await context.audioWorklet.addModule(blobUrl);
      return 'audio-processor';
    }
  }, [chunkSize]);

  const startListening = useCallback(
    async (onAudioChunk?: (chunkBase64: string) => void) => {
      try {
        setError(null);
        onAudioChunkRef.current = onAudioChunk || null;

        // Crear AudioContext
        const audioContext = new AudioContext({ sampleRate: sendSampleRate });
        audioContextRef.current = audioContext;

        // Obtener acceso al micrófono
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: enableEchoCancellation,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: sendSampleRate,
          },
        });
        streamRef.current = stream;

        // Crear source node
        const source = audioContext.createMediaStreamSource(stream);

        // Analyser para visualización
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyserRef.current = analyser;
        source.connect(analyser);

        // Cargar y configurar AudioWorklet
        await loadWorkletModule(audioContext);
        
        const workletNode = new AudioWorkletNode(
          audioContext,
          'audio-processor',
          {
            processorOptions: { chunkSize },
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1],
          }
        );
        audioWorkletNodeRef.current = workletNode;

        // Manejar mensajes del worklet
        workletNode.port.onmessage = (event: MessageEvent) => {
          const { type, pcmData, audioLevel: level } = event.data;
          if (type === 'audio-chunk') {
            setAudioLevel(level);
            if (onAudioChunkRef.current && pcmData) {
              const int16Array = new Int16Array(pcmData);
              const base64 = int16ToBase64(int16Array);
              onAudioChunkRef.current(base64);
            }
          }
        };

        // Conectar: source → [analyser, worklet] → destination
        source.connect(workletNode);
        workletNode.connect(audioContext.destination);

        setIsListening(true);
        setPermissionGranted(true);
      } catch (err: any) {
        const errorMsg =
          err.name === "NotAllowedError"
            ? "Permiso de micrófono denegado. Habilita el acceso en la configuración del navegador."
            : `Error al acceder al micrófono: ${err.message}`;
        
        setError(errorMsg);
        setIsListening(false);
        cleanupWorkletUrl();
        
        // Cleanup parcial en caso de error
        if (audioContextRef.current) {
          audioContextRef.current.close();
          audioContextRef.current = null;
        }
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }
      }
    },
    [sendSampleRate, chunkSize, enableEchoCancellation, loadWorkletModule, cleanupWorkletUrl]
  );

  const stopListening = useCallback(() => {
    // Detener worklet
    if (audioWorkletNodeRef.current) {
      audioWorkletNodeRef.current.port.postMessage({ type: 'stop' });
      audioWorkletNodeRef.current.disconnect();
      audioWorkletNodeRef.current = null;
    }

    // Detener stream de micrófono
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    // Cerrar AudioContext
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // Limpiar blob URL
    cleanupWorkletUrl();

    // Resetear estados
    setIsListening(false);
    setAudioLevel(0);
  }, [cleanupWorkletUrl]);

  // Reproducir chunk de audio PCM en base64
  const playAudioChunk = useCallback(async (chunkBase64: string) => {
    try {
      // Decodificar base64 a ArrayBuffer
      const binaryString = atob(chunkBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Convertir Int16 PCM a Float32 [-1, 1]
      const int16Array = new Int16Array(bytes.buffer);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / (int16Array[i] < 0 ? 0x8000 : 0x7fff);
      }

      // Crear/reutilizar AudioContext para playback
      if (!playbackContextRef.current || playbackContextRef.current.state === 'closed') {
        playbackContextRef.current = new AudioContext({ sampleRate: receiveSampleRate });
      }
      const audioContext = playbackContextRef.current;

      // Crear AudioBuffer
      const audioBuffer = audioContext.createBuffer(
        1, 
        float32Array.length, 
        receiveSampleRate
      );
      audioBuffer.getChannelData(0).set(float32Array);

      // Agregar a cola de reproducción
      playbackQueueRef.current.push(audioBuffer);

      // Iniciar reproducción si no está activo
      if (!isPlayingRef.current) {
        isPlayingRef.current = true;
        setIsSpeaking(true);
        await processPlaybackQueue(audioContext);
      }
    } catch (err: any) {
      setError(`Error al reproducir audio: ${err.message}`);
      setIsSpeaking(false);
      isPlayingRef.current = false;
    }
  }, [receiveSampleRate]);

  // Procesar cola de reproducción (función interna)
  const processPlaybackQueue = useCallback(async (audioContext: AudioContext) => {
    while (playbackQueueRef.current.length > 0) {
      const buffer = playbackQueueRef.current.shift();
      if (!buffer) continue;

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
    
    // No cerramos el contexto aquí para permitir reutilización
    // Se cerrará en cleanup o cuando se desmonte el componente
  }, []);

  // Reproducir audio completo desde base64 (WAV/MP3/etc)
  const playAudioFromBase64 = useCallback(
    async (audioBase64: string, mimeType: string = "audio/wav") => {
      try {
        setIsSpeaking(true);
        setError(null);

        // Decodificar base64 via fetch
        const response = await fetch(`data:${mimeType};base64,${audioBase64}`);
        const arrayBuffer = await response.arrayBuffer();

        // Crear AudioContext y decodificar
        const audioContext = new AudioContext();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        // Reproducir
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContext.destination);

        await new Promise<void>((resolve) => {
          source.onended = () => {
            audioContext.close();
            resolve();
          };
          source.start();
        });
      } catch (err: any) {
        setError(`Error al reproducir audio: ${err.message}`);
      } finally {
        setIsSpeaking(false);
      }
    },
    []
  );

  // Text-to-Speech con Web Speech API
  const speakText = useCallback(async (text: string) => {
    try {
      setIsSpeaking(true);

      if ("speechSynthesis" in window) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "es-ES";
        utterance.rate = 1.0;
        utterance.pitch = 1.0;

        // Cargar voces y buscar español
        await new Promise<void>((resolve) => {
          if (window.speechSynthesis.onvoiceschanged !== undefined) {
            window.speechSynthesis.onvoiceschanged = () => resolve();
          }
          resolve();
        });

        const voices = window.speechSynthesis.getVoices();
        const spanishVoice = voices.find(
          (voice) => voice.lang.startsWith("es") || voice.lang.includes("Spanish")
        );
        if (spanishVoice) {
          utterance.voice = spanishVoice;
        }

        await new Promise<void>((resolve) => {
          utterance.onend = () => resolve();
          utterance.onerror = () => resolve();
          window.speechSynthesis.speak(utterance);
        });
      } else {
        setError("Web Speech API no disponible en este navegador");
      }
    } catch (err: any) {
      setError(`Error al hablar: ${err.message}`);
    } finally {
      setIsSpeaking(false);
    }
  }, []);

  // Solicitar permiso de micrófono (sin iniciar captura)
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

  // Cleanup al desmontar componente
  useEffect(() => {
    return () => {
      stopListening();
      
      // Cleanup adicional de playback
      if (playbackContextRef.current && playbackContextRef.current.state !== 'closed') {
        playbackContextRef.current.close();
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
