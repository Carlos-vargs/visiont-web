import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSOSInteractionController } from "./useSOSInteractionController";

const createAudioMock = () =>
  ({
    isSpeaking: false,
    error: null,
    audioLevel: 0,
    inputStatus: "idle",
    transcript: "",
    hasKnownMicrophoneAccess: false,
    lastAudioError: null,
    startListening: vi.fn().mockResolvedValue(true),
    stopListening: vi.fn(),
    startManualRecognition: vi.fn(() => true),
    stopManualRecognition: vi.fn(() => ""),
    stopAllAudio: vi.fn(),
    resetRecognition: vi.fn(),
  }) as any;

const createOptions = (overrides: Record<string, unknown> = {}) => ({
  audio: createAudioMock(),
  processTranscript: vi.fn().mockResolvedValue(undefined),
  speakStatus: vi.fn().mockResolvedValue(undefined),
  onStatus: vi.fn(),
  onBeforeManualStart: vi.fn(),
  onCycleChange: vi.fn(),
  ...overrides,
});

describe("useSOSInteractionController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("speaks preparing feedback before opening recognition and input", async () => {
    const order: string[] = [];
    const audio = createAudioMock();
    const speakStatus = vi.fn(async (text: string) => {
      order.push(`speak:${text}`);
    });
    audio.startManualRecognition.mockImplementation(() => {
      order.push("recognition");
      return true;
    });
    audio.startListening.mockImplementation(async () => {
      order.push("input");
      return true;
    });

    const { result } = renderHook(() =>
      useSOSInteractionController(createOptions({ audio, speakStatus })),
    );

    await act(async () => {
      await result.current.handleMicPress();
    });

    expect(order).toEqual([
      "speak:Preparando micrófono",
      "recognition",
      "input",
    ]);
    expect(result.current.mode).toBe("listening");
    expect(result.current.statusMessage).toBe("Escuchando, toca para procesar");
  });

  it("second press stops listening and processes the captured transcript", async () => {
    const audio = createAudioMock();
    const processTranscript = vi.fn().mockResolvedValue(undefined);
    audio.stopManualRecognition.mockImplementation(() => "llama a mamá");

    const { result } = renderHook(() =>
      useSOSInteractionController(
        createOptions({ audio, processTranscript }),
      ),
    );

    await act(async () => {
      await result.current.handleMicPress();
    });

    await act(async () => {
      await result.current.handleMicPress();
    });

    expect(audio.stopManualRecognition).toHaveBeenCalledTimes(1);
    expect(audio.stopListening).toHaveBeenCalledTimes(1);
    expect(processTranscript).toHaveBeenCalledWith("llama a mamá", 2);
    expect(result.current.mode).toBe("idle");
  });

  it("manual button during processing cancels and remains stable", async () => {
    let resolveProcess: () => void = () => {};
    const processTranscript = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveProcess = resolve;
        }),
    );
    const audio = createAudioMock();
    audio.transcript = "llama a mama";

    const { result } = renderHook(() =>
      useSOSInteractionController(
        createOptions({ audio, processTranscript }),
      ),
    );

    await act(async () => {
      await result.current.handleMicPress();
    });

    await act(async () => {
      void result.current.handleMicPress();
      await Promise.resolve();
    });

    expect(result.current.mode).toBe("processing");

    await act(async () => {
      await result.current.handleMicPress();
    });

    expect(audio.stopAllAudio).toHaveBeenCalledWith(
      "sos-interaction-cancelled",
    );
    expect(result.current.mode).toBe("idle");

    await act(async () => {
      resolveProcess();
      await Promise.resolve();
    });

    expect(result.current.mode).toBe("idle");
  });

  it("reports unsupported recognition as a user-facing error", async () => {
    const audio = createAudioMock();
    audio.startManualRecognition.mockImplementation(() => false);
    audio.lastAudioError = "Reconocimiento de voz no soportado en este navegador.";

    const { result } = renderHook(() =>
      useSOSInteractionController(createOptions({ audio })),
    );

    await act(async () => {
      await result.current.handleMicPress();
    });

    expect(result.current.mode).toBe("error");
    expect(result.current.errorMessage).toBe(
      "Reconocimiento de voz no soportado en este navegador.",
    );
  });
});
