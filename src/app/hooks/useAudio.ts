import { useState, useRef, useCallback, useEffect } from "react";

type AudioOptions = {
  sendSampleRate?: number;
  receiveSampleRate?: number;
  chunkSize?: number;
  enableEchoCancellation?: boolean;
};

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
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const playbackQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef(false);

  // Callback para enviar chunks de audio a Gemini
  const onAudioChunkRef = useRef<((chunkBase64: string) => void) | null>(null);

  const startListening = useCallback(
    async (onAudioChunk?: (chunkBase64: string) => void) => {
      try {
        setError(null);
        onAudioChunkRef.current = onAudioChunk || null;

        // Crear AudioContext
        audioContextRef.current = new AudioContext({
          sampleRate: sendSampleRate,
        });

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
        const source = audioContextRef.current.createMediaStreamSource(stream);

        // Crear analyser para visualización de nivel de audio
        const analyser = audioContextRef.current.createAnalyser();
        analyser.fftSize = 256;
        analyserRef.current = analyser;
        source.connect(analyser);

        // Crear script processor para capturar audio
        const processor = audioContextRef.current.createScriptProcessor(
          chunkSize,
          1,
          1
        );
        processorRef.current = processor;

        processor.onaudioprocess = (event) => {
          const inputData = event.inputBuffer.getChannelData(0);
          
          // Calcular nivel de audio para visualización
          const rms = Math.sqrt(
            Array.from(inputData).reduce((sum, val) => sum + val * val, 0) /
              inputData.length
          );
          setAudioLevel(Math.min(rms * 5, 1)); // Normalizar a 0-1

          // Convertir Float32 a Int16 PCM
          const int16Data = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }

          // Convertir a base64
          const base64 = btoa(
            Array.from(new Uint8Array(int16Data.buffer))
              .map((byte) => String.fromCharCode(byte))
              .join("")
          );

          // Enviar chunk si hay callback registrado
          if (onAudioChunkRef.current) {
            onAudioChunkRef.current(base64);
          }
        };

        source.connect(processor);
        processor.connect(audioContextRef.current.destination);

        setIsListening(true);
        setPermissionGranted(true);
      } catch (err: any) {
        const errorMsg =
          err.name === "NotAllowedError"
            ? "Permiso de micrófono denegado. Habilita el acceso en la configuración del navegador."
            : `Error al acceder al micrófono: ${err.message}`;
        
        setError(errorMsg);
        setIsListening(false);
      }
    },
    [sendSampleRate, chunkSize, enableEchoCancellation]
  );

  const stopListening = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setIsListening(false);
    setAudioLevel(0);
  }, []);

  const playAudioChunk = useCallback(async (chunkBase64: string) => {
    try {
      // Decodificar base64 a ArrayBuffer
      const binaryString = atob(chunkBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Convertir Int16 PCM a Float32
      const int16Array = new Int16Array(bytes.buffer);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / (int16Array[i] < 0 ? 0x8000 : 0x7fff);
      }

      // Crear AudioBuffer
      const audioContext = new AudioContext({ sampleRate: receiveSampleRate });
      const audioBuffer = audioContext.createBuffer(1, float32Array.length, receiveSampleRate);
      audioBuffer.getChannelData(0).set(float32Array);

      // Agregar a cola de reproducción
      playbackQueueRef.current.push(audioBuffer);

      // Si no está reproduciendo, iniciar reproducción
      if (!isPlayingRef.current) {
        isPlayingRef.current = true;
        setIsSpeaking(true);
        await processPlaybackQueue(audioContext);
      }
    } catch (err: any) {
      setError(`Error al reproducir audio: ${err.message}`);
    }
  }, [receiveSampleRate]);

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
    await audioContext.close();
  }, []);

  const playAudioFromBase64 = useCallback(
    async (audioBase64: string, mimeType: string = "audio/wav") => {
      try {
        setIsSpeaking(true);
        setError(null);

        // Decodificar base64
        const response = await fetch(
          `data:${mimeType};base64,${audioBase64}`
        );
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

  const speakText = useCallback(async (text: string) => {
    try {
      setIsSpeaking(true);

      // Usar Web Speech API para texto a voz
      if ("speechSynthesis" in window) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "es-ES";
        utterance.rate = 1.0;
        utterance.pitch = 1.0;

        // Intentar encontrar una voz en español
        const voices = window.speechSynthesis.getVoices();
        const spanishVoice = voices.find(
          (voice) =>
            voice.lang.startsWith("es") || voice.lang.includes("Spanish")
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

  const requestMicrophonePermission = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      stream.getTracks().forEach((track) => track.stop());
      setPermissionGranted(true);
      return true;
    } catch {
      setPermissionGranted(false);
      return false;
    }
  }, []);

  // Cleanup al desmontar
  useEffect(() => {
    return () => {
      stopListening();
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
