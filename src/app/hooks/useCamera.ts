import { useState, useRef, useCallback, useEffect, useMemo } from "react";

type CameraOptions = {
  width?: number;
  height?: number;
  facingMode?: "user" | "environment";
  frameRate?: number;
};

export function useCamera(options: CameraOptions = {}) {
  const {
    width = 640,
    height = 480,
    facingMode = "environment",
    frameRate = 30,
  } = options;

  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionGranted, setPermissionGranted] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  
  // Store options in a ref to avoid recreation
  const optionsRef = useRef({ width, height, facingMode, frameRate });
  optionsRef.current = { width, height, facingMode, frameRate };

  const startCamera = useCallback(async () => {
    const { width, height, facingMode, frameRate } = optionsRef.current;
    
    try {
      setError(null);
      console.log("[useCamera] startCamera called");

      // Verificar permisos
      let permissionState = "unknown";
      try {
        const permissionStatus = await navigator.permissions.query({
          name: "camera" as PermissionName,
        });
        permissionState = permissionStatus.state;
        console.log("[useCamera] permissions.query result:", permissionState);
        setPermissionGranted(permissionState === "granted");
      } catch (err) {
        console.warn("[useCamera] navigator.permissions.query NOT SUPPORTED or failed.", err);
        // Continua el flujo, este método no es confiable en todos los navegadores
      }

      console.log("[useCamera] About to call getUserMedia; current permissionGranted:", permissionState);
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: width },
            height: { ideal: height },
            facingMode,
            frameRate: { ideal: frameRate },
          },
          audio: false,
        });
        console.log("[useCamera] getUserMedia success. stream:", stream);
      } catch (err) {
        console.error("[useCamera] getUserMedia failed:", err);
        throw err;
      }

      streamRef.current = stream;

      if (videoRef.current) {
        console.log("[useCamera] Assigning stream to videoRef.");
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        console.log("[useCamera] videoRef after play():", videoRef.current, videoRef.current.srcObject);
      } else {
        console.warn("[useCamera] videoRef.current is null when assigning stream!");
      }

      setIsActive(true);
      setPermissionGranted(true);
      console.log("[useCamera] startCamera finished. isActive:", true, "permissionGranted:", true);
    } catch (err: any) {
      const errorMsg =
        err.name === "NotAllowedError"
          ? "Permiso de cámara denegado. Habilita el acceso en la configuración del navegador."
          : err.name === "NotFoundError"
          ? "No se encontró una cámara en este dispositivo."
          : `Error al acceder a la cámara: ${err.message}`;
      console.error("[useCamera] startCamera error:", errorMsg, err);
      setError(errorMsg);
      setIsActive(false);
      setPermissionGranted(false);
    }
  }, []); // Empty deps - uses optionsRef.current

  const stopCamera = useCallback(() => {
    console.log("[useCamera] stopCamera called");
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      console.log("[useCamera] Camera stream stopped");
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      console.log("[useCamera] videoRef.srcObject set to null");
    }
    setIsActive(false);
  }, []);

  const captureFrame = useCallback((): string | null => {
    if (!videoRef.current) {
      return null;
    }

    const video = videoRef.current;

    // Crear canvas temporal si no existe
    if (!canvasRef.current) {
      canvasRef.current = document.createElement("canvas");
    }

    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }

    // Dibujar frame actual
    ctx.drawImage(video, 0, 0);

    // Convertir a base64 JPEG
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    // Remover el prefijo "data:image/jpeg;base64,"
    const base64 = dataUrl.split(",")[1];

    return base64;
  }, []);

  const captureFrameAtIntervals = useCallback(
    (
      onFrame: (frameBase64: string) => void,
      intervalMs: number = 2000
    ): (() => void) => {
      const intervalId = setInterval(() => {
        const frame = captureFrame();
        if (frame) {
          onFrame(frame);
        }
      }, intervalMs);

      // Retornar función de limpieza
      return () => clearInterval(intervalId);
    },
    [captureFrame]
  );

const requestCameraPermission = useCallback(async () => {
  try {
    console.log("[useCamera] requestCameraPermission called");
    // Intentar obtener acceso a la cámara
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
    });
    
    // Detener inmediatamente después de obtener permiso
    stream.getTracks().forEach((track) => track.stop());
    setPermissionGranted(true);
    console.log("[useCamera] requestCameraPermission success - permission granted");
    return true;
  } catch (err) {
    setPermissionGranted(false);
    console.error("[useCamera] requestCameraPermission failed", err);
    return false;
  }
}, []);

  // Cleanup al desmontar
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  console.log('[useCamera] Hook return:', {isActive, error, permissionGranted, videoRef, streamRef, video: videoRef.current});
  
  // Memoize the return value to prevent unnecessary re-renders
  return useMemo(() => ({
    isActive,
    error,
    permissionGranted,
    videoRef,
    startCamera,
    stopCamera,
    captureFrame,
    captureFrameAtIntervals,
    requestCameraPermission,
  }), [isActive, error, permissionGranted, startCamera, stopCamera, captureFrame, captureFrameAtIntervals, requestCameraPermission]);
}
