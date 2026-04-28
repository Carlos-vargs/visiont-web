import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { sendDebugEvent, serializeError } from "../lib/debugTelemetry";

type CameraOptions = {
  width?: number;
  height?: number;
  facingMode?: "user" | "environment";
  frameRate?: number;
};

export type CapturedFrame = {
  base64: string;
  width: number;
  height: number;
  mimeType: "image/jpeg";
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
  const [flashAvailable, setFlashAvailable] = useState(false);
  const [flashOn, setFlashOn] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageCaptureRef = useRef<ImageCapture | null>(null);
  
  // Store options in a ref to avoid recreation
  const optionsRef = useRef({ width, height, facingMode, frameRate });
  optionsRef.current = { width, height, facingMode, frameRate };

  const startCamera = useCallback(async () => {
    const { width, height, facingMode, frameRate } = optionsRef.current;

    try {
      setError(null);

      // Verificar permisos
      let permissionState = "unknown";
      try {
        const permissionStatus = await navigator.permissions.query({
          name: "camera" as PermissionName,
        });
        permissionState = permissionStatus.state;
        setPermissionGranted(permissionState === "granted");
      } catch (err) {
        // Continua el flujo, este método no es confiable en todos los navegadores
      }

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
      } catch (err) {
        console.error("[useCamera] getUserMedia failed:", err);
        throw err;
      }

      streamRef.current = stream;
      let hasTorch = false;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        // Initialize ImageCapture for flash control
         const videoTrack = stream.getVideoTracks()[0];
         if (videoTrack && typeof ImageCapture !== "undefined") {
           imageCaptureRef.current = new ImageCapture(videoTrack);

           // Correctly check if torch (flash) is available (live video flash)
           const capabilities = videoTrack.getCapabilities() as any;
           hasTorch = "torch" in capabilities &&
            (Array.isArray(capabilities.torch)
              ? capabilities.torch.includes(true)
              : !!capabilities.torch);
          setFlashAvailable(hasTorch);
        }
      } else {
        console.warn("[useCamera] videoRef.current is null when assigning stream! Video element must be rendered in DOM.");
      }

      setIsActive(true);
      setPermissionGranted(true);
      sendDebugEvent({
        type: "camera.started",
        source: "useCamera",
        message: "Camera started",
        payload: {
          width,
          height,
          facingMode,
          frameRate,
          flashAvailable: hasTorch,
        },
      });
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
      sendDebugEvent({
        type: "camera.start_error",
        source: "useCamera",
        level: "error",
        message: errorMsg,
        payload: serializeError(err),
      });
    }
  }, []); // Empty deps - uses optionsRef.current

  const stopCamera = useCallback(() => {
    if (streamRef.current || isActive) {
      sendDebugEvent({
        type: "camera.stopped",
        source: "useCamera",
        message: "Camera stopped",
      });
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    imageCaptureRef.current = null;
    setIsActive(false);
    setFlashAvailable(false);
    setFlashOn(false);
  }, [isActive]);

  // Toggle flash on/off
  const toggleFlash = useCallback(async () => {
    if (!imageCaptureRef.current) {
      console.warn("[useCamera] ImageCapture not available, cannot toggle flash");
      return false;
    }

    try {
      const videoTrack = streamRef.current?.getVideoTracks()[0];
      if (!videoTrack) return false;

      const newFlashState = !flashOn;

      // Method 1: Apply torch constraint directly to the video track
      const capabilities = videoTrack.getCapabilities() as any;
      if ("torch" in capabilities) {
        await videoTrack.applyConstraints({
          advanced: [{ torch: newFlashState } as any],
        });
        setFlashOn(newFlashState);
        sendDebugEvent({
          type: "camera.flash_toggled",
          source: "useCamera",
          message: "Camera flash toggled",
          payload: { flashOn: newFlashState },
        });
        return newFlashState;
      }

      // Method 2: Try ImageCapture (less reliable for continuous torch)
      console.warn("[useCamera] Torch constraint not supported on this device");
      return false;
    } catch (err) {
      console.error("[useCamera] Error toggling flash:", err);
      sendDebugEvent({
        type: "camera.flash_error",
        source: "useCamera",
        level: "error",
        message: "Error toggling flash",
        payload: serializeError(err),
      });
      return false;
    }
  }, [flashOn]);

  const captureFrameData = useCallback((): CapturedFrame | null => {
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

    return {
      base64,
      width: canvas.width,
      height: canvas.height,
      mimeType: "image/jpeg",
    };
  }, []);

  const captureFrame = useCallback((): string | null => {
    return captureFrameData()?.base64 || null;
  }, [captureFrameData]);

  const captureFrameAtIntervals = useCallback(
    (
      onFrame: (frameBase64: string) => void,
      intervalMs: number = 2000
    ): (() => void) => {
      const intervalId = setInterval(() => {
        const frame = captureFrameData();
        if (frame) {
          onFrame(frame.base64);
        }
      }, intervalMs);

      // Retornar función de limpieza
      return () => clearInterval(intervalId);
    },
    [captureFrameData]
  );

  const requestCameraPermission = useCallback(async () => {
    try {
      // Intentar obtener acceso a la cámara
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
      });

      // Detener inmediatamente después de obtener permiso
      stream.getTracks().forEach((track) => track.stop());
      setPermissionGranted(true);
      return true;
    } catch (err) {
      setPermissionGranted(false);
      return false;
    }
  }, []);

  // Cleanup al desmontar
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  // Memoize the return value to prevent unnecessary re-renders
  return useMemo(() => ({
    isActive,
    error,
    permissionGranted,
    flashAvailable,
    flashOn,
    videoRef,
    startCamera,
    stopCamera,
    toggleFlash,
    captureFrame,
    captureFrameData,
    captureFrameAtIntervals,
    requestCameraPermission,
  }), [isActive, error, permissionGranted, flashAvailable, flashOn, startCamera, stopCamera, toggleFlash, captureFrame, captureFrameData, captureFrameAtIntervals, requestCameraPermission]);
}
