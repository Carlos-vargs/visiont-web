type DebugLevel = "info" | "warn" | "error";

type DebugEventInput = {
  type: string;
  source: string;
  level?: DebugLevel;
  message?: string;
  payload?: unknown;
  imageBase64?: string;
  imageMimeType?: string;
  imageFilename?: string;
};

type DebugEventRequest = DebugEventInput & {
  occurredAt: string;
  route: string;
  sessionId: string;
  threadTs?: string;
  userAgent?: string;
};

const DEBUG_SESSION_KEY = "visiont:debug-session-id";
const DEBUG_THREAD_KEY = "visiont:debug-thread-ts";
const DEFAULT_DEBUG_ENDPOINT = "/api/debug/slack";
const FALLBACK_USER_AGENT = "unknown";

let debugQueue: Promise<void> = Promise.resolve();
let globalHandlersRegistered = false;
let sessionStarted = false;
let failureReported = false;

const isDebugEnabled = () => import.meta.env.VITE_DEBUG_SLACK_ENABLED === "true";

const isImageCaptureEnabled = () =>
  import.meta.env.VITE_DEBUG_SLACK_CAPTURE_IMAGES !== "false";

const getDebugEndpoint = () =>
  import.meta.env.VITE_DEBUG_SLACK_ENDPOINT?.trim() || DEFAULT_DEBUG_ENDPOINT;

const canUseWindow = () => typeof window !== "undefined";

const getRoute = () => {
  if (!canUseWindow()) {
    return "server";
  }

  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
};

const getStorage = () => {
  if (!canUseWindow()) {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

const createId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `visiont-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const getSessionId = () => {
  const storage = getStorage();
  const current = storage?.getItem(DEBUG_SESSION_KEY);
  if (current) {
    return current;
  }

  const next = createId();
  storage?.setItem(DEBUG_SESSION_KEY, next);
  return next;
};

const getThreadTs = () => getStorage()?.getItem(DEBUG_THREAD_KEY) || undefined;

const setThreadTs = (threadTs?: string) => {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  if (!threadTs) {
    storage.removeItem(DEBUG_THREAD_KEY);
    return;
  }

  storage.setItem(DEBUG_THREAD_KEY, threadTs);
};

const serializeUnknownValue = (value: unknown): unknown => {
  if (value instanceof Error) {
    return serializeError(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeUnknownValue(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        serializeUnknownValue(nested),
      ]),
    );
  }

  return value;
};

const reportSendFailure = (error: unknown) => {
  if (failureReported) {
    return;
  }

  failureReported = true;
  console.warn("[debugTelemetry] Slack debug forwarding failed", error);
};

const sendDebugEventInternal = async (event: DebugEventInput) => {
  const payload: DebugEventRequest = {
    ...event,
    imageBase64:
      isImageCaptureEnabled() || !event.imageBase64 ? event.imageBase64 : undefined,
    occurredAt: new Date().toISOString(),
    route: getRoute(),
    sessionId: getSessionId(),
    threadTs: getThreadTs(),
    userAgent:
      typeof navigator === "undefined" ? FALLBACK_USER_AGENT : navigator.userAgent,
  };

  const response = await fetch(getDebugEndpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Debug endpoint returned ${response.status}`);
  }

  const responseBody = (await response.json()) as { threadTs?: string };
  if (responseBody.threadTs) {
    setThreadTs(responseBody.threadTs);
  }
};

const registerGlobalHandlers = () => {
  if (!canUseWindow() || globalHandlersRegistered) {
    return;
  }

  window.addEventListener("error", (event) => {
    sendDebugEvent({
      type: "app.window_error",
      source: "window",
      level: "error",
      message: event.message || "Unhandled window error",
      payload: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: serializeUnknownValue(event.error),
      },
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    sendDebugEvent({
      type: "app.unhandled_rejection",
      source: "window",
      level: "error",
      message: "Unhandled promise rejection",
      payload: {
        reason: serializeUnknownValue(event.reason),
      },
    });
  });

  globalHandlersRegistered = true;
};

export const serializeError = (error: unknown) => {
  const fallback = String(error);

  if (error instanceof Error) {
    const errorWithCause = error as Error & { cause?: unknown };
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: serializeUnknownValue(errorWithCause.cause),
    };
  }

  if (typeof error === "object" && error !== null) {
    return {
      fallback,
      ...(serializeUnknownValue(error) as Record<string, unknown>),
    };
  }

  return { fallback };
};

export const sendDebugEvent = (event: DebugEventInput) => {
  if (!isDebugEnabled() || !canUseWindow()) {
    return;
  }

  debugQueue = debugQueue
    .then(() => sendDebugEventInternal(event))
    .catch((error) => {
      reportSendFailure(error);
    });
};

export const initDebugTelemetry = () => {
  if (!isDebugEnabled() || !canUseWindow()) {
    return;
  }

  registerGlobalHandlers();

  if (sessionStarted) {
    return;
  }

  sessionStarted = true;
  sendDebugEvent({
    type: "app.session_started",
    source: "bootstrap",
    message: "VisionT debug session started",
    payload: {
      route: getRoute(),
      language: typeof navigator === "undefined" ? undefined : navigator.language,
    },
  });
};
