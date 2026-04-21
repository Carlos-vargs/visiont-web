type CornerMarkerConfig = {
  top?: string;
  left?: string;
  right?: string;
  bottom?: string;
  borderTop?: boolean;
  borderLeft?: boolean;
  borderRight?: boolean;
  borderBottom?: boolean;
};

const corners: CornerMarkerConfig[] = [
  { top: "8px", left: "8px", borderTop: true, borderLeft: true },
  { top: "8px", right: "8px", borderTop: true, borderRight: true },
  {
    bottom: "8px",
    left: "8px",
    borderBottom: true,
    borderLeft: true,
  },
  {
    bottom: "8px",
    right: "8px",
    borderBottom: true,
    borderRight: true,
  },
];

export function CornerMarkers() {
  return (
    <>
      {corners.map((corner, index) => {
        const {
          top,
          left,
          right,
          bottom,
          borderTop,
          borderLeft,
          borderRight,
          borderBottom,
        } = corner;

        return (
          <div
            key={index}
            className="absolute w-5 h-5"
            style={{
              ...(top !== undefined ? { top } : {}),
              ...(left !== undefined ? { left } : {}),
              ...(right !== undefined ? { right } : {}),
              ...(bottom !== undefined ? { bottom } : {}),
              borderColor: "rgba(59,130,246,0.8)",
              borderWidth: "2px",
              borderTopWidth: borderTop ? "2px" : "0",
              borderLeftWidth: borderLeft ? "2px" : "0",
              borderRightWidth: borderRight ? "2px" : "0",
              borderBottomWidth: borderBottom ? "2px" : "0",
              borderStyle: "solid",
            }}
          />
        );
      })}
    </>
  );
}
