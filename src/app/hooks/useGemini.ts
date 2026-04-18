import { useState, useCallback, useRef, useEffect } from "react";
import { GoogleGenAI } from "@google/genai";

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

export function useGemini() {
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<GeminiMessage[]>([]);
  
  const aiRef = useRef<GoogleGenAI | null>(null);
  const messagesRef = useRef<GeminiMessage[]>([]);
  const liveSessionRef = useRef<any>(null);
  const audioInputQueueRef = useRef<any[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      setError("GEMINI_API_KEY no configurada. Agrega VITE_GEMINI_API_KEY a tu .env");
      return;
    }

    aiRef.current = new GoogleGenAI({ apiKey });
    setIsConnected(true);

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
    } catch (err: any) {
      setError(`Error al conectar: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const sendTextMessage = useCallback(
    async (text: string): Promise<string> => {
      if (!aiRef.current) {
        throw new Error("Cliente de Gemini no disponible");
      }

      setIsLoading(true);
      setError(null);

      try {
        // Agregar mensaje del usuario al historial
        const userMsg: GeminiMessage = { role: "user", text };
        setMessages((prev) => [...prev, userMsg]);

        const chatHistory = messagesRef.current.map((msg) => ({
          role: msg.role,
          parts: [{ text: msg.text }],
        }));

        const response = await aiRef.current.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [
            ...chatHistory,
            {
              role: "user",
              parts: [{ text }],
            },
          ],
        });

        const responseText = response.text || "No pude generar una respuesta";
        
        // Agregar respuesta del modelo al historial
        const modelMsg: GeminiMessage = { role: "model", text: responseText };
        setMessages((prev) => [...prev, modelMsg]);

        return responseText;
      } catch (err: any) {
        const errorMsg = err.message || "Error al enviar mensaje";
        setError(errorMsg);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const sendImageWithPrompt = useCallback(
    async (
      imageBase64: string,
      prompt: string = "Describe lo que ves en esta imagen. ¿Qué objetos hay? ¿Hay texto visible? ¿Hay personas u obstáculos?"
    ): Promise<GeminiResponse> => {
      if (!aiRef.current) {
        throw new Error("Cliente de Gemini no disponible");
      }

      setIsLoading(true);
      setError(null);

      try {
        const response = await aiRef.current.models.generateContent({
          model: "gemini-2.5-flash",
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

IMPORTANTE: Proporciona UN MÁXIMO DE 4 OBJÉTOS en las detecciones. No incluyas más de 4.

Responde en el siguiente formato JSON si es posible, o en texto normal si no puedes detectar objetos específicos:
{
  "feedback": "Descripción general de lo que ves",
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

Proporciona coordenadas aproximadas (x, y como porcentaje de la imagen desde la esquina superior izquierda, w y h como porcentaje del tamaño de la imagen). Máximo 4 detecciones.`,
                },
              ],
            },
          ],
        });

        const responseText = response.text || "No pude analizar la imagen";

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

        return parsed;
      } catch (err: any) {
        const errorMsg = err.message || "Error al analizar imagen";
        setError(errorMsg);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const sendRealtimeAudio = useCallback(async () => {
    // Para audio en tiempo real, necesitamos implementar el streaming de audio
    // Esto se manejará a través del hook useAudio
    // Por ahora, esta función está placeholder para futura implementación
    // con la API de Live streaming completa cuando esté disponible
    console.warn("Audio realtime streaming no disponible aún en web SDK");
  }, []);

  const sendAudioChunk = useCallback(
    async (audioBase64: string, transcription?: string): Promise<string> => {
      if (!aiRef.current) {
        throw new Error("Cliente de Gemini no disponible");
      }

      setIsLoading(true);
      setError(null);

      try {
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
          contents,
        });

        const responseText = response.text || "No pude procesar el audio";

        const modelMsg: GeminiMessage = { role: "model", text: responseText };
        setMessages((prev) => [...prev, modelMsg]);

        return responseText;
      } catch (err: any) {
        const errorMsg = err.message || "Error al procesar audio";
        setError(errorMsg);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const disconnect = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    liveSessionRef.current = null;
    audioInputQueueRef.current = [];
    setIsConnected(false);
  }, []);

  const clearHistory = useCallback(() => {
    messagesRef.current = [];
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
    disconnect,
    clearHistory,
  };
}
