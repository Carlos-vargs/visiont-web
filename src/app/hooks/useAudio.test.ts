import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { sendDebugEventMock } = vi.hoisted(() => ({
  sendDebugEventMock: vi.fn(),
}));

vi.mock("../lib/debugTelemetry", () => ({
  sendDebugEvent: sendDebugEventMock,
  serializeError: (error: any) => ({
    name: error?.name,
    message: error?.message,
  }),
}));

import { useAudio } from "./useAudio";
import { createMockStream } from "../../test/setup";

const getUserMediaMock = () =>
  navigator.mediaDevices.getUserMedia as unknown as ReturnType<typeof vi.fn>;

const speechSynthesisMock = () =>
  window.speechSynthesis as unknown as {
    speak: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    getVoices: ReturnType<typeof vi.fn>;
  };

const setNavigatorUserAgent = (userAgent: string, maxTouchPoints = 0) => {
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: userAgent,
  });
  Object.defineProperty(navigator, "maxTouchPoints", {
    configurable: true,
    value: maxTouchPoints,
  });
};

const decodeBase64ToBytes = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

describe("useAudio", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    delete (window as any).SpeechRecognition;
    delete (window as any).webkitSpeechRecognition;
    window.localStorage.clear();
    getUserMediaMock().mockResolvedValue(createMockStream());
    speechSynthesisMock().speak.mockImplementation((utterance: any) => {
      setTimeout(() => utterance.onend?.(), 0);
    });
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
    setNavigatorUserAgent("Mozilla/5.0 (X11; Linux x86_64)", 0);
  });

  it("deduplicates rapid startListening calls", async () => {
    let resolveStream: (stream: MediaStream) => void = () => {};
    getUserMediaMock().mockImplementation(
      () =>
        new Promise<MediaStream>((resolve) => {
          resolveStream = resolve;
        }),
    );

    const { result } = renderHook(() => useAudio());

    const first = result.current.startListening();
    const second = result.current.startListening();

    await waitFor(() => expect(getUserMediaMock()).toHaveBeenCalledTimes(1));

    await act(async () => {
      resolveStream(createMockStream());
      await Promise.all([first, second]);
    });

    expect(result.current.inputStatus).toBe("active");
  });

  it("stopAllAudio releases the active microphone stream", async () => {
    const stop = vi.fn();
    getUserMediaMock().mockResolvedValue({
      getTracks: vi.fn(() => [{ stop }]),
    });

    const { result } = renderHook(() => useAudio());

    await act(async () => {
      await result.current.startListening();
    });

    act(() => {
      result.current.stopAllAudio("test");
    });

    expect(stop).toHaveBeenCalledTimes(1);
    expect(result.current.inputStatus).toBe("idle");
    expect(result.current.audioLevel).toBe(0);
  });

  it("does not retry NotAllowedError and marks input as blocked", async () => {
    const error = Object.assign(new Error("denied"), {
      name: "NotAllowedError",
    });
    getUserMediaMock().mockRejectedValue(error);

    const { result } = renderHook(() => useAudio());

    let started = true;
    await act(async () => {
      started = await result.current.startListening();
    });

    expect(started).toBe(false);
    expect(getUserMediaMock()).toHaveBeenCalledTimes(1);
    expect(result.current.inputStatus).toBe("blocked");
  });

  it("retries a transient microphone error once", async () => {
    const transient = Object.assign(new Error("busy"), {
      name: "NotReadableError",
    });
    getUserMediaMock()
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce(createMockStream());

    const { result } = renderHook(() => useAudio());

    let started = false;
    await act(async () => {
      started = await result.current.startListening();
    });

    expect(started).toBe(true);
    expect(getUserMediaMock()).toHaveBeenCalledTimes(2);
    expect(result.current.inputStatus).toBe("active");
  });

  it("starts manual audio capture on mobile and returns a wav payload", async () => {
    setNavigatorUserAgent(
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/147.0.0.0 Mobile Safari/537.36",
      5,
    );

    let workletNodeInstance: {
      port: { onmessage: ((event: MessageEvent) => void) | null };
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    } | null = null;

    class TrackingAudioWorkletNode {
      port = {
        postMessage: vi.fn(),
        onmessage: null as ((event: MessageEvent) => void) | null,
      };

      connect = vi.fn();
      disconnect = vi.fn();

      constructor() {
        workletNodeInstance = this;
      }
    }

    const originalWindowAudioWorkletNode = (window as any).AudioWorkletNode;
    const originalGlobalAudioWorkletNode = (globalThis as any).AudioWorkletNode;
    (window as any).AudioWorkletNode = TrackingAudioWorkletNode;
    (globalThis as any).AudioWorkletNode = TrackingAudioWorkletNode;

    const { result } = renderHook(() => useAudio({ sendSampleRate: 16000 }));

    let started = false;
    await act(async () => {
      started = await result.current.startManualAudioCapture();
    });

    expect(started).toBe(true);
    expect(result.current.manualVoiceInputMode).toBe("audio-capture");
    expect(result.current.inputStatus).toBe("active");

    act(() => {
      workletNodeInstance?.port.onmessage?.({
        data: {
          type: "audio-chunk",
          pcmData: new Int16Array([256, -256, 512, -512]).buffer,
          audioLevel: 0.72,
        },
      } as MessageEvent);
    });

    expect(result.current.audioLevel).toBe(0.72);

    type ManualCaptureResult = {
      mimeType: string;
      sampleRate: number;
      chunkCount: number;
      bytes: number;
      base64: string;
    } | null;

    let captured: ManualCaptureResult = null;
    await act(async () => {
      captured = (await result.current.stopManualAudioCapture()) as ManualCaptureResult;
    });

    expect(captured).not.toBeNull();
    expect(captured?.mimeType).toBe("audio/wav");
    expect(captured?.sampleRate).toBe(16000);
    expect(captured?.chunkCount).toBe(1);
    expect(captured?.bytes).toBeGreaterThan(44);
    expect(result.current.inputStatus).toBe("idle");
    expect(result.current.isManualListening).toBe(false);

    const wavBytes = decodeBase64ToBytes(captured!.base64);
    expect(String.fromCharCode(...wavBytes.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wavBytes.slice(8, 12))).toBe("WAVE");
    expect(sendDebugEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "audio.manual_capture_stopped",
      }),
    );

    (window as any).AudioWorkletNode = originalWindowAudioWorkletNode;
    (globalThis as any).AudioWorkletNode = originalGlobalAudioWorkletNode;
  });

  it("cancels manual audio capture without using SpeechRecognition", async () => {
    setNavigatorUserAgent(
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/147.0.0.0 Mobile Safari/537.36",
      5,
    );

    const speechRecognitionConstructor = vi.fn();
    (window as any).SpeechRecognition = speechRecognitionConstructor;

    const stop = vi.fn();
    getUserMediaMock().mockResolvedValue({
      getTracks: vi.fn(() => [{ stop }]),
      getAudioTracks: vi.fn(() => [{ stop }]),
    });

    const { result } = renderHook(() => useAudio());

    await act(async () => {
      await result.current.startManualAudioCapture();
    });

    act(() => {
      result.current.cancelManualAudioCapture();
    });

    expect(speechRecognitionConstructor).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalled();
    expect(result.current.inputStatus).toBe("idle");
    expect(sendDebugEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "audio.manual_capture_cancelled",
      }),
    );
  });

  it("resolves speech when speechSynthesis never emits onend", async () => {
    vi.useFakeTimers();
    speechSynthesisMock().speak.mockImplementation(() => {});

    const { result } = renderHook(() => useAudio());

    let spoken = false;
    let speechPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      speechPromise = result.current
        .speakText("Hola", { timeoutMs: 25 })
        .then(() => {
          spoken = true;
        });
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(25);
      await speechPromise;
    });

    expect(spoken).toBe(true);
    expect(speechSynthesisMock().cancel).toHaveBeenCalled();
    expect(result.current.speechStatus).toBe("idle");
  });

  it("speaks long responses in ordered chunks without showing playback error", async () => {
    const spokenTexts: string[] = [];
    speechSynthesisMock().speak.mockImplementation((utterance: any) => {
      spokenTexts.push(utterance.text);
      setTimeout(() => utterance.onend?.(), 0);
    });

    const { result } = renderHook(() => useAudio());
    const longText = [
      "Esta es una respuesta amplia para explicar lo que esta ocurriendo frente al usuario.",
      "La lectura debe avanzar por partes para que el navegador movil no corte toda la respuesta.",
      "Tambien debe conservar el orden exacto de las frases y terminar sin mostrar errores falsos.",
      "Cuando el texto es largo, cada fragmento tiene su propio tiempo de espera.",
    ].join(" ");

    await act(async () => {
      await result.current.speakText(longText);
    });

    expect(spokenTexts.length).toBeGreaterThan(1);
    expect(spokenTexts.join(" ")).toBe(longText);
    expect(result.current.error).toBeNull();
    expect(result.current.speechStatus).toBe("idle");
  });

  it("applies a gap between queued speech items", async () => {
    vi.useFakeTimers();
    const spokenAt: number[] = [];
    speechSynthesisMock().speak.mockImplementation((utterance: any) => {
      spokenAt.push(Date.now());
      setTimeout(() => utterance.onend?.(), 0);
    });

    const { result } = renderHook(() => useAudio());

    const firstPromise = result.current.speakText("Primero", { gapAfterMs: 180 });
    const secondPromise = result.current.speakText("Segundo", { gapAfterMs: 180 });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });

    expect(speechSynthesisMock().speak).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(179);
    });

    expect(speechSynthesisMock().speak).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await vi.runAllTimersAsync();
    });

    await firstPromise;
    await secondPromise;

    expect(speechSynthesisMock().speak).toHaveBeenCalledTimes(2);
    expect(spokenAt[1] - spokenAt[0]).toBeGreaterThanOrEqual(180);
    expect(sendDebugEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "audio.speech_gap_applied",
      }),
    );
  });

  it("waits before speaking again after cancelSpeech", async () => {
    vi.useFakeTimers();
    speechSynthesisMock().speak.mockImplementation((utterance: any) => {
      setTimeout(() => utterance.onend?.(), 0);
    });

    const { result } = renderHook(() => useAudio());

    const initialPromise = result.current.speakText("Inicial", { gapAfterMs: 0 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });
    await initialPromise;

    act(() => {
      result.current.cancelSpeech();
    });

    const resumedPromise = result.current.speakText("Despues", { gapAfterMs: 0 });

    expect(speechSynthesisMock().speak).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(249);
    });

    expect(speechSynthesisMock().speak).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await vi.runAllTimersAsync();
    });

    await resumedPromise;

    expect(speechSynthesisMock().speak).toHaveBeenCalledTimes(2);
  });

  it("does not show playback error for intentional cancellation events", async () => {
    let utteranceRef: any;
    speechSynthesisMock().speak.mockImplementation((utterance: any) => {
      utteranceRef = utterance;
    });

    const { result } = renderHook(() => useAudio());

    let speechPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      speechPromise = result.current.speakText("Respuesta en curso");
      await Promise.resolve();
    });

    await act(async () => {
      utteranceRef.onerror?.({ error: "interrupted" });
      await speechPromise;
    });

    expect(result.current.error).toBeNull();
    expect(result.current.speechStatus).toBe("idle");
  });

  it("shows playback error for real speech synthesis failures", async () => {
    speechSynthesisMock().speak.mockImplementation((utterance: any) => {
      setTimeout(() => utterance.onerror?.({ error: "synthesis-failed" }), 0);
    });

    const { result } = renderHook(() => useAudio());

    await act(async () => {
      await result.current.speakText("Respuesta");
    });

    expect(result.current.error).toBe(
      "No pude reproducir la respuesta hablada. Puedes leerla en pantalla.",
    );
    expect(result.current.speechStatus).toBe("idle");
  });

  it("reports unsupported SpeechRecognition without entering a false listening state", () => {
    const { result } = renderHook(() => useAudio());

    let started = true;
    act(() => {
      started = result.current.startManualRecognition();
    });

    expect(started).toBe(false);
    expect(result.current.recognitionStatus).toBe("unsupported");
    expect(result.current.isManualListening).toBe(false);
  });

  it("ignores stale recognition callbacks after stopAllAudio", () => {
    const instances: any[] = [];
    class MockRecognition {
      continuous = false;
      interimResults = false;
      lang = "";
      maxAlternatives = 1;
      onstart: (() => void) | null = null;
      onresult: ((event: any) => void) | null = null;
      onerror: ((event: any) => void) | null = null;
      onend: (() => void) | null = null;
      start = vi.fn(() => this.onstart?.());
      stop = vi.fn();

      constructor() {
        instances.push(this);
      }
    }

    (window as any).SpeechRecognition = MockRecognition;

    const { result } = renderHook(() => useAudio());

    act(() => {
      expect(result.current.startManualRecognition()).toBe(true);
    });

    const recognition = instances[0];

    act(() => {
      result.current.stopAllAudio("test");
      recognition.onresult?.({
        resultIndex: 0,
        results: [
          {
            0: { transcript: "comando viejo" },
            isFinal: true,
          },
        ],
      });
    });

    expect(result.current.transcript).toBe("");
    expect(result.current.recognitionStatus).toBe("idle");
  });

  it("reports enriched recognition error payload with breadcrumbs and context", () => {
    const instances: any[] = [];
    class MockRecognition {
      continuous = false;
      interimResults = false;
      lang = "";
      maxAlternatives = 1;
      onstart: (() => void) | null = null;
      onresult: ((event: any) => void) | null = null;
      onerror: ((event: any) => void) | null = null;
      onend: (() => void) | null = null;
      start = vi.fn(() => this.onstart?.());
      stop = vi.fn();

      constructor() {
        instances.push(this);
      }
    }

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    (window as any).SpeechRecognition = MockRecognition;

    const { result } = renderHook(() => useAudio());

    act(() => {
      expect(result.current.startManualRecognition()).toBe(true);
    });

    const recognition = instances[0];
    act(() => {
      recognition.onerror?.({
        error: "network",
        message: "network disconnected",
      });
    });

    expect(sendDebugEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "audio.recognition_error",
        level: "error",
        payload: expect.objectContaining({
          error: "network",
          errorMessage: "network disconnected",
          mode: "manual",
          navigatorOnline: true,
          visibilityState: "visible",
          breadcrumbs: expect.arrayContaining([
            expect.objectContaining({ event: "startManualRecognition requested" }),
            expect.objectContaining({ event: "recognition.start() called" }),
            expect.objectContaining({ event: "recognition.onstart" }),
            expect.objectContaining({ event: "recognition.onerror" }),
          ]),
        }),
      }),
    );
  });
});
