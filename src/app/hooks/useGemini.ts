import { useState, useCallback, useRef, useEffect } from "react";
import { GoogleGenAI } from "@google/genai";
import { sendDebugEvent, serializeError } from "../lib/debugTelemetry";

type GeminiMessage = {
  role: "user" | "model";
  text: string;
};

type DetectionResult = {
  label: string;
  distance: string;
  confidence: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

type GeminiResponse = {
  feedback: string;
  detections: DetectionResult[];
};

const isAbortError = (error: unknown) => {
  const err = error as { name?: string; message?: string };
  return err?.name === "AbortError" || /abort/i.test(err?.message || "");
};

export function useGemini() {
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<GeminiMessage[]>([]);
  
  const aiRef = useRef<GoogleGenAI | null>(null);
  const liveSessionRef = useRef<any>(null);
  const audioInputQueueRef = useRef<any[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeRequestIdRef = useRef(0);

  const cancelActiveRequest = useCallback(() => {
    const hadActiveRequest = Boolean(abortControllerRef.current);
    activeRequestIdRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsLoading(false);
    if (hadActiveRequest) {
      sendDebugEvent({
        type: "gemini.request_cancelled",
        source: "useGemini",
        message: "Active Gemini request cancelled",
      });
    }
  }, []);

  const beginRequest = useCallback(() => {
    cancelActiveRequest();
    const controller = new AbortController();
    const requestId = activeRequestIdRef.current + 1;
    activeRequestIdRef.current = requestId;
    abortControllerRef.current = controller;
    setIsLoading(true);
    setError(null);

    return { controller, requestId };
  }, [cancelActiveRequest]);

  const isCurrentRequest = useCallback(
    (requestId: number, controller: AbortController) =>
      activeRequestIdRef.current === requestId &&
      abortControllerRef.current === controller &&
      !controller.signal.aborted,
    [],
  );

  const finishRequest = useCallback(
    (requestId: number, controller: AbortController) => {
      if (!isCurrentRequest(requestId, controller)) {
        return;
      }

      abortControllerRef.current = null;
      setIsLoading(false);
    },
    [isCurrentRequest],
  );

  useEffect(() => {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      setError("GEMINI_API_KEY no configurada. Agrega VITE_GEMINI_API_KEY a tu .env");
      sendDebugEvent({
        type: "gemini.missing_api_key",
        source: "useGemini",
        level: "error",
        message: "VITE_GEMINI_API_KEY is not configured",
      });
      return;
    }

    aiRef.current = new GoogleGenAI({ apiKey });
    setIsConnected(true);
    sendDebugEvent({
      type: "gemini.client_initialized",
      source: "useGemini",
      message: "Gemini client initialized",
    });

    return () => {
      disconnect();
    };
  }, []);

  const connectLiveSession = useCallback(async () => {
    if (!aiRef.current) {
      setError("Cliente de Gemini no inicializado");
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      // Configurar sesión live con soporte para audio y texto
      const config = {
        responseModalities: ["TEXT"],
        systemInstruction: {
          parts: [
            {
              text: `Eres un asistente visual experto en ayudar personas con discapacidad visual. 
Cuando recibas imágenes de una cámara, describe lo que ves de manera clara y concisa en español.
Identifica objetos, personas, texto, obstáculos y proporciona distancias aproximadas.
Sé específico sobre la ubicación de los objetos (izquierda, derecha, centro, cerca, lejos).
Si te preguntan sobre texto en la imagen, léelo y transcríbelo exactamente.
Mantén las respuestas informativas pero breves (2-3 oraciones máximo para feedback normal).`,
            },
          ],
        },
      };

      // Nota: La API Live completa aún está en preview
      // Por ahora usamos generateContent con streaming
      liveSessionRef.current = { config };
      setIsConnected(true);
      sendDebugEvent({
        type: "gemini.live_session_connected",
        source: "useGemini",
        message: "Gemini live session configured",
      });
    } catch (err: any) {
      setError(`Error al conectar: ${err.message}`);
      sendDebugEvent({
        type: "gemini.live_session_error",
        source: "useGemini",
        level: "error",
        message: err.message || "Error al conectar",
        payload: serializeError(err),
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  const sendTextMessage = useCallback(
    async (text: string): Promise<string> => {
      if (!aiRef.current) {
        throw new Error("Cliente de Gemini no disponible");
      }

      const { controller, requestId } = beginRequest();

      try {
        // Agregar mensaje del usuario al historial
        const userMsg: GeminiMessage = { role: "user", text };
        setMessages((prev) => [...prev, userMsg]);
        sendDebugEvent({
          type: "gemini.text_request",
          source: "useGemini",
          message: "Text prompt sent to Gemini",
          payload: { text },
        });

        // Preparar el historial de mensajes para contexto
        const chatHistory = messages.map((msg) => ({
          role: msg.role,
          parts: [{ text: msg.text }],
        }));

        const response = await aiRef.current.models.generateContent({
          model: "gemini-2.5-flash",
          config: { abortSignal: controller.signal },
          contents: [
            ...chatHistory,
            {
              role: "user",
              parts: [{ text }],
            },
          ],
        });

        const responseText = response.text || "No pude generar una respuesta";
        if (!isCurrentRequest(requestId, controller)) {
          throw new DOMException("Request superseded", "AbortError");
        }
        
        // Agregar respuesta del modelo al historial
        const modelMsg: GeminiMessage = { role: "model", text: responseText };
        setMessages((prev) => [...prev, modelMsg]);
        sendDebugEvent({
          type: "gemini.text_response",
          source: "useGemini",
          message: "Text response received from Gemini",
          payload: { text: responseText },
        });

        return responseText;
      } catch (err: any) {
        if (controller.signal.aborted || isAbortError(err)) {
          throw err;
        }

        const errorMsg = err.message || "Error al enviar mensaje";
        if (isCurrentRequest(requestId, controller)) {
          setError(errorMsg);
        }
        sendDebugEvent({
          type: "gemini.text_error",
          source: "useGemini",
          level: "error",
          message: errorMsg,
          payload: serializeError(err),
        });
        throw err;
      } finally {
        finishRequest(requestId, controller);
      }
    },
    [beginRequest, finishRequest, isCurrentRequest, messages]
  );

  const sendImageWithPrompt = useCallback(
    async (
      imageBase64: string,
      prompt: string = "Describe lo que ves en esta imagen. ¿Qué objetos hay? ¿Hay texto visible? ¿Hay personas u obstáculos?"
    ): Promise<GeminiResponse> => {
      if (!aiRef.current) {
        throw new Error("Cliente de Gemini no disponible");
      }

      const { controller, requestId } = beginRequest();

      try {
        sendDebugEvent({
          type: "gemini.image_request",
          source: "useGemini",
          message: "Image prompt sent to Gemini",
          payload: {
            prompt,
            imageBytesBase64Length: imageBase64.length,
          },
          imageBase64,
          imageMimeType: "image/jpeg",
          imageFilename: `visiont-analysis-${Date.now()}.jpg`,
        });

        const response = await aiRef.current.models.generateContent({
          model: "gemini-2.5-flash",
          config: { abortSignal: controller.signal },
          contents: [
            {
              parts: [
                {
                  inlineData: {
                    mimeType: "image/jpeg",
                    data: imageBase64,
                  },
                },
                {
                  text: `${prompt}

Reglas de prioridad:
- Si hay una solicitud del usuario, responde primero exactamente esa solicitud.
- No describas ni enumeres objetos alrededor salvo que ayuden directamente a responder.
- Si el usuario pide leer texto, transcribe el texto visible de forma directa.
- Si el usuario pide localizar o identificar algo, da ubicacion/distancia solo de eso.
- Si lo solicitado no es visible, dilo claramente sin inventar detalles.
- Agrega alertas de seguridad solo si son criticas y evidentes.

IMPORTANTE: Proporciona UN MAXIMO DE 4 OBJETOS en las detecciones. No incluyas mas de 4 y prioriza solo elementos relacionados con la solicitud o riesgos criticos.

Responde en el siguiente formato JSON si es posible, o en texto normal si no puedes detectar objetos especificos:
{
  "feedback": "Respuesta directa a la solicitud del usuario",
  "detections": [
    {
      "label": "nombre del objeto",
      "distance": "distancia aproximada en metros",
      "confidence": 95,
      "x": 50,
      "y": 50,
      "w": 20,
      "h": 30
    }
  ]
}

Proporciona coordenadas aproximadas (x, y como porcentaje de la imagen desde la esquina superior izquierda, w y h como porcentaje del tamano de la imagen). Maximo 4 detecciones.`,
                },
              ],
            },
          ],
        });

        const responseText = response.text || "No pude analizar la imagen";
        if (!isCurrentRequest(requestId, controller)) {
          throw new DOMException("Request superseded", "AbortError");
        }

        // Intentar parsear JSON de la respuesta
        let parsed: GeminiResponse = { feedback: responseText, detections: [] };
        
        try {
          // Buscar bloque JSON en la respuesta
          const jsonMatch = responseText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            parsed = JSON.parse(jsonMatch[0]);
          }
        } catch {
          // Si no se puede parsear, usar el texto completo como feedback
          parsed = { feedback: responseText, detections: [] };
        }

        // Agregar al historial de mensajes
        const modelMsg: GeminiMessage = {
          role: "model",
          text: parsed.feedback,
        };
        setMessages((prev) => [...prev, modelMsg]);
        sendDebugEvent({
          type: "gemini.image_response",
          source: "useGemini",
          message: "Image response received from Gemini",
          payload: parsed,
        });

        return parsed;
      } catch (err: any) {
        if (controller.signal.aborted || isAbortError(err)) {
          throw err;
        }

        const errorMsg = err.message || "Error al analizar imagen";
        if (isCurrentRequest(requestId, controller)) {
          setError(errorMsg);
        }
        sendDebugEvent({
          type: "gemini.image_error",
          source: "useGemini",
          level: "error",
          message: errorMsg,
          payload: serializeError(err),
        });
        throw err;
      } finally {
        finishRequest(requestId, controller);
      }
    },
    [beginRequest, finishRequest, isCurrentRequest]
  );

  const sendRealtimeAudio = useCallback(async () => {
    // Para audio en tiempo real, necesitamos implementar el streaming de audio
    // Esto se manejará a través del hook useAudio
    // Por ahora, esta función está placeholder para futura implementación
    // con la API de Live streaming completa cuando esté disponible
    console.warn("Audio realtime streaming no disponible aún en web SDK");
    sendDebugEvent({
      type: "gemini.realtime_audio_unavailable",
      source: "useGemini",
      level: "warn",
      message: "Realtime audio streaming is not available in the web SDK yet",
    });
  }, []);

  const sendAudioChunk = useCallback(
    async (audioBase64: string, transcription?: string): Promise<string> => {
      if (!aiRef.current) {
        throw new Error("Cliente de Gemini no disponible");
      }

      const { controller, requestId } = beginRequest();

      try {
        sendDebugEvent({
          type: "gemini.audio_request",
          source: "useGemini",
          message: "Audio prompt sent to Gemini",
          payload: {
            hasAudio: Boolean(audioBase64),
            audioBytesBase64Length: audioBase64?.length || 0,
            transcription,
          },
        });

        // Enviar audio como parte del mensaje
        // Gemini 2.5 Flash puede procesar audio directamente
        const contents: any[] = [];

        if (audioBase64) {
          contents.push({
            inlineData: {
              mimeType: "audio/wav",
              data: audioBase64,
            },
          });
        }

        if (transcription) {
          contents.push({
            text: `Transcripción de audio: ${transcription}. Responde en español de manera concisa.`,
          });
        }

        const response = await aiRef.current.models.generateContent({
          model: "gemini-2.5-flash",
          config: { abortSignal: controller.signal },
          contents,
        });

        const responseText = response.text || "No pude procesar el audio";
        if (!isCurrentRequest(requestId, controller)) {
          throw new DOMException("Request superseded", "AbortError");
        }

        const modelMsg: GeminiMessage = { role: "model", text: responseText };
        setMessages((prev) => [...prev, modelMsg]);
        sendDebugEvent({
          type: "gemini.audio_response",
          source: "useGemini",
          message: "Audio response received from Gemini",
          payload: { text: responseText },
        });

        return responseText;
      } catch (err: any) {
        if (controller.signal.aborted || isAbortError(err)) {
          throw err;
        }

        const errorMsg = err.message || "Error al procesar audio";
        if (isCurrentRequest(requestId, controller)) {
          setError(errorMsg);
        }
        sendDebugEvent({
          type: "gemini.audio_error",
          source: "useGemini",
          level: "error",
          message: errorMsg,
          payload: serializeError(err),
        });
        throw err;
      } finally {
        finishRequest(requestId, controller);
      }
    },
    [beginRequest, finishRequest, isCurrentRequest]
  );

  const disconnect = useCallback(() => {
    cancelActiveRequest();
    liveSessionRef.current = null;
    audioInputQueueRef.current = [];
    setIsConnected(false);
    sendDebugEvent({
      type: "gemini.disconnected",
      source: "useGemini",
      message: "Gemini client disconnected",
    });
  }, [cancelActiveRequest]);

  const clearHistory = useCallback(() => {
    setMessages([]);
  }, []);

  return {
    isConnected,
    isLoading,
    error,
    messages,
    connectLiveSession,
    sendTextMessage,
    sendImageWithPrompt,
    sendRealtimeAudio,
    sendAudioChunk,
    cancelActiveRequest,
    disconnect,
    clearHistory,
  };
}
