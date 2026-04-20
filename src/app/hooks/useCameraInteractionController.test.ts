import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCameraInteractionController } from "./useCameraInteractionController";

const createAudio = () => ({
  isListening: false,
  isSpeaking: false,
  error: null,
  permissionGranted: false,
  permissionStatus: "unknown",
  hasKnownMicrophoneAccess: false,
  audioLevel: 0,
  inputStatus: "idle",
  recognitionStatus: "idle",
  speechStatus: "idle",
  lastAudioError: null,
  transcript: "",
  isRecognitionSupported: true,
  isManualListening: false,
  isBackgroundListening: false,
  isVoiceActive: false,
  isVoiceProcessing: false,
  startListening: vi.fn().mockResolvedValue(true),
  stopListening: vi.fn(),
  startManualRecognition: vi.fn().mockReturnValue(true),
  stopManualRecognition: vi.fn().mockReturnValue(""),
  startBackgroundRecognition: vi.fn(),
  stopBackgroundRecognition: vi.fn(),
  pauseRecognition: vi.fn(),
  resumeRecognition: vi.fn(),
  resetRecognition: vi.fn(),
  stopAllAudio: vi.fn(),
  playAudioChunk: vi.fn(),
  speakText: vi.fn().mockResolvedValue(undefined),
  cancelSpeech: vi.fn(),
});

const createController = (audio = createAudio()) => {
  const captureFrame = vi.fn(() => "image-base64");
  const sendImageWithPrompt = vi.fn().mockResolvedValue({
    feedback: "La mochila es azul",
    detections: [
      {
        label: "mochila",
        distance: "1 metro",
        confidence: 95,
        x: 50,
        y: 50,
        w: 20,
        h: 20,
      },
    ],
  });
  const cancelActiveRequest = vi.fn();

  const hook = renderHook(() =>
    useCameraInteractionController({
      audio: audio as any,
      captureFrame,
      sendImageWithPrompt,
      cancelActiveRequest,
    }),
  );

  return { ...hook, audio, captureFrame, sendImageWithPrompt, cancelActiveRequest };
};

describe("useCameraInteractionController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts manual listening on the first click", async () => {
    const { result, audio } = createController();

    await act(async () => {
      await result.current.handleMicPress();
    });

    expect(audio.startManualRecognition).toHaveBeenCalledTimes(1);
    expect(audio.startListening).toHaveBeenCalledTimes(1);
    expect(result.current.mode).toBe("listening");
  });

  it("speaks preparing feedback before opening recognition and input", async () => {
    const order: string[] = [];
    const audio = createAudio();
    audio.speakText.mockImplementation(async (text: string) => {
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
    const { result } = createController(audio);

    await act(async () => {
      await result.current.handleMicPress();
    });

    expect(order).toEqual([
      "speak:Preparando micrófono",
      "recognition",
      "input",
    ]);
  });

  it("does not open the microphone if preparing is cancelled", async () => {
    let resolvePreparing: () => void = () => {};
    const audio = createAudio();
    audio.speakText.mockImplementation((text: string) => {
      if (text === "Preparando micrófono") {
        return new Promise<void>((resolve) => {
          resolvePreparing = resolve;
        });
      }
      return Promise.resolve();
    });
    const { result } = createController(audio);

    let startPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      startPromise = result.current.handleMicPress();
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.cancelCurrentInteraction();
      resolvePreparing();
      await startPromise;
    });

    expect(audio.startManualRecognition).not.toHaveBeenCalled();
    expect(audio.startListening).not.toHaveBeenCalled();
  });

  it("stops listening and analyzes with the captured transcript", async () => {
    const { result, audio, sendImageWithPrompt } = createController();
    audio.stopManualRecognition.mockReturnValue("de que color es la mochila");

    await act(async () => {
      await result.current.handleMicPress();
    });

    await act(async () => {
      await result.current.handleMicPress();
    });

    expect(audio.stopListening).toHaveBeenCalled();
    expect(sendImageWithPrompt).toHaveBeenCalledWith(
      "image-base64",
      expect.stringContaining('Solicitud del usuario: "de que color es la mochila"'),
    );
    expect(result.current.activeBoxes).toHaveLength(1);
  });

  it("cancels an active analysis and does not restart listening", async () => {
    let resolveAnalysis: (value: any) => void = () => {};
    const audio = createAudio();
    audio.stopManualRecognition.mockReturnValue("analiza esto");
    const { result, sendImageWithPrompt, cancelActiveRequest } =
      createController(audio);

    sendImageWithPrompt.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAnalysis = resolve;
        }),
    );

    await act(async () => {
      await result.current.handleMicPress();
    });

    let analysisPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      analysisPromise = result.current.handleMicPress();
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.mode).toBe("analyzing"));

    await act(async () => {
      await result.current.handleMicPress();
    });

    expect(cancelActiveRequest).toHaveBeenCalled();
    expect(audio.stopAllAudio).toHaveBeenCalledWith("camera-interaction-cancelled");
    expect(result.current.mode).toBe("idle");

    await act(async () => {
      resolveAnalysis({ feedback: "respuesta vieja", detections: [] });
      await analysisPromise;
    });

    expect(result.current.activeBoxes).toHaveLength(0);
    expect(audio.startManualRecognition).toHaveBeenCalledTimes(1);
  });

  it("keeps listening without a fake audio level when the input stream fails", async () => {
    const audio = createAudio();
    audio.startListening.mockResolvedValue(false);
    audio.inputStatus = "blocked";
    const { result } = createController(audio);

    await act(async () => {
      await result.current.handleMicPress();
    });

    expect(result.current.mode).toBe("listening");
    expect(result.current.hasRealAudioLevel).toBe(false);
    expect(result.current.audioLevel).toBe(0);
  });
});
