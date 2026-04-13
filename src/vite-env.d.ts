/// <reference types="vite/client" />

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

declare var ImageCapture: {
  prototype: ImageCapture;
  new(track: MediaStreamTrack): ImageCapture;
};
