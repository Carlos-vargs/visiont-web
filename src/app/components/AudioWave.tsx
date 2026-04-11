import { useEffect, useRef } from "react";

interface AudioWaveProps {
  isActive: boolean;
  color?: string;
}

export function AudioWave({ isActive, color = "#1E3A5F" }: AudioWaveProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const timeRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = (timestamp: number) => {
      timeRef.current = timestamp;
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      const amplitude = isActive ? height * 0.35 : height * 0.06;
      const centerY = height / 2;

      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      // Add glow
      ctx.shadowBlur = isActive ? 8 : 0;
      ctx.shadowColor = color;

      const points = 200;
      for (let i = 0; i <= points; i++) {
        const x = (i / points) * width;
        const t = timestamp / 800;
        const y =
          centerY +
          amplitude * Math.sin(i * 0.12 + t) * 0.6 +
          amplitude * Math.sin(i * 0.07 - t * 1.3) * 0.3 +
          amplitude * Math.sin(i * 0.2 + t * 0.7) * 0.1;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Second wave - lighter
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 1.5;
      ctx.shadowBlur = 0;

      for (let i = 0; i <= points; i++) {
        const x = (i / points) * width;
        const t = timestamp / 600;
        const y =
          centerY +
          amplitude * Math.sin(i * 0.09 - t * 0.8) * 0.7 +
          amplitude * Math.sin(i * 0.15 + t * 1.1) * 0.3;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      animFrameRef.current = requestAnimationFrame(draw);
    };

    animFrameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isActive, color]);

  return (
    <canvas
      ref={canvasRef}
      width={320}
      height={80}
      className="w-full"
      style={{ height: "80px" }}
    />
  );
}
