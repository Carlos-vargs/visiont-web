import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, X } from "lucide-react";

type SOSAlertPanelProps = {
  sosActive: boolean;
  countdown: number;
  onActivate: () => void;
  onCancel: () => void;
};

export function SOSAlertPanel({
  sosActive,
  countdown,
  onActivate,
  onCancel,
}: SOSAlertPanelProps) {
  return (
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
          onClick={() => !sosActive && onActivate()}
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
              Enviando alerta en <span className="tabular-nums">{countdown}s</span>
              ...
            </p>
            <button
              onClick={onCancel}
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
              onClick={onCancel}
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
  );
}
