import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

const createTrack = () => ({
  stop: vi.fn(),
});

export const createMockStream = () =>
  ({
    getTracks: vi.fn(() => [createTrack()]),
    getAudioTracks: vi.fn(() => [createTrack()]),
  }) as unknown as MediaStream;

class MockAudioContext {
  state = "running";
  destination = {};
  audioWorklet = {
    addModule: vi.fn().mockResolvedValue(undefined),
  };

  createMediaStreamSource = vi.fn(() => ({
    connect: vi.fn(),
  }));

  createBuffer = vi.fn((_channels: number, length: number) => ({
    getChannelData: vi.fn(() => new Float32Array(length)),
  }));

  createBufferSource = vi.fn(() => ({
    buffer: null,
    connect: vi.fn(),
    start: vi.fn(function start(this: { onended?: () => void }) {
      this.onended?.();
    }),
    onended: undefined,
  }));

  close = vi.fn().mockImplementation(() => {
    this.state = "closed";
    return Promise.resolve();
  });
}

class MockAudioWorkletNode {
  port = {
    postMessage: vi.fn(),
    onmessage: null as ((event: MessageEvent) => void) | null,
  };

  connect = vi.fn();
  disconnect = vi.fn();
}

class MockSpeechSynthesisUtterance {
  text: string;
  lang = "";
  rate = 1;
  pitch = 1;
  voice: SpeechSynthesisVoice | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

Object.defineProperty(window, "AudioContext", {
  writable: true,
  value: MockAudioContext,
});

Object.defineProperty(window, "AudioWorkletNode", {
  writable: true,
  value: MockAudioWorkletNode,
});

Object.defineProperty(globalThis, "AudioContext", {
  writable: true,
  value: MockAudioContext,
});

Object.defineProperty(globalThis, "AudioWorkletNode", {
  writable: true,
  value: MockAudioWorkletNode,
});

Object.defineProperty(window, "SpeechSynthesisUtterance", {
  writable: true,
  value: MockSpeechSynthesisUtterance,
});

Object.defineProperty(globalThis, "SpeechSynthesisUtterance", {
  writable: true,
  value: MockSpeechSynthesisUtterance,
});

Object.defineProperty(window, "speechSynthesis", {
  writable: true,
  value: {
    speak: vi.fn((utterance: MockSpeechSynthesisUtterance) => {
      setTimeout(() => utterance.onend?.(), 0);
    }),
    cancel: vi.fn(),
    getVoices: vi.fn(() => []),
  },
});

Object.defineProperty(navigator, "permissions", {
  writable: true,
  value: {
    query: vi.fn().mockResolvedValue({ state: "prompt" }),
  },
});

Object.defineProperty(navigator, "mediaDevices", {
  writable: true,
  value: {
    getUserMedia: vi.fn().mockResolvedValue(createMockStream()),
  },
});

const storage = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  writable: true,
  value: {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
    }),
    clear: vi.fn(() => {
      storage.clear();
    }),
  },
});

Object.defineProperty(URL, "createObjectURL", {
  writable: true,
  value: vi.fn(() => "blob:mock-worklet"),
});

Object.defineProperty(URL, "revokeObjectURL", {
  writable: true,
  value: vi.fn(),
});
