import { motion, AnimatePresence } from "motion/react";
import { X, Volume2, Sparkles } from "lucide-react";

type FeedbackModalProps = {
  isOpen: boolean;
  onClose: () => void;
  feedback: string;
  onSpeak?: () => void;
  isLoading?: boolean;
};

export function FeedbackModal({
  isOpen,
  onClose,
  feedback,
  onSpeak,
  isLoading = false,
}: FeedbackModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: "spring", duration: 0.5 }}
            className="fixed inset-x-4 bottom-20 z-50 mx-auto max-w-md md:inset-10 md:mx-auto md:max-w-lg md:bottom-auto md:top-auto"
          >
            <div
              className="rounded-3xl shadow-2xl border border-white/20 overflow-hidden"
              style={{
                background: "linear-gradient(145deg, #ffffff 0%, #f8fafc 100%)",
              }}
            >
              {/* Header */}
              <div
                className="px-5 py-4 flex items-center justify-between"
                style={{
                  background:
                    "linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)",
                }}
              >
                <div className="flex items-center gap-2">
                  <Sparkles size={18} className="text-white" />
                  <h3 className="text-white font-semibold text-sm">
                    Análisis de Gemini AI
                  </h3>
                </div>
                <button
                  onClick={onClose}
                  className="w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
                  aria-label="Cerrar"
                >
                  <X size={14} className="text-white" />
                </button>
              </div>

              {/* Content */}
              <div className="p-5">
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-10 h-10 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      <p className="text-slate-600 text-sm">
                        Analizando con Gemini AI...
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Feedback text */}
                    <div className="bg-blue-50 rounded-2xl p-4 mb-4 border border-blue-100">
                      <p
                        className="text-slate-700 leading-relaxed"
                        style={{ fontSize: "14px", lineHeight: "1.6" }}
                      >
                        {feedback}
                      </p>
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2">
                      {onSpeak && (
                        <button
                          onClick={onSpeak}
                          className="flex-1 flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl px-4 py-2.5 transition-colors shadow-sm"
                          aria-label="Escuchar respuesta"
                        >
                          <Volume2 size={16} />
                          <span className="text-sm font-medium">Escuchar</span>
                        </button>
                      )}
                      <button
                        onClick={onClose}
                        className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl px-4 py-2.5 transition-colors font-medium text-sm"
                      >
                        Cerrar
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
