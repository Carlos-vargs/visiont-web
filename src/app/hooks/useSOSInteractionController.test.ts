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
    isBackgroundListening: true,
    startListening: vi.fn().mockResolvedValue(true),
    stopListening: vi.fn(),
    startManualRecognition: vi.fn(() => true),
    stopManualRecognition: vi.fn(() => ""),
    stopAllAudio: vi.fn(),
    resetRecognition: vi.fn(),
    startBackgroundRecognition: vi.fn(),
  }) as any;

const createOptions = (overrides: Record<string, unknown> = {}) => ({
  audio: createAudioMock(),
  wakeWords: ["ayuda"],
  processTranscript: vi.fn().mockResolvedValue(undefined),
  speakStatus: vi.fn().mockResolvedValue(undefined),
  onStatus: vi.fn(),
  onBeforeManualStart: vi.fn(),
  onCycleChange: vi.fn(),
  ...overrides,
});

describe("useSOSInteractionController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  it("starts wake word background recognition once on mount", async () => {
    const audio = createAudioMock();

    renderHook(() => useSOSInteractionController(createOptions({ audio })));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(audio.startBackgroundRecognition).toHaveBeenCalledTimes(1);
  });

  it("does not create duplicate listening sessions from repeated wake activation", async () => {
    const audio = createAudioMock();
    let recognitionOptions: any;
    audio.startBackgroundRecognition.mockImplementation((options: any) => {
      recognitionOptions = options;
    });

    renderHook(() => useSOSInteractionController(createOptions({ audio })));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      recognitionOptions.onActivation();
      recognitionOptions.onActivation();
    });

    expect(audio.startListening).toHaveBeenCalledTimes(1);
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
    expect(result.current.mode).toBe("listening");

    await act(async () => {
      void result.current.handleMicPress();
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
});
