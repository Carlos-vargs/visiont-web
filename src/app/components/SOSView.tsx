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
    if (left.isEmergency && !right.isEmergency) {
      return -1;
    }
    if (!left.isEmergency && right.isEmergency) {
      return 1;
    }
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

  const isSpeakingRef = useRef(false);
  const contactsRef = useRef<Contact[]>(initialContacts);
  const sosActiveRef = useRef(sosActive);
  const pendingCallNameRef = useRef<string | null>(null);

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

  const contacts = mergeContacts(
    initialContacts,
    savedContacts,
    deviceContacts,
  );

  useEffect(() => {
    contactsRef.current = contacts;
  }, [contacts]);

  useEffect(() => {
    sosActiveRef.current = sosActive;
  }, [sosActive]);

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

    const timer = setTimeout(
      () => setCountdown((current) => current - 1),
      1000,
    );
    return () => clearTimeout(timer);
  }, [countdown, sosActive]);

  const speakFeedback = useCallback((text: string) => {
    if (isSpeakingRef.current) {
      window.speechSynthesis.cancel();
      isSpeakingRef.current = false;
    }

    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "es-ES";
      utterance.rate = 0.95;

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
    } catch (error) {
      console.warn("Speech synthesis error:", error);
      isSpeakingRef.current = false;
    }
  }, []);

  const {
    isBackgroundListening,
    isActive: voiceActive,
    isManualListening,
    isProcessing: voiceProcessing,
    transcript: userTranscript,
    error: voiceError,
    startBackgroundListening,
    stopBackgroundListening,
    startManualListening,
    submitActiveListening,
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
    silenceTimeout: 2600,
    onActivation: () => {
      setVoiceStatus("Escuchando comando...");
      clearContactPickerError();
    },
    onSilence: async (transcript: string) => {
      setVoiceStatus("Procesando comando...");
      await handleVoiceCommand(transcript);
    },
  });
  useEffect(() => {
    let isMounted = true;

    const enableBackgroundListeningIfPossible = async () => {
      try {
        if (!navigator.permissions?.query) {
          return;
        }

        const permission = await navigator.permissions.query({
          name: "microphone" as PermissionName,
        });

        if (!isMounted) {
          return;
        }

        if (permission.state === "granted") {
          startBackgroundListening();
          setVoiceStatus("");
        }
      } catch {
        // En algunos navegadores la Permissions API falla aunque el microfono
        // funcione al tocar el boton. No mostramos un aviso pasivo aqui.
      }
    };

    void enableBackgroundListeningIfPossible();

    return () => {
      isMounted = false;
      stopBackgroundListening();
    };
  }, [startBackgroundListening, stopBackgroundListening]);

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

  useEffect(() => {
    if (voiceActive && userTranscript) {
      setVoiceStatus(userTranscript);
    }
  }, [userTranscript, voiceActive]);

  useEffect(() => {
    if (voiceError) {
      setVoiceStatus(voiceError);
    }
  }, [voiceError]);

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
          ? `Sincronicé ${total} contactos del dispositivo`
          : "Permiso concedido, pero no encontré contactos";
      setVoiceStatus(message);
      speakFeedback(message);
      return result.contacts;
    }

    return [];
  }, [requestContactsAccess, speakFeedback]);

  const resolveContactByName = useCallback(
    async (contactName: string) => {
      let contact = findContactByName(contactName, contactsRef.current);
      if (contact) {
        return contact;
      }

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
        const message = "No hay número disponible para este contacto";
        setVoiceStatus(message);
        speakFeedback(message);
        setShowManualInput(true);
        return false;
      }

      const message = canAutoDial
        ? `Llamando automáticamente a ${name}`
        : `Abriendo la app del teléfono para llamar a ${name}`;

      setVoiceStatus(message);
      speakFeedback(message);
      return await triggerCall(phone, name);
    },
    [canAutoDial, speakFeedback, triggerCall],
  );

  const handleVoiceCommand = useCallback(
    async (transcript: string) => {
      const normalized = normalizeText(transcript);
      const intent = parseVoiceIntent(transcript, parseContactName);

      if (intent.type === "activate_sos") {
        if (!sosActiveRef.current) {
          setSosActive(true);
          setVoiceStatus("Activando emergencia");
          speakFeedback("Activando emergencia");
        }
        return;
      }

      if (intent.type === "cancel_sos" && sosActiveRef.current) {
        cancelSOS();
        speakFeedback("Emergencia cancelada");
        return;
      }

      if (intent.type === "call") {
        const contact = await resolveContactByName(intent.contactName);

        if (contact) {
          pendingCallNameRef.current = null;
          await callContact(contact.phone, contact.name);
        } else if (isContactPickerSupported || canListDeviceContacts) {
          pendingCallNameRef.current = intent.contactName;
          const message = `No encontré a ${intent.contactName}. Toca Agregar para elegirlo o sincroniza contactos.`;
          setVoiceStatus(message);
          speakFeedback(message);
        } else {
          pendingCallNameRef.current = intent.contactName;
          setShowManualInput(true);
          const message = `No puedo leer tus contactos aquí. Ingresa el número manualmente para ${intent.contactName}.`;
          setVoiceStatus(message);
          speakFeedback(message);
        }
        return;
      }

      if (intent.type === "search_contact") {
        if (intent.contactName) {
          const contact = await resolveContactByName(intent.contactName);
          if (contact) {
            const message = `Encontré a ${contact.name} con número ${contact.phone}`;
            setVoiceStatus(message);
            speakFeedback(message);
          } else {
            const message = `No encontré a ${intent.contactName}.`;
            setVoiceStatus(message);
            speakFeedback(message);
          }
          return;
        }

        if (canListDeviceContacts) {
          await requestAndSyncContacts();
        } else if (isContactPickerSupported) {
          const message = "Toca Agregar para seleccionar un contacto.";
          setVoiceStatus(message);
          speakFeedback(message);
        } else {
          setShowManualInput(true);
          const message =
            "Este dispositivo no permite abrir contactos. Ingresa el número manualmente.";
          setVoiceStatus(message);
          speakFeedback(message);
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
            speakFeedback(message);
          } else {
            const message = `No encontré a ${intent.contactName}. Toca Agregar para seleccionarlo manualmente.`;
            setVoiceStatus(message);
            speakFeedback(message);
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
        speakFeedback(message);
        return;
      }

      const helpMessage =
        "Puedes decir llama a mamá, marca a Juan, agrega contacto o activa emergencia.";
      setVoiceStatus(helpMessage);
      speakFeedback(helpMessage);
    },
    [
      callContact,
      canListDeviceContacts,
      cancelSOS,
      isContactPickerSupported,
      parseContactName,
      requestAndSyncContacts,
      resolveContactByName,
      saveContact,
      speakFeedback,
    ],
  );

  const handleMicPress = useCallback(async () => {
    clearContactPickerError();

    if (voiceActive) {
      setVoiceStatus("Procesando comando...");
      await submitActiveListening();
      return;
    }

    setShowManualInput(false);
    setVoiceStatus("Habla ahora...");
    const started = startManualListening();

    if (!started) {
      setVoiceStatus(
        "No pude activar el reconocimiento de voz. Revisa permisos del microfono.",
      );
    }
  }, [
    clearContactPickerError,
    startManualListening,
    submitActiveListening,
    voiceActive,
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
        ? `Actualicé ${refreshed.length} contactos del dispositivo`
        : "No encontré contactos para sincronizar";
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
    speakFeedback(`Contacto ${contact.name} agregado`);

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
    speakFeedback,
  ]);

  const handleManualCall = useCallback(async () => {
    if (!manualPhone.trim()) {
      return;
    }

    pendingCallNameRef.current = null;
    await callContact(manualPhone, "ese número");
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
              aria-label="Activar botón de emergencia SOS"
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
                  ¡Alerta enviada!
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
            className={`flex flex-1 items-center gap-2 rounded-2xl border p-3 transition-colors ${
              locationShared
                ? "border-emerald-200 bg-emerald-50"
                : "border-gray-100 bg-white"
            }`}
          >
            <MapPin
              size={16}
              className={locationShared ? "text-emerald-600" : "text-gray-400"}
            />
            <div>
              <p
                style={{ fontSize: "10px" }}
                className={`font-medium uppercase tracking-wide ${
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
            className={`flex flex-1 items-center gap-2 rounded-2xl border p-3 transition-colors ${
              messageSent
                ? "border-emerald-200 bg-emerald-50"
                : "border-gray-100 bg-white"
            }`}
          >
            <MessageSquare
              size={16}
              className={messageSent ? "text-emerald-600" : "text-gray-400"}
            />
            <div>
              <p
                style={{ fontSize: "10px" }}
                className={`font-medium uppercase tracking-wide ${
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
                  automáticamente.
                </p>
              </div>
              <button
                onClick={handleEnableContacts}
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
                  Ingresa el número manualmente:
                </p>
                <div className="flex gap-2">
                  <input
                    type="tel"
                    value={manualPhone}
                    onChange={(event) => setManualPhone(event.target.value)}
                    placeholder="+56 9 1234 5678"
                    className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    style={{ background: "#F8FAFC" }}
                  />
                  <button
                    onClick={() => {
                      void handleManualCall();
                    }}
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
                  onClick={handleRefreshContacts}
                  disabled={isContactPickerLoading}
                  className="flex items-center gap-1 text-slate-500 transition-colors hover:text-slate-700 disabled:opacity-50"
                  style={{ fontSize: "11px" }}
                >
                  <RefreshCcw size={12} />
                  Actualizar
                </button>
              )}
              <button
                onClick={() => {
                  void handleAddContactManual();
                }}
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
                className={`flex items-center gap-3 rounded-2xl border bg-white px-4 py-3 shadow-sm ${
                  contact.isEmergency ? "border-red-100" : "border-gray-100"
                }`}
              >
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
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
                  onClick={() => {
                    void callContact(contact.phone, contact.name);
                  }}
                  className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                    contact.isEmergency
                      ? "bg-red-500 active:bg-red-600"
                      : "bg-slate-900 active:bg-slate-700"
                  }`}
                >
                  <Phone size={14} className="text-white" />
                </button>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="pointer-events-none fixed bottom-0 left-0 right-0 flex flex-col items-center pb-6 pt-2">
          <p
            style={{ fontSize: "12px" }}
            className="pointer-events-auto mb-3 text-gray-400"
          >
            {voiceProcessing
              ? "Procesando..."
              : voiceActive
                ? "Escuchando... toca de nuevo para enviar"
                : isBackgroundListening
                  ? "Di 'llama a mamá' o toca para hablar"
                  : "Toca para habilitar comandos de voz"}
          </p>

          <motion.button
            whileTap={{ scale: 0.93 }}
            onClick={handleMicPress}
            aria-label={
              voiceActive || isManualListening
                ? "Enviar comando de voz"
                : "Activar comando de voz"
            }
            aria-pressed={voiceActive || isManualListening}
            className="pointer-events-auto relative flex items-center justify-center rounded-full transition-all duration-200 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-400"
            style={{
              width: 72,
              height: 72,
              background:
                voiceActive || isManualListening
                  ? "linear-gradient(145deg, #3B82F6, #2563EB)"
                  : "#F1F5F9",
              boxShadow:
                voiceActive || isManualListening
                  ? "0 8px 24px rgba(59,130,246,0.45), inset 0 1px 0 rgba(255,255,255,0.2)"
                  : "8px 8px 16px #d1d9e0, -8px -8px 16px #ffffff",
            }}
          >
            {(voiceActive || isManualListening) && (
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

            {isBackgroundListening && !voiceActive && !isManualListening && (
              <div className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-white bg-green-400 animate-pulse" />
            )}

            {voiceActive || isManualListening ? (
              <MicOff size={28} className="relative z-10 text-white" />
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

        <AnimatePresence>
          {voiceError && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="fixed bottom-24 left-5 right-5"
            >
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
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
