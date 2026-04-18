import { useState, useEffect, useRef, useCallback } from "react";
import { AppHeader } from "./AppHeader";
import { TopNav } from "./TopNav";
import { motion, AnimatePresence } from "motion/react";
import {
  Phone,
  MapPin,
  MessageSquare,
  X,
  AlertTriangle,
  Shield,
  Mic,
  MicOff,
  UserPlus,
  RefreshCcw,
  BookUser,
} from "lucide-react";
import { useAudio } from "../hooks/useAudio";
import { useVoiceActivation } from "../hooks/useVoiceActivation";
import { useContactPicker, type Contact } from "../hooks/useContactPicker";

const initialContacts: Contact[] = [
  {
    id: "emergency-128",
    name: "Cruz Blanca",
    relation: "Emergencias",
    phone: "128",
    initials: "CB",
    isEmergency: true,
  },
];

const SOS_WAKE_WORDS = [
  "ayuda",
  "emergencia",
  "sos",
  "llama a",
  "llamar a",
  "marca a",
  "buscar contacto",
  "busca a",
  "agregar contacto",
  "agrega a",
  "sincroniza contactos",
  "contacto",
];

/**
 * Obtiene las iniciales de un nombre para mostrar en avatar
 */
const getInitials = (name: string): string =>
  name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

/**
 * Normaliza texto para comparación: elimina acentos, convierte a minúsculas,
 * remueve caracteres especiales y colapsa espacios múltiples
 */
const normalizeText = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Fusiona múltiples arrays de contactos eliminando duplicados por teléfono
 * Prioriza contactos de emergencia y ordena alfabéticamente
 */
const mergeContacts = (...groups: Contact[][]): Contact[] => {
  const byPhone = new Map<string, Contact>();

  for (const group of groups) {
    for (const contact of group) {
      // Usar phone normalizado o id como clave única
      const key = contact.phone.replace(/[^\d+]/g, "") || contact.id;
      byPhone.set(key, {
        ...contact,
        initials: contact.initials || getInitials(contact.name),
      });
    }
  }

  return Array.from(byPhone.values()).sort((left, right) => {
    // Priorizar contactos de emergencia al inicio
    if (left.isEmergency && !right.isEmergency) return -1;
    if (!left.isEmergency && right.isEmergency) return 1;
    // Orden alfabético secundario
    return left.name.localeCompare(right.name, "es");
  });
};

/**
 * Tipos de intenciones que puede tener un comando de voz
 */
type VoiceIntent =
  | { type: "activate_sos" }
  | { type: "cancel_sos" }
  | { type: "call"; contactName: string }
  | { type: "search_contact"; contactName?: string }
  | { type: "add_contact"; contactName?: string }
  | { type: "unknown" };

/**
 * Parsea el transcript de voz para determinar la intención del usuario
 * @param transcript - Texto reconocido del habla del usuario
 * @param parseContactName - Función para extraer nombre de contacto del transcript
 * @returns Objeto VoiceIntent con el tipo de acción y datos asociados
 */
const parseVoiceIntent = (
  transcript: string,
  parseContactName: (value: string) => string | null,
): VoiceIntent => {
  const normalized = normalizeText(transcript);
  const contactName = parseContactName(transcript) || undefined;

  // === ACTIVAR SOS ===
  if (
    /(activar|activa|envia|enviar|lanza|inicia).*(sos|emergencia|alerta)/.test(
      normalized,
    ) ||
    /(necesito ayuda|ayuda urgente|emergencia)/.test(normalized)
  ) {
    return { type: "activate_sos" };
  }

  // === CANCELAR SOS ===
  if (
    /(cancela|cancelar|deten|detener|para|parar).*(sos|emergencia|alerta)?/.test(
      normalized,
    )
  ) {
    return { type: "cancel_sos" };
  }

  // === LLAMAR A CONTACTO ===
  if (
    /(llama|llamar|marca|marcar|contacta|contactar|comunicate|comunicar)/.test(
      normalized,
    ) &&
    contactName
  ) {
    return { type: "call", contactName };
  }

  // === BUSCAR CONTACTO ===
  if (
    /(busca|buscar|buscame|encuentra|encontrar|muestrame|mostrar)\b/.test(
      normalized,
    )
  ) {
    return { type: "search_contact", contactName };
  }

  // === AGREGAR/SINCRONIZAR CONTACTO ===
  if (
    /(agrega|agregar|anade|añade|guarda|guardar|sincroniza|sincronizar)\b/.test(
      normalized,
    )
  ) {
    return { type: "add_contact", contactName };
  }

  // === INTENCIÓN NO RECONOCIDA ===
  return { type: "unknown" };
};

export function SOSView() {
  // Estados principales
  const [sosActive, setSosActive] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const [locationShared, setLocationShared] = useState(false);
  const [messageSent, setMessageSent] = useState(false);
  const [manualPhone, setManualPhone] = useState("");
  const [voiceStatus, setVoiceStatus] = useState("");
  const [showManualInput, setShowManualInput] = useState(false);

  // Estados de audio/voz (patrón CameraView)
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [voiceActivationEnabled, setVoiceActivationEnabled] = useState(true);

  // Refs para coordinación de estados (patrón CameraView)
  const isSpeakingRef = useRef(false);
  const isListeningRef = useRef(false);
  const isProcessingRef = useRef(false);
  const sosActiveRef = useRef(sosActive);
  const contactsRef = useRef<Contact[]>(initialContacts);
  const pendingCallNameRef = useRef<string | null>(null);

  // Refs para callbacks de voice activation (patrón CameraView)
  const executeVoiceCommandRef = useRef<
    ((transcript?: string) => Promise<void>) | null
  >(null);
  const startVoiceListeningRef = useRef<(() => Promise<void>) | null>(null);

  // Mantener refs actualizados (patrón CameraView)
  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  useEffect(() => {
    isProcessingRef.current = isProcessing;
  }, [isProcessing]);

  useEffect(() => {
    sosActiveRef.current = sosActive;
  }, [sosActive]);

  // Hook de contactos
  const {
    isSupported: isContactPickerSupported,
    isLoading: isContactPickerLoading,
    error: contactPickerError,
    savedContacts,
    deviceContacts,
    permissionStatus,
    isNativeBridgeAvailable,
    canAutoDial,
    canListDeviceContacts,
    clearError: clearContactPickerError,
    saveContact,
    requestContactsAccess,
    refreshDeviceContacts,
    parseContactName,
    findContactByName,
    pickContact,
    callContact: triggerCall,
  } = useContactPicker({
    onError: (message) => {
      setVoiceStatus(message);
    },
  });

  // Hook de audio (igual que CameraView)
  const {
    isListening: audioListening,
    isSpeaking: audioSpeaking,
    error: audioError,
    audioLevel,
    startListening: startAudioListening,
    stopListening: stopAudioListening,
    speakText,
    requestMicrophonePermission,
  } = useAudio({
    sendSampleRate: 16000,
    enableEchoCancellation: true,
  });

  // Hook de activación por voz (patrón CameraView)
  const {
    isBackgroundListening,
    isActive: voiceActive,
    isProcessing: voiceProcessing,
    transcript: userTranscript,
    error: voiceError,
    startBackgroundListening,
    stopBackgroundListening,
    resetActive,
  } = useVoiceActivation({
    wakeWords: SOS_WAKE_WORDS,
    silenceTimeout: 2600,
    onActivation: () => {
      console.log(
        "Wake word detected in SOSView, auto-activating microphone...",
      );
      // Solo iniciar escucha si no está ya escuchando o procesando
      if (!isListeningRef.current && !isProcessingRef.current) {
        if (startVoiceListeningRef.current) {
          startVoiceListeningRef.current();
        }
      }
    },
    onSilence: (transcript: string) => {
      console.log(
        "Silence detected in SOSView, executing command:",
        transcript,
      );
      // Solo ejecutar si está escuchando
      if (isListeningRef.current) {
        if (executeVoiceCommandRef.current) {
          executeVoiceCommandRef.current(transcript);
        }
      }
    },
  });

  // Log de transcripción (patrón CameraView)
  useEffect(() => {
    if (userTranscript) {
      console.log("[SOS Voice Transcript]", userTranscript);
      setVoiceStatus(userTranscript);
    }
  }, [userTranscript]);

  // Función para hablar estado (patrón CameraView - non-blocking)
  const speakStatus = useCallback(
    async (text: string) => {
      window.speechSynthesis.cancel();
      isSpeakingRef.current = true;

      try {
        await speakText(text);
      } finally {
        isSpeakingRef.current = false;
      }
    },
    [speakText],
  );

  // Iniciar escucha por voz (patrón CameraView)
  const startVoiceListening = useCallback(async () => {
    clearContactPickerError();
    setShowManualInput(false);

    const granted = await requestMicrophonePermission();
    if (!granted) {
      setVoiceStatus("Permiso de micrófono denegado");
      return;
    }

    setIsListening(true);
    await startAudioListening();
    speakStatus("Escuchando comando");
  }, [
    clearContactPickerError,
    requestMicrophonePermission,
    startAudioListening,
    speakStatus,
  ]);

  // Asignar startVoiceListening al ref (patrón CameraView)
  useEffect(() => {
    startVoiceListeningRef.current = startVoiceListening;
  }, [startVoiceListening]);

  // Ejecutar comando de voz - UNA sola vez, sin loops (patrón CameraView)
  const executeVoiceCommand = useCallback(
    async (transcript?: string) => {
      // Prevenir múltiples ejecuciones simultáneas
      if (isProcessingRef.current) {
        console.warn("Command already processing, ignoring request");
        return;
      }

      isProcessingRef.current = true;
      setIsProcessing(true);
      setVoiceStatus("Procesando comando...");

      try {
        const command = (transcript || userTranscript || "").trim();

        if (!command) {
          const message =
            "No escuché un comando claro. Intenta decir: 'llama a mamá' o 'activa emergencia'";
          setVoiceStatus(message);
          speakStatus(message);
          return;
        }

        const normalized = normalizeText(command);
        const intent = parseVoiceIntent(command, parseContactName);

        // Manejar intents (misma lógica que tu handleVoiceCommand original)
        if (intent.type === "activate_sos") {
          if (!sosActiveRef.current) {
            setSosActive(true);
            speakStatus("Activando emergencia");
          }
          return;
        }

        if (intent.type === "cancel_sos" && sosActiveRef.current) {
          handleCancelSOS();
          speakStatus("Emergencia cancelada");
          return;
        }

        if (intent.type === "call" && intent.contactName) {
          const contact = await resolveContactByName(intent.contactName);
          if (contact) {
            pendingCallNameRef.current = null;
            await callContact(contact.phone, contact.name);
          } else {
            handleContactNotFound(intent.contactName);
          }
          return;
        }

        if (intent.type === "search_contact") {
          await handleSearchContact(intent.contactName);
          return;
        }

        if (intent.type === "add_contact") {
          await handleAddContact(intent.contactName, normalized);
          return;
        }

        // Comando no reconocido
        const helpMessage =
          "Puedes decir: 'llama a mamá', 'agrega contacto' o 'activa emergencia'";
        setVoiceStatus(helpMessage);
        speakStatus(helpMessage);
      } catch (err) {
        console.error("Error processing voice command:", err);
        setVoiceStatus("Error procesando comando de voz");
      } finally {
        isProcessingRef.current = false;
        setIsProcessing(false);
        resetActive();
      }
    },
    [
      userTranscript,
      parseContactName,
      resolveContactByName,
      callContact,
      speakStatus,
      resetActive,
    ],
  );

  // Asignar executeVoiceCommand al ref (patrón CameraView)
  useEffect(() => {
    executeVoiceCommandRef.current = executeVoiceCommand;
  }, [executeVoiceCommand]);

  // Cancelar análisis/comando (patrón CameraView adaptado)
  const cancelProcessing = useCallback(() => {
    const hadProcessing = isProcessingRef.current;

    // Detener escucha de audio
    stopAudioListening();

    // Cancelar síntesis de voz
    window.speechSynthesis.cancel();
    isSpeakingRef.current = false;

    // Resetear estados
    isProcessingRef.current = false;
    setIsProcessing(false);
    setIsListening(false);

    // Resetear voice activation
    resetActive();

    // Anunciar cancelación solo si había procesamiento activo
    if (hadProcessing) {
      speakStatus("Cancelando");
    }
  }, [stopAudioListening, speakStatus, resetActive]);

  // Handler del botón de micrófono - PATRÓN CameraView (3 estados)
  const handleMicPress = useCallback(async () => {
    clearContactPickerError();

    // Estado 1: Procesando → CANCELAR
    if (isProcessing) {
      cancelProcessing();
      setIsListening(false);
      return;
    }

    // Estado 2: Escuchando → DETENER & EJECUTAR COMANDO
    if (isListening) {
      stopAudioListening();
      setIsListening(false);
      // Ejecutar EXACTAMENTE un comando (sin transcript para presión manual)
      await executeVoiceCommand();
      return;
    }

    // Estado 3: Idle → INICIAR ESCUCHA
    const granted = await requestMicrophonePermission();
    if (granted) {
      setIsListening(true);
      await startAudioListening();
      speakStatus("Escuchando, toca para procesar");
    }
  }, [
    isProcessing,
    isListening,
    cancelProcessing,
    stopAudioListening,
    executeVoiceCommand,
    requestMicrophonePermission,
    startAudioListening,
    speakStatus,
    clearContactPickerError,
  ]);

  // ... (mantener todas las funciones auxiliares originales: handleCancelSOS, resolveContactByName, callContact, etc.)
  // Solo adaptarlas para usar speakStatus en lugar de speakFeedback si prefieres consistencia

  const handleCancelSOS = useCallback(() => {
    setSosActive(false);
    setLocationShared(false);
    setMessageSent(false);
    setCountdown(5);
    setVoiceStatus("");
  }, []);

  const resolveContactByName = useCallback(
    async (contactName: string) => {
      let contact = findContactByName(contactName, contactsRef.current);
      if (contact) return contact;

      if (canListDeviceContacts) {
        const freshContacts =
          permissionStatus === "granted"
            ? await refreshDeviceContacts()
            : await requestContactsAccess().then((r) => r.contacts);
        if (freshContacts.length > 0) {
          contact = findContactByName(
            contactName,
            mergeContacts(contactsRef.current, freshContacts),
          );
        }
      }
      return contact;
    },
    [
      canListDeviceContacts,
      findContactByName,
      permissionStatus,
      refreshDeviceContacts,
    ],
  );

  const callContact = useCallback(
    async (phone: string, name: string) => {
      if (!phone) {
        speakStatus("No hay número disponible para este contacto");
        setShowManualInput(true);
        return false;
      }
      const message = canAutoDial
        ? `Llamando a ${name}`
        : `Abriendo teléfono para llamar a ${name}`;
      setVoiceStatus(message);
      speakStatus(message);
      return await triggerCall(phone, name);
    },
    [canAutoDial, speakStatus, triggerCall],
  );

  const handleContactNotFound = useCallback(
    (name: string) => {
      pendingCallNameRef.current = name;
      if (isContactPickerSupported || canListDeviceContacts) {
        const message = `No encontré a ${name}. Toca Agregar para elegirlo.`;
        setVoiceStatus(message);
        speakStatus(message);
      } else {
        setShowManualInput(true);
        const message = `Ingresa el número manualmente para ${name}.`;
        setVoiceStatus(message);
        speakStatus(message);
      }
    },
    [canListDeviceContacts, isContactPickerSupported, speakStatus],
  );

  const handleSearchContact = useCallback(
    async (contactName?: string) => {
      if (contactName) {
        const contact = await resolveContactByName(contactName);
        if (contact) {
          speakStatus(`Encontré a ${contact.name}`);
        } else {
          speakStatus(`No encontré a ${contactName}`);
        }
        return;
      }
      if (canListDeviceContacts) {
        await requestContactsAccess();
      } else {
        speakStatus("Toca Agregar para seleccionar un contacto");
      }
    },
    [
      canListDeviceContacts,
      requestContactsAccess,
      resolveContactByName,
      speakStatus,
    ],
  );

  const handleAddContact = useCallback(
    async (contactName?: string, normalized?: string) => {
      if (contactName) {
        const contact = await resolveContactByName(contactName);
        if (contact) {
          saveContact({
            ...contact,
            relation: "Contacto de emergencia",
            isEmergency: false,
          });
          speakStatus(`${contact.name} agregado como contacto de emergencia`);
        } else {
          speakStatus(`No encontré a ${contactName}. Toca Agregar.`);
        }
        return;
      }
      if (normalized?.includes("sincroniza") && canListDeviceContacts) {
        await requestContactsAccess();
        return;
      }
      speakStatus("Toca Agregar para seleccionar un contacto");
    },
    [
      canListDeviceContacts,
      requestContactsAccess,
      resolveContactByName,
      saveContact,
      speakStatus,
    ],
  );

  // Efecto para countdown de SOS (mantener original)
  useEffect(() => {
    if (!sosActive) {
      setCountdown(5);
      return;
    }
    if (countdown <= 0) {
      setLocationShared(true);
      setMessageSent(true);
      speakStatus("Alerta de emergencia enviada. Ayuda en camino.");
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown, sosActive, speakStatus]);

  // Efecto para activar background listening (patrón CameraView)
  useEffect(() => {
    // Iniciar cámara no aplica, pero sí voice activation
    if (voiceActivationEnabled) {
      setTimeout(() => {
        startBackgroundListening();
      }, 1000);
    }
    return () => {
      stopBackgroundListening();
    };
  }, [
    voiceActivationEnabled,
    startBackgroundListening,
    stopBackgroundListening,
  ]);

  // Efecto para sincronizar contactos (mantener original)
  useEffect(() => {
    if (
      permissionStatus === "granted" &&
      canListDeviceContacts &&
      deviceContacts.length === 0
    ) {
      void refreshDeviceContacts();
    }
  }, [
    canListDeviceContacts,
    deviceContacts.length,
    permissionStatus,
    refreshDeviceContacts,
  ]);

  // Efecto para errores de voz (mantener original)
  useEffect(() => {
    if (voiceError) {
      setVoiceStatus(voiceError);
    }
  }, [voiceError]);

  // Actualizar contactsRef
  const contacts = mergeContacts(
    initialContacts,
    savedContacts,
    deviceContacts,
  );
  useEffect(() => {
    contactsRef.current = contacts;
  }, [contacts]);

  // ... (el JSX se mantiene prácticamente igual, solo actualizar el botón de micrófono)

  const isVoiceCaptureActive = voiceActive || isListening;

  return (
    <>
      <AppHeader />
      <div
        className="flex flex-col flex-1 overflow-y-auto pb-16"
        style={{ background: "#F8FAFC" }}
      >
        {/* ... (mantener todo el contenido anterior: header, estados, botones SOS, cards de ubicación, lista de contactos) ... */}

        {/* Botón de micrófono - PATRÓN CameraView */}
        <div className="pointer-events-none fixed bottom-0 left-0 right-0 flex flex-col items-center pb-6 pt-2">
          <p
            style={{ fontSize: "12px" }}
            className="pointer-events-auto mb-3 text-gray-400"
          >
            {isProcessing
              ? "Procesando... Toca para cancelar"
              : isListening
                ? "Escuchando... Toca para procesar"
                : isBackgroundListening
                  ? "Di 'ayuda' o toca para hablar"
                  : "Toca para hablar"}
          </p>

          {/* Indicador de nivel de audio cuando está escuchando */}
          {isListening && (
            <div className="pointer-events-auto mb-3 flex items-center gap-2 rounded-full bg-white/90 px-3 py-1.5 shadow-sm">
              <Mic size={12} className="text-red-400" />
              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full bg-red-400 transition-all duration-100"
                  style={{ width: `${audioLevel * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* Indicador de voice activation en background */}
          {isBackgroundListening && !isListening && !isProcessing && (
            <div className="pointer-events-auto absolute bottom-20 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-green-400 text-xs">
                Escuchando comandos
              </span>
            </div>
          )}

          {/* Botón de micrófono neumórfico - PATRÓN CameraView */}
          <motion.button
            whileTap={{ scale: 0.93 }}
            onClick={handleMicPress}
            aria-label={
              isProcessing
                ? "Cancelar procesamiento"
                : isListening
                  ? "Detener y procesar"
                  : "Activar micrófono"
            }
            aria-pressed={isListening || isProcessing}
            className="pointer-events-auto relative flex items-center justify-center rounded-full transition-all duration-200 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-400"
            style={{
              width: 80,
              height: 80,
              background: isProcessing
                ? "linear-gradient(145deg, #F59E0B, #D97706)" // Amber para processing
                : isListening
                  ? "linear-gradient(145deg, #3B82F6, #2563EB)" // Blue para listening
                  : "#F1F5F9", // Gray para idle
              boxShadow: isProcessing
                ? "0 8px 24px rgba(245,158,11,0.45), inset 0 1px 0 rgba(255,255,255,0.2)"
                : isListening
                  ? "0 8px 24px rgba(59,130,246,0.45), inset 0 1px 0 rgba(255,255,255,0.2)"
                  : "8px 8px 16px #d1d9e0, -8px -8px 16px #ffffff",
            }}
          >
            {/* Anillos de pulso cuando está activo */}
            {(isProcessing || isListening) && (
              <>
                <motion.div
                  className="absolute inset-0 rounded-full bg-white/30"
                  animate={{ scale: [1, 1.5, 1.5], opacity: [0.4, 0, 0] }}
                  transition={{
                    duration: 1.5,
                    repeat: Infinity,
                    ease: "easeOut",
                  }}
                />
                <motion.div
                  className="absolute inset-0 rounded-full bg-white/20"
                  animate={{ scale: [1, 1.8, 1.8], opacity: [0.3, 0, 0] }}
                  transition={{
                    duration: 1.5,
                    repeat: Infinity,
                    ease: "easeOut",
                    delay: 0.3,
                  }}
                />
              </>
            )}

            {/* Ícono según estado */}
            {isProcessing ? (
              <svg
                width="30"
                height="30"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2"
                className="relative z-10"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : isListening ? (
              <MicOff
                size={30}
                className="text-white relative z-10"
                strokeWidth={2}
              />
            ) : (
              <Mic
                size={30}
                strokeWidth={2}
                style={{ color: "#1E3A5F" }}
                className="relative z-10"
              />
            )}
          </motion.button>
        </div>

        {/* Mensajes de error (mantener original) */}
        <AnimatePresence>
          {(contactPickerError || audioError || voiceError) && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="fixed bottom-24 left-5 right-5"
            >
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                <p style={{ fontSize: "12px" }} className="text-red-600">
                  {contactPickerError || audioError || voiceError}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <TopNav />
    </>
  );
}
