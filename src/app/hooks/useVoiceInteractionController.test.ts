import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useVoiceInteractionController } from "./useVoiceInteractionController";

const createAudioMock = () =>
  ({
    isSpeaking: false,
    error: null,
    audioLevel: 0,
    inputStatus: "idle",
    hasKnownMicrophoneAccess: false,
    lastAudioError: null,
    startListening: vi.fn().mockResolvedValue(true),
    stopListening: vi.fn(),
    stopAllAudio: vi.fn(),
    speakText: vi.fn().mockResolvedValue(undefined),
  }) as any;

const createOptions = (overrides: Record<string, unknown> = {}) => ({
  audio: createAudioMock(),
  geminiLoading: false,
  geminiError: null,
  cameraError: null,
  cameraPreview: null,
  showCamera: false,
  captureFrame: vi.fn(() => "frame"),
  captureFrameData: vi.fn(() => ({
    base64: "frame",
    width: 1280,
    height: 720,
    mimeType: "image/jpeg" as const,
  })),
  startCamera: vi.fn().mockResolvedValue(undefined),
  stopCamera: vi.fn(),
  setCameraPreview: vi.fn(),
  setShowCamera: vi.fn(),
  sendTextMessage: vi.fn().mockResolvedValue("respuesta"),
  sendImageWithPrompt: vi.fn().mockResolvedValue({ feedback: "imagen" }),
  cancelActiveRequest: vi.fn(),
  ...overrides,
});

describe("useVoiceInteractionController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deduplicates rapid mic starts", async () => {
    let resolveStart: (value: boolean) => void = () => {};
    const audio = createAudioMock();
    audio.startListening.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveStart = resolve;
        }),
    );

    const { result } = renderHook(() =>
      useVoiceInteractionController(createOptions({ audio })),
    );

    const first = result.current.handleMicPress();
    const second = result.current.handleMicPress();

    await waitFor(() => expect(audio.startListening).toHaveBeenCalledTimes(1));

    await act(async () => {
      resolveStart(true);
      await Promise.all([first, second]);
    });

    expect(result.current.mode).toBe("listening");
  });

  it("speaks preparing feedback before opening input", async () => {
    const order: string[] = [];
    const audio = createAudioMock();
    audio.speakText.mockImplementation(async (text: string) => {
      order.push(`speak:${text}`);
    });
    audio.startListening.mockImplementation(async () => {
      order.push("input");
      return true;
    });

    const { result } = renderHook(() =>
      useVoiceInteractionController(createOptions({ audio })),
    );

    await act(async () => {
      await result.current.handleMicPress();
    });

    expect(order).toEqual(["speak:Preparando micrófono", "input"]);
  });

  it("cancels loading work and ignores the stale response", async () => {
    let resolveMessage: (value: string) => void = () => {};
    const sendTextMessage = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveMessage = resolve;
        }),
    );
    const audio = createAudioMock();

    const { result } = renderHook(() =>
      useVoiceInteractionController(
        createOptions({ audio, sendTextMessage, geminiLoading: true }),
      ),
    );

    await act(async () => {
      void result.current.handleQuickAction("Hola");
    });

    expect(result.current.mode).toBe("loading");

    await act(async () => {
      await result.current.handleMicPress();
    });

    expect(audio.stopAllAudio).toHaveBeenCalledWith(
      "voice-interaction-cancelled",
    );
    expect(result.current.mode).toBe("listening");

    await act(async () => {
      resolveMessage("respuesta vieja");
      await Promise.resolve();
    });

    expect(result.current.messages.some((msg) => msg.text === "respuesta vieja"))
      .toBe(false);
  });

  it("falls back visually when the stream cannot open", async () => {
    const audio = createAudioMock();
    audio.startListening.mockResolvedValue(false);
    audio.lastAudioError = "No pude abrir el microfono.";

    const { result } = renderHook(() =>
      useVoiceInteractionController(createOptions({ audio })),
    );

    await act(async () => {
      await result.current.handleMicPress();
    });

    await waitFor(() => expect(result.current.mode).toBe("error"));
    expect(result.current.errorMessage).toContain("No pude abrir");
  });
});
