import { AnimatePresence, motion } from "motion/react";

type ManualPhoneInputProps = {
  visible: boolean;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
};

export function ManualPhoneInput({
  visible,
  value,
  onChange,
  onSubmit,
}: ManualPhoneInputProps) {
  return (
    <AnimatePresence>
      {visible && (
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
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder="+57 310 123 4567"
                className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                style={{ background: "#F8FAFC" }}
              />
              <button
                onClick={onSubmit}
                disabled={!value.trim()}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors active:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Llamar
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
