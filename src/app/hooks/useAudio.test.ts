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
});
