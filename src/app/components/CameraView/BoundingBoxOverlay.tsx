import { AnimatePresence, motion } from "motion/react";
import type { CameraDetectionBox } from "../../hooks/useCameraInteractionController";

type BoundingBoxItemProps = {
  box: CameraDetectionBox;
};

function BoundingBoxItem({ box }: BoundingBoxItemProps) {
  return (
    <motion.div
      key={box.id}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      className="absolute"
      style={{
        left: `${box.x}%`,
        top: `${box.y}%`,
        width: `${box.w}%`,
        height: `${box.h}%`,
      }}
    >
      <div
        className="absolute inset-0 rounded-lg"
        style={{
          border: "1.5px dashed rgba(96, 165, 250, 0.85)",
          boxShadow:
            "inset 0 0 8px rgba(59,130,246,0.1), 0 0 4px rgba(59,130,246,0.2)",
        }}
      />

      <div
        className="absolute -top-5 left-0 flex items-center gap-1 rounded-md px-1.5 py-0.5"
        style={{
          background: "rgba(15, 23, 42, 0.85)",
          backdropFilter: "blur(4px)",
        }}
      >
        <span
          className="text-blue-300 font-medium"
          style={{ fontSize: "9px", whiteSpace: "nowrap" }}
        >
          {box.label}
        </span>
        {box.distance && (
          <>
            <span className="w-px h-3 bg-slate-500" />
            <span className="text-emerald-400" style={{ fontSize: "9px" }}>
              {box.distance}
            </span>
          </>
        )}
      </div>

      {box.confidence >= 90 && (
        <div
          className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-400"
          style={{ boxShadow: "0 0 4px rgba(52,211,153,0.8)" }}
        />
      )}
    </motion.div>
  );
}

type BoundingBoxOverlayProps = {
  boxes: CameraDetectionBox[];
  visible: boolean;
};

export function BoundingBoxOverlay({
  boxes,
  visible,
}: BoundingBoxOverlayProps) {
  if (!visible || boxes.length === 0) {
    return null;
  }

  return (
    <AnimatePresence>
      {boxes.map((box) => (
        <BoundingBoxItem key={box.id} box={box} />
      ))}
    </AnimatePresence>
  );
}
