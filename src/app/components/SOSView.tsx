import { useState, useEffect } from "react";
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
} from "lucide-react";

const contacts = [
  {
    id: 1,
    name: "María García",
    relation: "Familiar",
    phone: "+34 612 345 678",
    initials: "MG",
  },
  {
    id: 2,
    name: "Cruz Roja",
    relation: "Emergencias",
    phone: "112",
    initials: "CR",
    isEmergency: true,
  },
  {
    id: 3,
    name: "Dr. Rodríguez",
    relation: "Médico",
    phone: "+34 698 765 432",
    initials: "DR",
  },
];

export function SOSView() {
  const [sosActive, setSosActive] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const [locationShared, setLocationShared] = useState(false);
  const [messageSent, setMessageSent] = useState(false);

  useEffect(() => {
    if (!sosActive) {
      setCountdown(5);
      return;
    }
    if (countdown <= 0) {
      setLocationShared(true);
      setMessageSent(true);
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [sosActive, countdown]);

  const cancelSOS = () => {
    setSosActive(false);
    setLocationShared(false);
    setMessageSent(false);
    setCountdown(5);
  };

  return (
    <>
      <AppHeader />

      <div
        className="flex flex-col flex-1 overflow-y-auto pb-20"
        style={{ background: "#F8FAFC" }}
      >
        {/* SOS Main Button */}
        <div className="flex flex-col items-center pt-6 pb-4 px-5">
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
                className={`font-bold mt-1 ${sosActive ? "text-white" : "text-red-600"}`}
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

        {/* Contacts */}
        <div className="mx-5 mb-4">
          <div className="flex items-center gap-2 mb-2 px-1">
            <Shield size={13} className="text-slate-500" />
            <p
              style={{ fontSize: "11px" }}
              className="text-gray-400 uppercase tracking-wider font-medium"
            >
              Contactos de emergencia
            </p>
          </div>
          <div className="flex flex-col gap-2">
            {contacts.map((contact) => (
              <div
                key={contact.id}
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
                    {contact.initials}
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
                  className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                    contact.isEmergency
                      ? "bg-red-500 active:bg-red-600"
                      : "bg-slate-900 active:bg-slate-700"
                  }`}
                >
                  <Phone size={14} className="text-white" />
                </a>
              </div>
            ))}
          </div>
        </div>
      </div>
      <TopNav />
    </>
  );
}
