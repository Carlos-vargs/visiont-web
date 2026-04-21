import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { CameraView } from "./CameraView";

const mockStartCamera = vi.fn();
const mockStopCamera = vi.fn();
const mockToggleFlash = vi.fn();
const mockHandleMicPress = vi.fn();
const mockCleanup = vi.fn();

const mockCameraState = {
  isActive: true,
  error: null as string | null,
  flashAvailable: true,
  flashOn: false,
  videoRef: createRef<HTMLVideoElement>(),
  startCamera: mockStartCamera,
  stopCamera: mockStopCamera,
  toggleFlash: mockToggleFlash,
  captureFrame: vi.fn(() => "frame"),
};

const mockAudioState = {
  lastAudioError: null as string | null,
  error: null as string | null,
};

const mockGeminiState = {
  error: null as string | null,
  sendImageWithPrompt: vi.fn(),
  cancelActiveRequest: vi.fn(),
};

const mockControllerState = {
  mode: "idle" as
    | "idle"
    | "starting"
    | "listening"
    | "analyzing"
    | "speaking"
    | "cancelling"
    | "error",
  transcript: "",
  audioLevel: 0.5,
  hasRealAudioLevel: true,
  statusMessage: "Toca para hablar",
  errorMessage: null as string | null,
  activeBoxes: [] as Array<{
    id: number;
    label: string;
    distance: string;
    confidence: number;
    x: number;
    y: number;
    w: number;
    h: number;
  }>,
  handleMicPress: mockHandleMicPress,
  cleanup: mockCleanup,
};

vi.mock("../AppHeader", () => ({
  AppHeader: () => <div data-testid="app-header" />,
}));

vi.mock("../../hooks/useCamera", () => ({
  useCamera: () => mockCameraState,
}));

vi.mock("../../hooks/useAudio", () => ({
  useAudio: () => mockAudioState,
}));

vi.mock("../../hooks/useGemini", () => ({
  useGemini: () => mockGeminiState,
}));

vi.mock("../../hooks/useCameraInteractionController", () => ({
  useCameraInteractionController: () => mockControllerState,
}));

describe("CameraView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCameraState.isActive = true;
    mockCameraState.error = null;
    mockCameraState.flashAvailable = true;
    mockCameraState.flashOn = false;
    mockAudioState.lastAudioError = null;
    mockAudioState.error = null;
    mockGeminiState.error = null;
    mockControllerState.mode = "idle";
    mockControllerState.transcript = "";
    mockControllerState.audioLevel = 0.5;
    mockControllerState.hasRealAudioLevel = true;
    mockControllerState.statusMessage = "Toca para hablar";
    mockControllerState.errorMessage = null;
    mockControllerState.activeBoxes = [];
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the full-frame camera error overlay", () => {
    mockCameraState.isActive = false;
    mockCameraState.error = "Permiso de cámara denegado";

    render(<CameraView />);

    expect(screen.getAllByText("Permiso de cámara denegado")).toHaveLength(2);
  });

  it("renders audio indicator in real and fallback modes", () => {
    mockControllerState.mode = "listening";
    const { rerender } = render(<CameraView />);

    expect(screen.getByText("Toca para hablar")).toBeInTheDocument();
    expect(screen.getByLabelText("Detener y analizar")).toBeInTheDocument();

    mockControllerState.hasRealAudioLevel = false;
    rerender(<CameraView />);

    expect(screen.getAllByText("Escuchando").length).toBeGreaterThan(0);
  });

  it("renders bounding boxes only when the camera is active", () => {
    mockControllerState.activeBoxes = [
      {
        id: 1,
        label: "mochila",
        distance: "1 metro",
        confidence: 95,
        x: 10,
        y: 10,
        w: 20,
        h: 20,
      },
    ];
    const { rerender } = render(<CameraView />);

    expect(screen.getByText("mochila")).toBeInTheDocument();

    mockCameraState.isActive = false;
    rerender(<CameraView />);

    expect(screen.queryByText("mochila")).not.toBeInTheDocument();
  });

  it("keeps mic button wiring and camera controls working", () => {
    render(<CameraView />);

    fireEvent.click(screen.getByLabelText("Activar micrófono"));
    expect(mockHandleMicPress).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText("Encender linterna"));
    expect(mockToggleFlash).toHaveBeenCalledTimes(1);
  });

  it("shows transcript overlay in development when transcript exists", () => {
    mockControllerState.transcript = "¿Qué hay frente a mí?";

    render(<CameraView />);

    expect(screen.getByTestId("transcript-overlay")).toBeInTheDocument();
  });
});
