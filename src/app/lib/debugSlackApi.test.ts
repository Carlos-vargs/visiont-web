import { beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../../../api/debug/slack";

const createResponse = () => {
  const response: {
    statusCode: number;
    body: unknown;
    headers: Record<string, string>;
    status: (code: number) => typeof response;
    json: (payload: unknown) => typeof response;
    setHeader: (name: string, value: string) => void;
  } = {
    statusCode: 200,
    body: null,
    headers: {},
    status(code: number) {
      response.statusCode = code;
      return response;
    },
    json(payload: unknown) {
      response.body = payload;
      return response;
    },
    setHeader(name: string, value: string) {
      response.headers[name] = value;
    },
  };

  return response;
};

describe("debug slack api", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    process.env.SLACK_DEBUG_CHANNEL_ID = "C123";
    delete process.env.DEBUG_SLACK_ALLOWED_ORIGINS;
  });

  it("uploads images as jpeg and posts them after the thread message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ ok: true, ts: "thread-123" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ ok: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            ok: true,
            upload_url: "https://upload.slack.test/file",
            file_id: "F123",
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ ok: true }),
      });

    vi.stubGlobal("fetch", fetchMock);

    const req = {
      method: "POST",
      headers: {},
      body: {
        type: "gemini.image_request",
        message: "Image prompt sent to Gemini",
        imageBase64: Buffer.from("jpeg-bytes").toString("base64"),
        imageMimeType: "image/jpeg",
        imageFilename: "visiont-analysis-1.jpg",
      },
    };
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "https://upload.slack.test/file",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "image/jpeg",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      "https://slack.com/api/files.completeUploadExternal",
      expect.objectContaining({
        body: expect.stringContaining("Frame enviado a Gemini para análisis"),
      }),
    );
  });
});
