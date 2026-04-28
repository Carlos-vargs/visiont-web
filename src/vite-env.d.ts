/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEBUG_SLACK_ENABLED?: string;
  readonly VITE_DEBUG_SLACK_ENDPOINT?: string;
  readonly VITE_DEBUG_SLACK_CAPTURE_IMAGES?: string;
  readonly VITE_ENVIRONMENT?: string;
  readonly VITE_GEMINI_API_KEY?: string;
  readonly VITE_GEMINI_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.css";
declare module "react-dom/client";

// ImageCapture API - not yet in default TypeScript lib
interface ImageCapture {
  track: MediaStreamTrack;
  getPhotoSettings(): Promise<{
    fillLightMode?: ("auto" | "off" | "flash")[];
    redEyeReduction?: boolean;
  }>;
  grabFrame(): Promise<ImageBitmap>;
  takePhoto(options?: {
    fillLightMode?: "auto" | "off" | "flash";
    redEyeReduction?: boolean;
    imageWidth?: number;
    imageHeight?: number;
  }): Promise<Blob>;
}

/*** Improved MediaTrackCapabilities for torch/flash support ***/
interface MediaTrackCapabilities {
  torch?: boolean | boolean[];
}

declare var ImageCapture: {
  prototype: ImageCapture;
  new(track: MediaStreamTrack): ImageCapture;
};

type VisionTNativeBridgeMethod = (payload?: Record<string, unknown>) => unknown;

interface VisionTNativeBridge {
  placeCall?: VisionTNativeBridgeMethod;
  pickContact?: VisionTNativeBridgeMethod;
  listContacts?: VisionTNativeBridgeMethod;
  requestContactsPermission?: VisionTNativeBridgeMethod;
  getContactsPermissionStatus?: VisionTNativeBridgeMethod;
}

interface Window {
  VisionTNativeBridge?: VisionTNativeBridge;
  webkit?: {
    messageHandlers?: {
      visiontNativeBridge?: {
        postMessage: (payload: unknown) => void;
      };
    };
  };
  __visiontNativeBridgeResolve?: (id: string, result?: unknown) => void;
  __visiontNativeBridgeReject?: (id: string, error?: unknown) => void;
}
