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

const getInitials = (name: string): string =>
  name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

const normalizeText = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const mergeContacts = (...groups: Contact[][]): Contact[] => {
  const byPhone = new Map<string, Contact>();
  for (const group of groups) {
    for (const contact of group) {
      const key = contact.phone.replace(/[^\d+]/g, "") || contact.id;
      byPhone.set(key, {
        ...contact,
        initials: contact.initials || getInitials(contact.name),
      });
    }
  }
  return Array.from(byPhone.values()).sort((left, right) => {
    if (left.isEmergency && !right.isEmergency) return -1;
    if (!left.isEmergency && right.isEmergency) return 1;
    return left.name.localeCompare(right.name, "es");
  });
};

type VoiceIntent =
  | { type: "activate_sos" }
  | { type: "cancel_sos" }
  | { type: "call"; contactName: string }
  | { type: "search_contact"; contactName?: string }
  | { type: "add_contact"; contactName?: string }
  | { type: "unknown" };

const parseVoiceIntent = (
  transcript: string,
  parseContactName: (value: string) => string | null,
): VoiceIntent => {
  const normalized = normalizeText(transcript);
  const contactName = parseContactName(transcript) || undefined;
  if (
    /(activar|activa|envia|enviar|lanza|inicia).*(sos|emergencia|alerta)/.test(
      normalized,
    ) ||
    /(necesito ayuda|ayuda urgente|emergencia)/.test(normalized)
  ) {
    return { type: "activate_sos" };
  }
  if (
    /(cancela|cancelar|deten|detener|para|parar).*(sos|emergencia|alerta)?/.test(
      normalized,
    )
  ) {
    return { type: "cancel_sos" };
  }
  if (
    /(llama|llamar|marca|marcar|contacta|contactar|comunicate|comunicar)/.test(
      normalized,
    ) &&
    contactName
  ) {
    return { type: "call", contactName };
  }
  if (
    /(busca|buscar|buscame|encuentra|encontrar|muestrame|mostrar)\b/.test(
      normalized,
    )
  ) {
    return { type: "search_contact", contactName };
  }
  if (
    /(agrega|agregar|anade|añade|guarda|guardar|sincroniza|sincronizar)\b/.test(
      normalized,
    )
  ) {
    return { type: "add_contact", contactName };
  }
  return { type: "unknown" };
};

export function SOSView() {
  const [sosActive, setSosActive] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const [locationShared, setLocationShared] = useState(false);
  const [messageSent, setMessageSent] = useState(false);
  const [manualPhone, setManualPhone] = useState("");
  const [voiceStatus, setVoiceStatus] = useState("");
  const [showManualInput, setShowManualInput] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);

  // Refs para evitar stale closures en callbacks asíncronos (Patrón CameraView)
  const isSpeakingRef = useRef(false);
  const isListeningRef = useRef(false);
  const isProcessingVoiceRef = useRef(false);
  const contactsRef = useRef<Contact[]>(initialContacts);
  const sosActiveRef = useRef(sosActive);
  const pendingCallNameRef = useRef<string | null>(null);
  const executeVoiceCommandRef = useRef<
    ((transcript?: string) => Promise<void>) | null
  >(null);
  const startVoiceListeningRef = useRef<(() => Promise<void>) | null>(null);

  // Sincronizar refs con estados
  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);
  useEffect(() => {
    isProcessingVoiceRef.current = isProcessingVoice;
  }, [isProcessingVoice]);
  useEffect(() => {
    sosActiveRef.current = sosActive;
  }, [sosActive]);

  // Hooks
  const {
    isSupported: isContactPickerSupported,
    isLoading: isContactPickerLoading,
    error: contactPickerError,
    savedContacts,
    deviceContacts,
    permissionStatus,
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
    onError: (message) => setVoiceStatus(message),
  });

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

  const contacts = mergeContacts(
    initialContacts,
    savedContacts,
    deviceContacts,
  );
  useEffect(() => {
    contactsRef.current = contacts;
  }, [contacts]);

  // speakStatus - patrón idéntico a CameraView
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

  // Countdown SOS
  useEffect(() => {
    if (!sosActive) {
      setCountdown(5);
      return;
    }
    if (countdown <= 0) {
      setLocationShared(true);
      setMessageSent(true);
      void speakStatus("Alerta de emergencia enviada. Ayuda en camino.");
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown, sosActive, speakStatus]);

  const cancelSOS = useCallback(() => {
    setSosActive(false);
    setLocationShared(false);
    setMessageSent(false);
    setCountdown(5);
    setVoiceStatus("");
  }, []);

  const requestAndSyncContacts = useCallback(async () => {
    setVoiceStatus("Solicitando permiso para leer contactos...");
    const result = await requestContactsAccess();
    if (result.granted) {
      const total = result.contacts.length;
      const message =
        total > 0
          ? `Sincronice ${total} contactos del dispositivo`
          : "Permiso concedido, pero no encontre contactos";
      setVoiceStatus(message);
      void speakStatus(message);
      return result.contacts;
    }
    return [];
  }, [requestContactsAccess, speakStatus]);

  const resolveContactByName = useCallback(
    async (contactName: string) => {
      let contact = findContactByName(contactName, contactsRef.current);
      if (contact) return contact;

      if (canListDeviceContacts) {
        const freshContacts =
          permissionStatus === "granted"
            ? await refreshDeviceContacts()
            : await requestAndSyncContacts();

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
      requestAndSyncContacts,
    ],
  );

  const callContact = useCallback(
    async (phone: string, name: string) => {
      if (!phone) {
        const message = "No hay numero disponible para este contacto";
        setVoiceStatus(message);
        void speakStatus(message);
        setShowManualInput(true);
        return false;
      }
      const message = canAutoDial
        ? `Llamando automaticamente a ${name}`
        : `Abriendo la app del telefono para llamar a ${name}`;
      setVoiceStatus(message);
      void speakStatus(message);
      return await triggerCall(phone, name);
    },
    [canAutoDial, speakStatus, triggerCall],
  );

  const handleVoiceCommand = useCallback(
    async (transcript: string) => {
      const normalized = normalizeText(transcript);
      const intent = parseVoiceIntent(transcript, parseContactName);

      if (intent.type === "activate_sos") {
        if (!sosActiveRef.current) {
          setSosActive(true);
          setVoiceStatus("Activando emergencia");
          void speakStatus("Activando emergencia");
        }
        return;
      }

      if (intent.type === "cancel_sos" && sosActiveRef.current) {
        cancelSOS();
        void speakStatus("Emergencia cancelada");
        return;
      }

      if (intent.type === "call") {
        const contact = await resolveContactByName(intent.contactName);
        if (contact) {
          pendingCallNameRef.current = null;
          await callContact(contact.phone, contact.name);
        } else if (isContactPickerSupported || canListDeviceContacts) {
          pendingCallNameRef.current = intent.contactName;
          const message = `No encontre a ${intent.contactName}. Toca Agregar para elegirlo o sincroniza contactos.`;
          setVoiceStatus(message);
          void speakStatus(message);
        } else {
          pendingCallNameRef.current = intent.contactName;
          setShowManualInput(true);
          const message = `No puedo leer tus contactos aqui. Ingresa el numero manualmente para ${intent.contactName}.`;
          setVoiceStatus(message);
          void speakStatus(message);
        }
        return;
      }

      if (intent.type === "search_contact") {
        if (intent.contactName) {
          const contact = await resolveContactByName(intent.contactName);
          if (contact) {
            const message = `Encontre a ${contact.name} con numero ${contact.phone}`;
            setVoiceStatus(message);
            void speakStatus(message);
          } else {
            const message = `No encontre a ${intent.contactName}.`;
            setVoiceStatus(message);
            void speakStatus(message);
          }
          return;
        }
        if (canListDeviceContacts) {
          await requestAndSyncContacts();
        } else if (isContactPickerSupported) {
          const message = "Toca Agregar para seleccionar un contacto.";
          setVoiceStatus(message);
          void speakStatus(message);
        } else {
          setShowManualInput(true);
          const message =
            "Este dispositivo no permite abrir contactos. Ingresa el numero manualmente.";
          setVoiceStatus(message);
          void speakStatus(message);
        }
        return;
      }

      if (intent.type === "add_contact") {
        if (intent.contactName) {
          const contact = await resolveContactByName(intent.contactName);
          if (contact) {
            saveContact({
              ...contact,
              relation: "Contacto de emergencia",
              isEmergency: false,
            });
            const message = `${contact.name} fue agregado como contacto de emergencia`;
            setVoiceStatus(message);
            void speakStatus(message);
          } else {
            const message = `No encontre a ${intent.contactName}. Toca Agregar para seleccionarlo manualmente.`;
            setVoiceStatus(message);
            void speakStatus(message);
          }
          return;
        }
        if (normalized.includes("sincroniza") && canListDeviceContacts) {
          await requestAndSyncContacts();
          return;
        }
        const message = canListDeviceContacts
          ? "Toca Permitir o Agregar para seleccionar un contacto del dispositivo."
          : "Toca Agregar para seleccionar un contacto.";
        setVoiceStatus(message);
        void speakStatus(message);
        return;
      }

      const helpMessage =
        "Puedes decir llama a mama, marca a Juan, agrega contacto o activa emergencia.";
      setVoiceStatus(helpMessage);
      void speakStatus(helpMessage);
    },
    [
      callContact,
      cancelSOS,
      canListDeviceContacts,
      isContactPickerSupported,
      parseContactName,
      requestAndSyncContacts,
      resolveContactByName,
      saveContact,
      speakStatus,
    ],
  );

  const {
    isBackgroundListening,
    isActive: voiceActive,
    isProcessing: voiceProcessing,
    transcript: userTranscript,
    error: voiceError,
    startBackgroundListening,
    resetActive,
  } = useVoiceActivation({
    wakeWords: [
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
    ],
    silenceTimeout: 4000,
    onActivation: () => {
      console.log("Wake word detected, activating microphone...");
      if (!isListeningRef.current && !isProcessingVoiceRef.current) {
        if (startVoiceListeningRef.current) {
          startVoiceListeningRef.current();
        }
      }
    },
    onSilence: (transcript: string) => {
      console.log("Silence detected, processing transcript:", transcript);
      if (isListeningRef.current) {
        if (executeVoiceCommandRef.current) {
          executeVoiceCommandRef.current(transcript);
        }
      }
    },
  });

  // executeVoiceCommand - analogo a executeSingleAnalysis en CameraView
  const executeVoiceCommand = useCallback(
    async (transcript?: string) => {
      if (isProcessingVoiceRef.current) {
        console.warn("Voice command already in progress, ignoring request");
        return;
      }
      isProcessingVoiceRef.current = true;
      setIsProcessingVoice(true);
      setIsListening(false);
      stopAudioListening();

      void speakStatus("Procesando");

      try {
        if (transcript?.trim()) {
          await handleVoiceCommand(transcript);
        } else {
          const message =
            "No escuche un comando. Puedes decir llama a mama o activa emergencia.";
          setVoiceStatus(message);
          void speakStatus(message);
        }
        resetActive();
      } catch (err: any) {
        console.error("Error processing voice command:", err);
        resetActive();
      } finally {
        isProcessingVoiceRef.current = false;
        setIsProcessingVoice(false);
      }
    },
    [handleVoiceCommand, resetActive, speakStatus, stopAudioListening],
  );

  // Ref assignments para callbacks seguros
  useEffect(() => {
    executeVoiceCommandRef.current = executeVoiceCommand;
  }, [executeVoiceCommand]);

  // startVoiceListening - mismo patron que CameraView
  const startVoiceListening = useCallback(async () => {
    const granted = await requestMicrophonePermission();
    if (granted) {
      setIsListening(true);
      startAudioListening();
      void speakStatus("Escuchando");
    }
  }, [requestMicrophonePermission, speakStatus, startAudioListening]);

  useEffect(() => {
    startVoiceListeningRef.current = startVoiceListening;
  }, [startVoiceListening]);

  // Iniciar escucha en background al montar
  useEffect(() => {
    // Pequeño delay para asegurar inicialización correcta
    setTimeout(() => startBackgroundListening(), 500);
    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

  // Sincronizar contactos cuando hay permiso
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

  // Log transcripts
  useEffect(() => {
    if (userTranscript) {
      console.log("[Voice Transcript]", userTranscript);
    }
  }, [userTranscript]);

  // handleMicPress - mismo patron de 3 estados que CameraView
  const handleMicPress = useCallback(async () => {
    clearContactPickerError();
    setShowManualInput(false);

    // Estado 1: Procesando -> CANCELAR
    if (isProcessingVoice) {
      window.speechSynthesis.cancel();
      isProcessingVoiceRef.current = false;
      setIsProcessingVoice(false);
      resetActive();
      void speakStatus("Cancelando");
      return;
    }

    // Estado 2: Escuchando -> DETENER Y PROCESAR
    if (isListening) {
      stopAudioListening();
      setIsListening(false);
      await executeVoiceCommand();
      return;
    }

    // Estado 3: Idle -> INICIAR ESCUCHA
    const granted = await requestMicrophonePermission();
    if (granted) {
      setIsListening(true);
      startAudioListening();
      void speakStatus("Escuchando, toca para procesar");
    }
  }, [
    clearContactPickerError,
    executeVoiceCommand,
    isListening,
    isProcessingVoice,
    requestMicrophonePermission,
    resetActive,
    speakStatus,
    startAudioListening,
    stopAudioListening,
  ]);

  const handleEnableContacts = useCallback(async () => {
    clearContactPickerError();
    await requestAndSyncContacts();
  }, [clearContactPickerError, requestAndSyncContacts]);

  const handleRefreshContacts = useCallback(async () => {
    clearContactPickerError();
    const refreshed = await refreshDeviceContacts();
    const message =
      refreshed.length > 0
        ? `Actualice ${refreshed.length} contactos del dispositivo`
        : "No encontre contactos para sincronizar";
    setVoiceStatus(message);
  }, [clearContactPickerError, refreshDeviceContacts]);

  const handleAddContactManual = useCallback(async () => {
    clearContactPickerError();
    const contact = await pickContact();
    if (!contact) {
      if (!isContactPickerSupported && !canListDeviceContacts) {
        setShowManualInput(true);
      }
      return;
    }
    setVoiceStatus(`Contacto ${contact.name} agregado`);
    void speakStatus(`Contacto ${contact.name} agregado`);
    if (pendingCallNameRef.current) {
      pendingCallNameRef.current = null;
      await callContact(contact.phone, contact.name);
    }
  }, [
    callContact,
    canListDeviceContacts,
    clearContactPickerError,
    isContactPickerSupported,
    pickContact,
    speakStatus,
  ]);

  const handleManualCall = useCallback(async () => {
    if (!manualPhone.trim()) return;
    pendingCallNameRef.current = null;
    await callContact(manualPhone, "ese numero");
    setManualPhone("");
    setShowManualInput(false);
  }, [callContact, manualPhone]);

  return (
    <>
      <AppHeader />

      <div
        className="flex flex-col flex-1 overflow-y-auto pb-16"
        style={{ background: "#F8FAFC" }}
      >
        <AnimatePresence>
          {(voiceStatus || contactPickerError) && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mx-5 mt-3"
            >
              <div
                className={`rounded-xl px-4 py-2.5 text-center ${
                  contactPickerError
                    ? "border border-red-200 bg-red-50"
                    : "border border-blue-200 bg-blue-50"
                }`}
              >
                <p
                  style={{ fontSize: "12px" }}
                  className={
                    contactPickerError ? "text-red-600" : "text-blue-700"
                  }
                >
                  {contactPickerError || voiceStatus}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex flex-col items-center px-5 pb-4 pt-8">
          <div className="relative mb-3 flex items-center justify-center">
            {sosActive && (
              <>
                <motion.div
                  className="absolute h-36 w-36 rounded-full"
                  style={{ background: "rgba(239,68,68,0.15)" }}
                  animate={{ scale: [1, 1.3, 1] }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                />
                <motion.div
                  className="absolute h-44 w-44 rounded-full"
                  style={{ background: "rgba(239,68,68,0.08)" }}
                  animate={{ scale: [1, 1.4, 1] }}
                  transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }}
                />
              </>
            )}

            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => !sosActive && setSosActive(true)}
              aria-label="Activar boton de emergencia SOS"
              aria-pressed={sosActive}
              className="relative flex h-28 w-28 flex-col items-center justify-center rounded-full focus:outline-none focus-visible:ring-4 focus-visible:ring-red-400"
              style={{
                background: sosActive
                  ? "linear-gradient(145deg, #EF4444, #DC2626)"
                  : "linear-gradient(145deg, #FEF2F2, #FEE2E2)",
                boxShadow: sosActive
                  ? "0 8px 32px rgba(239,68,68,0.5), inset 0 1px 0 rgba(255,255,255,0.2)"
                  : "8px 8px 20px #d1d9e0, -8px -8px 20px #ffffff",
              }}
            >
              <AlertTriangle
                size={32}
                strokeWidth={2.5}
                className={sosActive ? "text-white" : "text-red-500"}
              />
              <span
                style={{ fontSize: "13px", lineHeight: "1.2" }}
                className={`mt-1 font-bold ${sosActive ? "text-white" : "text-red-600"}`}
              >
                SOS
              </span>
            </motion.button>
          </div>

          <AnimatePresence mode="wait">
            {!sosActive ? (
              <motion.p
                key="idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={{ fontSize: "13px" }}
                className="text-center text-gray-500"
              >
                Toca el boton para enviar una senal de emergencia
              </motion.p>
            ) : countdown > 0 ? (
              <motion.div
                key="countdown"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-2"
              >
                <p
                  style={{ fontSize: "15px" }}
                  className="text-center font-medium text-red-600"
                >
                  Enviando alerta en{" "}
                  <span className="tabular-nums">{countdown}s</span>...
                </p>
                <button
                  onClick={cancelSOS}
                  className="flex items-center gap-1.5 rounded-full bg-gray-100 px-4 py-1.5 text-gray-600 transition-colors active:bg-gray-200"
                  style={{ fontSize: "12px" }}
                >
                  <X size={12} />
                  Cancelar
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="sent"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center gap-1"
              >
                <p
                  style={{ fontSize: "15px" }}
                  className="font-medium text-red-600"
                >
                  Alerta enviada
                </p>
                <p style={{ fontSize: "12px" }} className="text-gray-500">
                  Los servicios de emergencia han sido notificados
                </p>
                <button
                  onClick={cancelSOS}
                  className="mt-2 flex items-center gap-1.5 rounded-full bg-gray-100 px-4 py-1.5 text-gray-600"
                  style={{ fontSize: "12px" }}
                >
                  <X size={12} />
                  Cancelar alerta
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="mx-5 mb-4 flex gap-2">
          <div
            className={`flex flex-1 items-center gap-2 rounded-2xl border p-3 transition-colors ${locationShared ? "border-emerald-200 bg-emerald-50" : "border-gray-100 bg-white"}`}
          >
            <MapPin
              size={16}
              className={locationShared ? "text-emerald-600" : "text-gray-400"}
            />
            <div>
              <p
                style={{ fontSize: "10px" }}
                className={`font-medium uppercase tracking-wide ${locationShared ? "text-emerald-700" : "text-gray-400"}`}
              >
                Ubicacion
              </p>
              <p
                style={{ fontSize: "11px" }}
                className={
                  locationShared ? "text-emerald-600" : "text-gray-500"
                }
              >
                {locationShared ? "Compartida" : "Lista para enviar"}
              </p>
            </div>
          </div>
          <div
            className={`flex flex-1 items-center gap-2 rounded-2xl border p-3 transition-colors ${messageSent ? "border-emerald-200 bg-emerald-50" : "border-gray-100 bg-white"}`}
          >
            <MessageSquare
              size={16}
              className={messageSent ? "text-emerald-600" : "text-gray-400"}
            />
            <div>
              <p
                style={{ fontSize: "10px" }}
                className={`font-medium uppercase tracking-wide ${messageSent ? "text-emerald-700" : "text-gray-400"}`}
              >
                Mensaje
              </p>
              <p
                style={{ fontSize: "11px" }}
                className={messageSent ? "text-emerald-600" : "text-gray-500"}
              >
                {messageSent ? "Enviado" : "Listo"}
              </p>
            </div>
          </div>
        </div>

        {canListDeviceContacts && permissionStatus !== "granted" && (
          <div className="mx-5 mb-4 rounded-2xl border border-blue-200 bg-white p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100">
                <BookUser size={18} className="text-blue-600" />
              </div>
              <div className="min-w-0 flex-1">
                <p
                  style={{ fontSize: "13px" }}
                  className="font-medium text-slate-800"
                >
                  Permitir acceso a tus contactos
                </p>
                <p style={{ fontSize: "11px" }} className="text-gray-500">
                  Esto permite buscar contactos por voz y marcar
                  automaticamente.
                </p>
              </div>
              <button
                onClick={() => void handleEnableContacts()}
                disabled={isContactPickerLoading}
                className="rounded-full bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors active:bg-blue-700 disabled:opacity-50"
              >
                Permitir
              </button>
            </div>
          </div>
        )}

        <AnimatePresence>
          {showManualInput && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mx-5 mb-4 overflow-hidden"
            >
              <div className="rounded-2xl border border-gray-200 bg-white p-4">
                <p style={{ fontSize: "12px" }} className="mb-3 text-gray-600">
                  Ingresa el numero manualmente:
                </p>
                <div className="flex gap-2">
                  <input
                    type="tel"
                    value={manualPhone}
                    onChange={(event) => setManualPhone(event.target.value)}
                    placeholder="+57 310 123 4567"
                    className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    style={{ background: "#F8FAFC" }}
                  />
                  <button
                    onClick={() => void handleManualCall()}
                    disabled={!manualPhone.trim()}
                    className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors active:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Llamar
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mx-5 mb-4">
          <div className="mb-2 flex items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-2">
              <Shield size={13} className="text-slate-500" />
              <p
                style={{ fontSize: "11px" }}
                className="font-medium uppercase tracking-wider text-gray-400"
              >
                {deviceContacts.length > 0
                  ? "Contactos disponibles"
                  : "Contactos de emergencia"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {permissionStatus === "granted" && canListDeviceContacts && (
                <button
                  onClick={() => void handleRefreshContacts()}
                  disabled={isContactPickerLoading}
                  className="flex items-center gap-1 text-slate-500 transition-colors hover:text-slate-700 disabled:opacity-50"
                  style={{ fontSize: "11px" }}
                >
                  <RefreshCcw size={12} />
                  Actualizar
                </button>
              )}
              <button
                onClick={() => void handleAddContactManual()}
                disabled={isContactPickerLoading}
                className="flex items-center gap-1 text-blue-600 transition-colors hover:text-blue-700 disabled:opacity-50"
                style={{ fontSize: "11px" }}
              >
                <UserPlus size={12} />
                {canListDeviceContacts || isContactPickerSupported
                  ? "Agregar"
                  : "Manual"}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {contacts.map((contact) => (
              <motion.div
                key={contact.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className={`flex items-center gap-3 rounded-2xl border bg-white px-4 py-3 shadow-sm ${contact.isEmergency ? "border-red-100" : "border-gray-100"}`}
              >
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${contact.isEmergency ? "bg-red-100" : "bg-slate-100"}`}
                >
                  <span
                    style={{ fontSize: "12px" }}
                    className={`font-bold ${contact.isEmergency ? "text-red-600" : "text-slate-600"}`}
                  >
                    {contact.initials || getInitials(contact.name)}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    style={{ fontSize: "13px" }}
                    className="truncate font-medium text-slate-800"
                  >
                    {contact.name}
                  </p>
                  <p style={{ fontSize: "11px" }} className="text-gray-400">
                    {contact.relation || "Contacto"} · {contact.phone}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Llamar a ${contact.name}`}
                  onClick={() => void callContact(contact.phone, contact.name)}
                  className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${contact.isEmergency ? "bg-red-500 active:bg-red-600" : "bg-slate-900 active:bg-slate-700"}`}
                >
                  <Phone size={14} className="text-white" />
                </button>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Mic button - mismo patron de 3 estados que CameraView */}
        <div
          onClick={() => void handleMicPress()}
          className="flex flex-col fixed bottom-0 w-full items-center pb-6 pt-2 pointer-events-none"
        >
          <p
            style={{ fontSize: "12px" }}
            className="text-gray-400 mb-3 pointer-events-auto"
          >
            {isProcessingVoice
              ? "Procesando... Toca para cancelar"
              : isListening
                ? "Escuchando... Toca para procesar"
                : isBackgroundListening
                  ? "Di 'llama a mama' o toca para hablar"
                  : "Toca para habilitar comandos de voz"}
          </p>

          {/* Indicador de nivel de audio cuando escucha */}
          {isListening && (
            <div className="mb-2 bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5 flex items-center gap-2 pointer-events-none">
              <Mic size={12} className="text-blue-400" />
              <div className="w-16 h-1.5 bg-white/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-400 transition-all duration-100"
                  style={{ width: `${audioLevel * 100}%` }}
                />
              </div>
            </div>
          )}

          <motion.button
            whileTap={{ scale: 0.93 }}
            aria-label={
              isProcessingVoice
                ? "Cancelar procesamiento"
                : isListening
                  ? "Detener y procesar"
                  : "Activar microfono"
            }
            aria-pressed={isListening || isProcessingVoice}
            className="pointer-events-auto relative flex items-center justify-center rounded-full transition-all duration-200 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-400"
            style={{
              width: 72,
              height: 72,
              background: isProcessingVoice
                ? "linear-gradient(145deg, #F59E0B, #D97706)"
                : isListening
                  ? "linear-gradient(145deg, #3B82F6, #2563EB)"
                  : "#F1F5F9",
              boxShadow: isProcessingVoice
                ? "0 8px 24px rgba(245,158,11,0.45), inset 0 1px 0 rgba(255,255,255,0.2)"
                : isListening
                  ? "0 8px 24px rgba(59,130,246,0.45), inset 0 1px 0 rgba(255,255,255,0.2)"
                  : "8px 8px 16px #d1d9e0, -8px -8px 16px #ffffff",
            }}
          >
            {(isListening || isProcessingVoice) && (
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

            {isBackgroundListening && !isListening && !isProcessingVoice && (
              <div className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-white bg-green-400 animate-pulse" />
            )}

            {isProcessingVoice ? (
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="relative z-10"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : isListening ? (
              <MicOff
                size={28}
                className="text-white relative z-10"
                strokeWidth={2}
              />
            ) : (
              <Mic
                size={28}
                strokeWidth={2}
                style={{ color: "#1E3A5F" }}
                className="relative z-10"
              />
            )}
          </motion.button>
        </div>

        {(audioError || voiceError) && (
          <div className="mx-4 mt-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
            <p style={{ fontSize: "11px" }} className="text-red-600">
              {audioError || voiceError}
            </p>
          </div>
        )}
      </div>
      <TopNav />
    </>
  );
}
