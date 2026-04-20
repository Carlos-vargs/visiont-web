import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
});
