const SLACK_API_BASE_URL = "https://slack.com/api";
const MAX_INLINE_PAYLOAD_LENGTH = 3000;
const MAX_MESSAGE_LENGTH = 32000;

type DebugRequestBody = {
  type?: string;
  source?: string;
  level?: "info" | "warn" | "error";
  message?: string;
  payload?: unknown;
  imageBase64?: string;
  imageMimeType?: string;
  imageFilename?: string;
  occurredAt?: string;
  route?: string;
  sessionId?: string;
  threadTs?: string;
  userAgent?: string;
  hasImageAttachment?: boolean;
  imageBase64Length?: number;
  imageCaptureEnabled?: boolean;
};

const getEnv = (name: string) => process.env[name]?.trim();

const escapeSlackText = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const readRequestBody = async (req: any): Promise<DebugRequestBody> => {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  if (typeof req.body === "string") {
    return JSON.parse(req.body);
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const isAllowedOrigin = (req: any) => {
  const allowList = getEnv("DEBUG_SLACK_ALLOWED_ORIGINS");
  if (!allowList) {
    return true;
  }

  const allowedOrigins = allowList
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (allowedOrigins.length === 0) {
    return true;
  }

  const origin = (req.headers.origin || "").trim();
  const referer = (req.headers.referer || "").trim();

  return allowedOrigins.some(
    (allowed) => origin === allowed || referer.startsWith(`${allowed}/`),
  );
};

const slackApi = async (token: string, method: string, body: Record<string, unknown>) => {
  const response = await fetch(`${SLACK_API_BASE_URL}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();
  let parsed: any = null;
  try {
    parsed = responseText ? JSON.parse(responseText) : null;
  } catch {
    parsed = { ok: false, error: responseText || "invalid_json" };
  }

  if (!response.ok || !parsed?.ok) {
    throw new Error(`${method} failed: ${parsed?.error || response.statusText}`);
  }

  return parsed;
};

const stripDataUrlPrefix = (value: string) => {
  const trimmed = value.trim();
  const commaIndex = trimmed.indexOf(",");
  if (trimmed.startsWith("data:") && commaIndex >= 0) {
    return trimmed.slice(commaIndex + 1);
  }

  return trimmed;
};

const uploadFileToSlack = async ({
  token,
  channelId,
  threadTs,
  bytes,
  mimeType,
  filename,
  title,
  initialComment,
  altText,
}: {
  token: string;
  channelId: string;
  threadTs: string;
  bytes: Buffer;
  mimeType: string;
  filename: string;
  title: string;
  initialComment: string;
  altText?: string;
}) => {
  const uploadTicket = await slackApi(token, "files.getUploadURLExternal", {
    filename,
    length: bytes.byteLength,
    alt_txt: altText,
  });

  const uploadResponse = await fetch(uploadTicket.upload_url, {
    method: "POST",
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(bytes.byteLength),
    },
    body: new Uint8Array(bytes),
  });

  if (!uploadResponse.ok) {
    throw new Error(`binary upload failed with ${uploadResponse.status}`);
  }

  await slackApi(token, "files.completeUploadExternal", {
    files: [{ id: uploadTicket.file_id, title }],
    channel_id: channelId,
    thread_ts: threadTs,
    initial_comment: initialComment,
  });
};

const buildSessionHeader = (body: DebugRequestBody) => {
  const lines = [
    "*VisionT debug session*",
    `session: \`${escapeSlackText(body.sessionId || "unknown")}\``,
    `route: \`${escapeSlackText(body.route || "/")}\``,
  ];

  if (body.userAgent) {
    lines.push(`ua: ${escapeSlackText(body.userAgent.slice(0, 180))}`);
  }

  return lines.join("\n");
};

const buildEventMessage = (body: DebugRequestBody, payloadText?: string) => {
  const lines = [
    `*${escapeSlackText(body.type || "visiont.debug")}*`,
    `level: \`${escapeSlackText(body.level || "info")}\``,
    `source: \`${escapeSlackText(body.source || "unknown")}\``,
    `route: \`${escapeSlackText(body.route || "/")}\``,
  ];

  if (body.occurredAt) {
    lines.push(`at: \`${escapeSlackText(body.occurredAt)}\``);
  }

  if (body.message) {
    lines.push(`message: ${escapeSlackText(body.message)}`);
  }

  if (body.type === "gemini.image_request") {
    lines.push(
      `imageAttached: \`${body.hasImageAttachment ? "true" : "false"}\``,
    );
    if (typeof body.imageBase64Length === "number") {
      lines.push(`imageBytesBase64Length: \`${String(body.imageBase64Length)}\``);
    }
    if (typeof body.imageCaptureEnabled === "boolean") {
      lines.push(
        `imageCaptureEnabled: \`${body.imageCaptureEnabled ? "true" : "false"}\``,
      );
    }
  }

  if (payloadText && payloadText.length <= MAX_INLINE_PAYLOAD_LENGTH) {
    lines.push("```json");
    lines.push(payloadText);
    lines.push("```");
  }

  const message = lines.join("\n");
  return message.length > MAX_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_MESSAGE_LENGTH - 20)}\n...[truncated]`
    : message;
};

const ensureThread = async ({
  token,
  channelId,
  body,
}: {
  token: string;
  channelId: string;
  body: DebugRequestBody;
}) => {
  if (body.threadTs) {
    return body.threadTs;
  }

  const created = await slackApi(token, "chat.postMessage", {
    channel: channelId,
    text: buildSessionHeader(body),
    mrkdwn: true,
  });

  return created.ts as string;
};

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  if (!isAllowedOrigin(req)) {
    return res.status(403).json({ ok: false, error: "origin_not_allowed" });
  }

  const token = getEnv("SLACK_BOT_TOKEN");
  const channelId = getEnv("SLACK_DEBUG_CHANNEL_ID");
  if (!token || !channelId) {
    return res.status(500).json({
      ok: false,
      error: "missing_slack_configuration",
    });
  }

  try {
    const body = await readRequestBody(req);
    const threadTs = await ensureThread({ token, channelId, body });
    const payloadText =
      typeof body.payload === "undefined"
        ? ""
        : JSON.stringify(body.payload, null, 2);

    await slackApi(token, "chat.postMessage", {
      channel: channelId,
      thread_ts: threadTs,
      text: buildEventMessage(body, payloadText),
      mrkdwn: true,
    });

    if (payloadText && payloadText.length > MAX_INLINE_PAYLOAD_LENGTH) {
      const payloadFilename = `${body.type || "visiont-debug"}-${Date.now()}-payload.json`;
      await uploadFileToSlack({
        token,
        channelId,
        threadTs,
        bytes: Buffer.from(payloadText, "utf8"),
        mimeType: "application/json",
        filename: payloadFilename,
        title: payloadFilename,
        initialComment: `Payload completo para ${body.type || "visiont.debug"}`,
        altText: body.message,
      });
    }

    if (body.type === "gemini.image_request" && !body.imageBase64) {
      await slackApi(token, "chat.postMessage", {
        channel: channelId,
        thread_ts: threadTs,
        text: [
          "*visiont.debug_image_missing*",
          `message: ${escapeSlackText(
            "El evento de imagen llegó sin el binario adjunto.",
          )}`,
          `imageCaptureEnabled: \`${escapeSlackText(
            String(body.imageCaptureEnabled),
          )}\``,
          `hasImageAttachment: \`${escapeSlackText(
            String(body.hasImageAttachment),
          )}\``,
          "check: `VITE_DEBUG_SLACK_CAPTURE_IMAGES`, serialización del cliente y límites del request",
        ].join("\n"),
        mrkdwn: true,
      });
    }

    if (body.imageBase64) {
      const normalizedImageBase64 = stripDataUrlPrefix(body.imageBase64);
      const imageBytes = Buffer.from(normalizedImageBase64, "base64");
      const imageExtension =
        body.imageMimeType?.split("/")[1]?.split(";")[0] || "jpg";
      const imageFilename =
        body.imageFilename ||
        `${body.type || "visiont-image"}-${Date.now()}.${imageExtension}`;

      try {
        await uploadFileToSlack({
          token,
          channelId,
          threadTs,
          bytes: imageBytes,
          mimeType: body.imageMimeType || "image/jpeg",
          filename: imageFilename,
          title: imageFilename,
          initialComment: "Frame enviado a Gemini para análisis",
          altText: body.message,
        });
      } catch (imageUploadError: any) {
        await slackApi(token, "chat.postMessage", {
          channel: channelId,
          thread_ts: threadTs,
          text: [
            "*visiont.debug_image_upload_error*",
            `message: ${escapeSlackText(
              imageUploadError?.message || "No se pudo subir la imagen a Slack.",
            )}`,
            `filename: \`${escapeSlackText(imageFilename)}\``,
            `mimeType: \`${escapeSlackText(body.imageMimeType || "image/jpeg")}\``,
            `imageBytesBase64Length: \`${String(normalizedImageBase64.length)}\``,
          ].join("\n"),
          mrkdwn: true,
        });
      }
    }

    return res.status(200).json({ ok: true, threadTs });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "unknown_error",
    });
  }
}
