import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  generateContentMock,
  sendDebugEventMock,
  googleGenAIMock,
} = vi.hoisted(() => ({
  generateContentMock: vi.fn(),
  sendDebugEventMock: vi.fn(),
  googleGenAIMock: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class MockGoogleGenAI {
    models = {
      generateContent: generateContentMock,
    };

    constructor(config: unknown) {
      googleGenAIMock(config);
    }
  },
}));

vi.mock("../lib/debugTelemetry", () => ({
  sendDebugEvent: sendDebugEventMock,
  serializeError: (error: any) => ({
    name: error?.name,
    message: error?.message,
  }),
}));

import { useGemini } from "./useGemini";

describe("useGemini", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VITE_GEMINI_API_KEY", "test-api-key");
  });

  it("transcribes wav audio with Gemini and normalizes the plain text response", async () => {
    generateContentMock.mockResolvedValue({
      text: '```text\n"de que color es la mochila"\n```',
    });

    const { result } = renderHook(() => useGemini());

    await waitFor(() => expect(result.current.isConnected).toBe(true));

    let transcription = "";
    await act(async () => {
      transcription = await result.current.transcribeAudio(
        "audio-base64",
        "audio/wav",
      );
    });

    expect(transcription).toBe("de que color es la mochila");
    expect(generateContentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-2.5-flash",
        contents: [
          expect.objectContaining({
            parts: [
              expect.objectContaining({
                inlineData: {
                  mimeType: "audio/wav",
                  data: "audio-base64",
                },
              }),
              expect.objectContaining({
                text: expect.stringContaining("Transcribe exactamente el audio"),
              }),
            ],
          }),
        ],
      }),
    );
    expect(sendDebugEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "gemini.audio_transcription_request",
      }),
    );
    expect(sendDebugEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "gemini.audio_transcription_response",
        payload: expect.objectContaining({
          text: "de que color es la mochila",
        }),
      }),
    );
  });

  it("reports Gemini transcription errors", async () => {
    generateContentMock.mockRejectedValue(new Error("gemini unavailable"));

    const { result } = renderHook(() => useGemini());

    await waitFor(() => expect(result.current.isConnected).toBe(true));

    await act(async () => {
      await expect(
        result.current.transcribeAudio("audio-base64", "audio/wav"),
      ).rejects.toThrow("gemini unavailable");
    });

    expect(sendDebugEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "gemini.audio_transcription_error",
        level: "error",
      }),
    );
  });
});
