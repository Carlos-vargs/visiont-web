import { AnimatePresence, motion } from "motion/react";

type ScanLineProps = {
  visible: boolean;
  progress: number;
};

export function ScanLine({ visible, progress }: ScanLineProps) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="absolute left-0 right-0 h-px z-10"
          style={{
            top: `${progress}%`,
            background:
              "linear-gradient(90deg, transparent, #3B82F6 20%, #60A5FA 50%, #3B82F6 80%, transparent)",
            boxShadow: "0 0 8px 2px rgba(59,130,246,0.6)",
          }}
        />
      )}
    </AnimatePresence>
  );
}
