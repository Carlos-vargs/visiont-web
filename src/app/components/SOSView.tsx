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
} from "lucide-react";
import { useVoiceActivation } from "../hooks/useVoiceActivation";

// Types
export type Contact = {
  id: string;
  name: string;
  phone: string;
  relation?: string;
  initials?: string;
  isEmergency?: boolean;
};

// Initial hardcoded emergency contacts
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

// Helper: Generate initials from name
const getInitials = (name: string): string => {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
};

export function SOSView() {
  // SOS State
  const [sosActive, setSosActive] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const [locationShared, setLocationShared] = useState(false);
  const [messageSent, setMessageSent] = useState(false);

  // Contacts State
  const [contacts, setContacts] = useState<Contact[]>(initialContacts);
  const [isContactPickerLoading, setIsContactPickerLoading] = useState(false);
  const [contactPickerError, setContactPickerError] = useState<string | null>(
    null,
  );
  const [manualPhone, setManualPhone] = useState("");

  // Voice State
  const [isListening, setIsListening] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<string>("");
  const [showManualInput, setShowManualInput] = useState(false);

  // Refs
  const isSpeakingRef = useRef(false);
  const contactsRef = useRef<Contact[]>(contacts);
  const sosActiveRef = useRef(sosActive);

  // Update refs
  useEffect(() => {
    contactsRef.current = contacts;
  }, [contacts]);

  useEffect(() => {
    sosActiveRef.current = sosActive;
  }, [sosActive]);

  // Load saved contacts from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem("sos-contacts");
      if (stored) {
        const parsed: Contact[] = JSON.parse(stored);
        // Merge with initial contacts, avoiding duplicates by phone
        const merged = [
          ...initialContacts,
          ...parsed.filter(
            (c) => !initialContacts.some((ic) => ic.phone === c.phone),
          ),
        ];
        setContacts(merged);
      }
    } catch (err) {
      console.warn("Error loading saved contacts:", err);
    }
  }, []);

  // Save contacts to localStorage whenever they change
  useEffect(() => {
    try {
      const toSave = contacts.filter((c) => !c.isEmergency);
      localStorage.setItem("sos-contacts", JSON.stringify(toSave));
    } catch (err) {
      console.warn("Error saving contacts:", err);
    }
  }, [contacts]);

  // SOS Countdown Logic
  useEffect(() => {
    if (!sosActive) {
      setCountdown(5);
      return;
    }
    if (countdown <= 0) {
      setLocationShared(true);
      setMessageSent(true);
      speakFeedback("Alerta de emergencia enviada. Ayuda en camino.");
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [sosActive, countdown]);

  // Voice Activation Hook
  const {
    isBackgroundListening,
    isActive: voiceActive,
    transcript: userTranscript,
    error: voiceError,
    startBackgroundListening,
    stopBackgroundListening,
    resetActive,
  } = useVoiceActivation({
    wakeWords: [
      "ayuda",
      "emergencia",
      "sos",
      "llamar a",
      "buscar contacto",
      "contacto",
    ],
    silenceTimeout: 3000,
    onActivation: () => {
      console.log("Wake word detected in SOSView");
      setVoiceStatus("Escuchando comando...");
    },
    onSilence: (transcript: string) => {
      console.log("Processing voice command:", transcript);
      handleVoiceCommand(transcript);
      resetActive();
    },
  });

  // Start background listening on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      startBackgroundListening();
    }, 1000);
    return () => {
      clearTimeout(timer);
      stopBackgroundListening();
    };
  }, []);

  // Log transcript for debugging
  useEffect(() => {
    if (userTranscript && !voiceActive) {
      console.log("[SOS Voice]", userTranscript);
    }
  }, [userTranscript, voiceActive]);

  // Speak feedback using Web Speech API
  const speakFeedback = useCallback((text: string) => {
    if (isSpeakingRef.current) return;

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "es-ES";
      utterance.rate = 0.9;

      utterance.onstart = () => {
        isSpeakingRef.current = true;
      };
      utterance.onend = () => {
        isSpeakingRef.current = false;
      };
      utterance.onerror = () => {
        isSpeakingRef.current = false;
      };

      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn("Speech synthesis error:", err);
      isSpeakingRef.current = false;
    }
  }, []);

  // Parse voice command and extract contact name
  const parseContactName = useCallback((transcript: string): string | null => {
    const lower = transcript.toLowerCase().trim();

    const patterns = [
      /llamar\s+a\s+(.+)/i,
      /buscar\s+contacto\s+(.+)/i,
      /contacto\s+(.+)/i,
      /emergencia\s+(.+)/i,
    ];

    for (const pattern of patterns) {
      const match = lower.match(pattern);
      if (match && match[1]?.trim()) {
        return match[1].trim();
      }
    }

    if (lower.includes("emergencia") || lower.includes("ayuda")) {
      return "emergency";
    }

    return null;
  }, []);

  // Find contact by name (fuzzy match)
  const findContactByName = useCallback((name: string): Contact | undefined => {
    const lowerName = name.toLowerCase();
    return contactsRef.current.find((c) =>
      c.name.toLowerCase().includes(lowerName),
    );
  }, []);

  // Initiate call using tel: protocol
  const callContact = useCallback((phone: string, name: string) => {
    if (!phone) {
      speakFeedback("No hay número disponible para este contacto");
      return;
    }
    speakFeedback(`Llamando a ${name}`);
    const cleanPhone = phone.replace(/[^\d+]/g, "");
    setTimeout(() => {
      window.location.href = `tel:${cleanPhone}`;
    }, 1500);
  }, []);

  // Open native Contact Picker API (requires user gesture)
  const pickContact = useCallback(async (): Promise<Contact | null> => {
    // Check if API is supported
    if (!("ContactPicker" in window)) {
      const msg = "Función no disponible en este dispositivo";
      setContactPickerError(msg);
      speakFeedback("La selección de contactos no está disponible");
      setShowManualInput(true);
      return null;
    }

    try {
      setIsContactPickerLoading(true);
      setContactPickerError(null);

      const props = ["name", "tel"] as const;
      const opts = {
        multiple: false,
        hint: "Selecciona un contacto de emergencia",
      };

      // @ts-ignore - ContactPicker is not in TypeScript DOM types yet
      const selected = await navigator.contacts.select(props, opts);

      if (selected && selected[0]) {
        const newContact: Contact = {
          id: crypto.randomUUID(),
          name: selected[0].name || "Contacto desconocido",
          phone: selected[0].tel?.[0] || "",
          relation: "Contacto de emergencia",
          initials: getInitials(selected[0].name || ""),
          isEmergency: false,
        };

        // Add to contacts list if not already present
        const exists = contactsRef.current.some(
          (c) => c.phone === newContact.phone,
        );
        if (!exists) {
          setContacts((prev) => [...prev, newContact]);
        }

        speakFeedback(`Contacto ${newContact.name} agregado`);
        return newContact;
      }
      return null;
    } catch (err: any) {
      if (err.name === "AbortError") {
        // User cancelled, no error
        return null;
      }
      const msg = `Error: ${err.message}`;
      setContactPickerError(msg);
      speakFeedback("No se pudo acceder a los contactos");
      setShowManualInput(true);
      return null;
    } finally {
      setIsContactPickerLoading(false);
    }
  }, []);

  // Handle voice command logic
  const handleVoiceCommand = useCallback(
    async (transcript: string) => {
      const command = transcript.toLowerCase().trim();
      const contactName = parseContactName(transcript);

      // Emergency SOS activation
      if (contactName === "emergency" || command.includes("activar sos")) {
        if (!sosActiveRef.current) {
          speakFeedback("Activando emergencia");
          setSosActive(true);
        }
        return;
      }

      // Call contact by name
      if (contactName && command.includes("llamar")) {
        const contact = findContactByName(contactName);
        if (contact) {
          speakFeedback(`Llamando a ${contact.name}`);
          callContact(contact.phone, contact.name);
        } else {
          speakFeedback(
            `No encontré a ${contactName}. Toca el botón para agregarlo`,
          );
          setVoiceStatus(`"${contactName}" no está en tus contactos`);
          // Auto-trigger contact picker after short delay (requires user gesture context)
          setTimeout(() => {
            setVoiceStatus("Toca el micrófono para seleccionar el contacto");
          }, 2000);
        }
        return;
      }

      // Search/add contact
      if (command.includes("buscar contacto") || command.includes("agregar")) {
        speakFeedback("Selecciona el contacto en la lista");
        setVoiceStatus("Toca el botón de contacto para seleccionar");
        return;
      }

      // Cancel SOS
      if (command.includes("cancelar") && sosActiveRef.current) {
        cancelSOS();
        speakFeedback("Emergencia cancelada");
        return;
      }

      // Default: show available commands
      speakFeedback(
        "Puedes decir: llamar a [nombre], buscar contacto, o activar emergencia",
      );
    },
    [parseContactName, findContactByName, callContact],
  );

  // Cancel SOS
  const cancelSOS = () => {
    setSosActive(false);
    setLocationShared(false);
    setMessageSent(false);
    setCountdown(5);
    setVoiceStatus("");
  };

  // Mic button handler
  const handleMicPress = useCallback(async () => {
    // If currently processing voice, stop
    if (voiceActive) {
      stopBackgroundListening();
      setIsListening(false);
      setVoiceStatus("");
      return;
    }

    // Start manual listening mode
    setIsListening(true);
    setVoiceStatus("Habla ahora...");

    // For manual mode, we rely on the background listener's onSilence callback
    // The hook handles the actual recognition
  }, [voiceActive, stopBackgroundListening]);

  // Handle manual contact addition
  const handleAddContactManual = useCallback(async () => {
    const contact = await pickContact();
    if (contact) {
      // Auto-call if user just added and command was to call
      if (voiceStatus.includes("llamar")) {
        callContact(contact.phone, contact.name);
      }
    }
  }, [pickContact, callContact, voiceStatus]);

  // Handle manual phone input
  const handleManualCall = useCallback(() => {
    if (!manualPhone) return;
    speakFeedback("Realizando llamada");
    const cleanPhone = manualPhone.replace(/[^\d+]/g, "");
    setTimeout(() => {
      window.location.href = `tel:${cleanPhone}`;
    }, 1000);
    setManualPhone("");
    setShowManualInput(false);
  }, [manualPhone]);

  // Check if Contact Picker API is supported
  const isContactPickerSupported = "ContactPicker" in window;

  return (
    <>
      <AppHeader />

      <div
        className="flex flex-col flex-1 overflow-y-auto pb-16"
        style={{ background: "#F8FAFC" }}
      >
        {/* Voice Status Indicator */}
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
                    ? "bg-red-50 border border-red-200"
                    : "bg-blue-50 border border-blue-200"
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

        {/* SOS Main Button */}
        <div className="flex flex-col items-center pt-8 pb-4 px-5">
          <div className="relative flex items-center justify-center mb-3">
            {sosActive && (
              <>
                <motion.div
                  className="absolute w-36 h-36 rounded-full"
                  style={{ background: "rgba(239,68,68,0.15)" }}
                  animate={{ scale: [1, 1.3, 1] }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                />
                <motion.div
                  className="absolute w-44 h-44 rounded-full"
                  style={{ background: "rgba(239,68,68,0.08)" }}
                  animate={{ scale: [1, 1.4, 1] }}
                  transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }}
                />
              </>
            )}

            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => !sosActive && setSosActive(true)}
              aria-label="Activar botón de emergencia SOS"
              aria-pressed={sosActive}
              className="relative w-28 h-28 rounded-full flex flex-col items-center justify-center focus:outline-none focus-visible:ring-4 focus-visible:ring-red-400"
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
                className={`font-bold mt-1 ${
                  sosActive ? "text-white" : "text-red-600"
                }`}
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
                className="text-gray-500 text-center"
              >
                Toca el botón para enviar una señal de emergencia
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
                  className="text-red-600 font-medium text-center"
                >
                  Enviando alerta en{" "}
                  <span className="tabular-nums">{countdown}s</span>...
                </p>
                <button
                  onClick={cancelSOS}
                  className="flex items-center gap-1.5 bg-gray-100 rounded-full px-4 py-1.5 text-gray-600 active:bg-gray-200 transition-colors"
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
                  className="text-red-600 font-medium"
                >
                  ¡Alerta enviada!
                </p>
                <p style={{ fontSize: "12px" }} className="text-gray-500">
                  Los servicios de emergencia han sido notificados
                </p>
                <button
                  onClick={cancelSOS}
                  className="mt-2 flex items-center gap-1.5 bg-gray-100 rounded-full px-4 py-1.5 text-gray-600"
                  style={{ fontSize: "12px" }}
                >
                  <X size={12} />
                  Cancelar alerta
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Status cards */}
        <div className="mx-5 flex gap-2 mb-4">
          <div
            className={`flex-1 rounded-2xl p-3 flex items-center gap-2 border transition-colors ${
              locationShared
                ? "bg-emerald-50 border-emerald-200"
                : "bg-white border-gray-100"
            }`}
          >
            <MapPin
              size={16}
              className={locationShared ? "text-emerald-600" : "text-gray-400"}
            />
            <div>
              <p
                style={{ fontSize: "10px" }}
                className={`uppercase tracking-wide font-medium ${
                  locationShared ? "text-emerald-700" : "text-gray-400"
                }`}
              >
                Ubicación
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
            className={`flex-1 rounded-2xl p-3 flex items-center gap-2 border transition-colors ${
              messageSent
                ? "bg-emerald-50 border-emerald-200"
                : "bg-white border-gray-100"
            }`}
          >
            <MessageSquare
              size={16}
              className={messageSent ? "text-emerald-600" : "text-gray-400"}
            />
            <div>
              <p
                style={{ fontSize: "10px" }}
                className={`uppercase tracking-wide font-medium ${
                  messageSent ? "text-emerald-700" : "text-gray-400"
                }`}
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

        {/* Manual Input Fallback */}
        <AnimatePresence>
          {showManualInput && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mx-5 mb-4 overflow-hidden"
            >
              <div className="bg-white rounded-2xl p-4 border border-gray-200">
                <p style={{ fontSize: "12px" }} className="text-gray-600 mb-3">
                  Ingresa el número manualmente:
                </p>
                <div className="flex gap-2">
                  <input
                    type="tel"
                    value={manualPhone}
                    onChange={(e) => setManualPhone(e.target.value)}
                    placeholder="+56 9 1234 5678"
                    className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    style={{ background: "#F8FAFC" }}
                  />
                  <button
                    onClick={handleManualCall}
                    disabled={!manualPhone}
                    className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed active:bg-blue-700 transition-colors"
                  >
                    Llamar
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Contacts List */}
        <div className="mx-5 mb-4">
          <div className="flex items-center justify-between mb-2 px-1">
            <div className="flex items-center gap-2">
              <Shield size={13} className="text-slate-500" />
              <p
                style={{ fontSize: "11px" }}
                className="text-gray-400 uppercase tracking-wider font-medium"
              >
                Contactos de emergencia
              </p>
            </div>

            {/* Add Contact Button - only if API supported */}
            {isContactPickerSupported && (
              <button
                onClick={handleAddContactManual}
                disabled={isContactPickerLoading}
                className="flex items-center gap-1 text-blue-600 hover:text-blue-700 disabled:opacity-50"
                style={{ fontSize: "11px" }}
              >
                <UserPlus size={12} />
                Agregar
              </button>
            )}
          </div>

          <div className="flex flex-col gap-2">
            {contacts.map((contact) => (
              <motion.div
                key={contact.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className={`bg-white rounded-2xl px-4 py-3 flex items-center gap-3 shadow-sm border ${
                  contact.isEmergency ? "border-red-100" : "border-gray-100"
                }`}
              >
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                    contact.isEmergency ? "bg-red-100" : "bg-slate-100"
                  }`}
                >
                  <span
                    style={{ fontSize: "12px" }}
                    className={`font-bold ${
                      contact.isEmergency ? "text-red-600" : "text-slate-600"
                    }`}
                  >
                    {contact.initials || getInitials(contact.name)}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    style={{ fontSize: "13px" }}
                    className="text-slate-800 font-medium truncate"
                  >
                    {contact.name}
                  </p>
                  <p style={{ fontSize: "11px" }} className="text-gray-400">
                    {contact.relation} · {contact.phone}
                  </p>
                </div>
                <a
                  href={`tel:${contact.phone}`}
                  aria-label={`Llamar a ${contact.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    speakFeedback(`Llamando a ${contact.name}`);
                  }}
                  className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                    contact.isEmergency
                      ? "bg-red-500 active:bg-red-600"
                      : "bg-slate-900 active:bg-slate-700"
                  }`}
                >
                  <Phone size={14} className="text-white" />
                </a>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Mic Button - Fixed at bottom */}
        <div className="fixed bottom-0 left-0 right-0 flex flex-col items-center pb-6 pt-2 pointer-events-none">
          <p
            style={{ fontSize: "12px" }}
            className="text-gray-400 mb-3 pointer-events-auto"
          >
            {voiceActive
              ? "Procesando..."
              : isListening
                ? "Habla ahora..."
                : isBackgroundListening
                  ? "Di 'emergencia' o toca para hablar"
                  : "Toca para usar comandos de voz"}
          </p>

          {/* Neumorphic Mic Button */}
          <motion.button
            whileTap={{ scale: 0.93 }}
            onClick={handleMicPress}
            aria-label={
              voiceActive || isListening
                ? "Detener escucha"
                : "Activar comando de voz"
            }
            aria-pressed={isListening || voiceActive}
            className="relative flex items-center justify-center rounded-full transition-all duration-200 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-400 pointer-events-auto"
            style={{
              width: 72,
              height: 72,
              background:
                voiceActive || isListening
                  ? "linear-gradient(145deg, #3B82F6, #2563EB)"
                  : "#F1F5F9",
              boxShadow:
                voiceActive || isListening
                  ? "0 8px 24px rgba(59,130,246,0.45), inset 0 1px 0 rgba(255,255,255,0.2)"
                  : "8px 8px 16px #d1d9e0, -8px -8px 16px #ffffff",
            }}
          >
            {/* Pulse animation when active */}
            {(voiceActive || isListening) && (
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

            {/* Background listening indicator */}
            {isBackgroundListening && !voiceActive && !isListening && (
              <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-green-400 border-2 border-white animate-pulse" />
            )}

            {voiceActive || isListening ? (
              <MicOff size={28} className="text-white relative z-10" />
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

        {/* Error Toast */}
        <AnimatePresence>
          {voiceError && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="fixed bottom-24 left-5 right-5"
            >
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <p style={{ fontSize: "12px" }} className="text-red-600">
                  {voiceError}
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
