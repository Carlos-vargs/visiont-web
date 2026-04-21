import { Mic, MicOff } from "lucide-react";
import { motion } from "motion/react";

export type MicButtonMode =
  | "idle"
  | "listening"
  | "analyzing"
  | "cancelling";

type MicButtonProps = {
  mode: MicButtonMode;
  disabled?: boolean;
  onPress: () => void;
};

export function MicButton({
  mode,
  disabled = false,
  onPress,
}: MicButtonProps) {
  const isListening = mode === "listening";
  const isAnalyzing = mode === "analyzing" || mode === "cancelling";
  const isCancelling = mode === "cancelling";

  return (
    <motion.button
      whileTap={{ scale: 0.93 }}
      onClick={onPress}
      aria-label={
        isCancelling
          ? "Cancelando"
          : isAnalyzing
            ? "Cancelar análisis"
            : isListening
              ? "Detener y analizar"
              : "Activar micrófono"
      }
      aria-pressed={isListening || isAnalyzing}
      disabled={disabled}
      className="relative flex items-center justify-center rounded-full transition-all duration-200 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-400"
      style={{
        width: 80,
        height: 80,
        background: isAnalyzing
          ? "linear-gradient(145deg, #F59E0B, #D97706)"
          : isListening
            ? "linear-gradient(145deg, #3B82F6, #2563EB)"
            : "#F1F5F9",
        boxShadow: isAnalyzing
          ? "0 8px 24px rgba(245,158,11,0.45), inset 0 1px 0 rgba(255,255,255,0.2)"
          : isListening
            ? "0 8px 24px rgba(59,130,246,0.45), inset 0 1px 0 rgba(255,255,255,0.2)"
            : "8px 8px 16px #d1d9e0, -8px -8px 16px #ffffff",
      }}
    >
      {(isAnalyzing || isListening) && (
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

      {isAnalyzing ? (
        <svg
          width="30"
          height="30"
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
        <MicOff size={30} className="text-white relative z-10" strokeWidth={2} />
      ) : (
        <Mic
          size={30}
          strokeWidth={2}
          style={{ color: "#1E3A5F" }}
          className="relative z-10"
        />
      )}
    </motion.button>
  );
}
