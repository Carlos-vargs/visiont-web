export type NativePermissionStatus =
  | "granted"
  | "denied"
  | "prompt"
  | "unsupported";

export type NativeBridgeContact = {
  id?: string;
  name?: string;
  phone?: string;
  relation?: string;
};

type NativeBridgePayload = Record<string, unknown> | undefined;

type NativeBridgeRequest = {
  id: string;
  action: string;
  payload?: NativeBridgePayload;
};

type DirectNativeBridge = {
  placeCall?: (payload?: NativeBridgePayload) => unknown;
  pickContact?: (payload?: NativeBridgePayload) => unknown;
  listContacts?: (payload?: NativeBridgePayload) => unknown;
  requestContactsPermission?: (payload?: NativeBridgePayload) => unknown;
  getContactsPermissionStatus?: (payload?: NativeBridgePayload) => unknown;
};

type PendingBridgeRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

const pendingRequests = new Map<string, PendingBridgeRequest>();

const parseMaybeJson = (value: unknown) => {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const toNativePermissionStatus = (value: unknown): NativePermissionStatus => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (normalized === "granted" || normalized === "authorized") {
    return "granted";
  }

  if (normalized === "denied" || normalized === "blocked") {
    return "denied";
  }

  if (normalized === "prompt" || normalized === "undetermined") {
    return "prompt";
  }

  return "unsupported";
};

const getDirectBridge = (): DirectNativeBridge | null => {
  if (typeof window === "undefined") {
    return null;
  }

  return window.VisionTNativeBridge || null;
};

const getWebkitBridge = () => {
  if (typeof window === "undefined") {
    return null;
  }

  return window.webkit?.messageHandlers?.visiontNativeBridge || null;
};

const hasDirectBridgeMethod = (action: keyof DirectNativeBridge) => {
  const bridge = getDirectBridge();
  return typeof bridge?.[action] === "function";
};

const hasWebkitBridge = () => Boolean(getWebkitBridge());

const ensureWebkitCallbacks = () => {
  if (typeof window === "undefined") {
    return;
  }

  if (!window.__visiontNativeBridgeResolve) {
    window.__visiontNativeBridgeResolve = (id: string, result?: unknown) => {
      const pending = pendingRequests.get(id);
      if (!pending) {
        return;
      }

      pending.resolve(result);
      pendingRequests.delete(id);
    };
  }

  if (!window.__visiontNativeBridgeReject) {
    window.__visiontNativeBridgeReject = (id: string, error?: unknown) => {
      const pending = pendingRequests.get(id);
      if (!pending) {
        return;
      }

      pending.reject(error);
      pendingRequests.delete(id);
    };
  }
};

const invokeWebkitBridge = async (
  action: string,
  payload?: NativeBridgePayload,
) => {
  const bridge = getWebkitBridge();

  if (!bridge) {
    throw new Error("Native bridge unavailable");
  }

  ensureWebkitCallbacks();

  return await new Promise<unknown>((resolve, reject) => {
    const id = crypto.randomUUID();
    pendingRequests.set(id, { resolve, reject });

    const request: NativeBridgeRequest = {
      id,
      action,
      payload,
    };

    bridge.postMessage(request);
  });
};

const invokeNative = async (
  action: keyof DirectNativeBridge,
  payload?: NativeBridgePayload,
) => {
  const directBridge = getDirectBridge();

  if (directBridge && typeof directBridge[action] === "function") {
    const result = await Promise.resolve(directBridge[action]?.(payload));
    return parseMaybeJson(result);
  }

  if (hasWebkitBridge()) {
    const result = await invokeWebkitBridge(action, payload);
    return parseMaybeJson(result);
  }

  throw new Error("Native bridge unavailable");
};

const normalizeNativeContact = (
  value: unknown,
): NativeBridgeContact | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const contact = value as Record<string, unknown>;
  const name =
    typeof contact.name === "string"
      ? contact.name
      : Array.isArray(contact.name)
        ? String(contact.name[0] || "")
        : "";

  const phone =
    typeof contact.phone === "string"
      ? contact.phone
      : typeof contact.tel === "string"
        ? contact.tel
        : Array.isArray(contact.tel)
          ? String(contact.tel[0] || "")
          : "";

  if (!name && !phone) {
    return null;
  }

  return {
    id: typeof contact.id === "string" ? contact.id : undefined,
    name,
    phone,
    relation:
      typeof contact.relation === "string" ? contact.relation : "Contacto",
  };
};

export const getNativeBridgeCapabilities = () => {
  const canReadContacts =
    hasDirectBridgeMethod("listContacts") ||
    hasDirectBridgeMethod("pickContact") ||
    hasWebkitBridge();

  const canPlaceCalls =
    hasDirectBridgeMethod("placeCall") || hasWebkitBridge();

  return {
    isNativeBridgeAvailable: canReadContacts || canPlaceCalls,
    canReadContacts,
    canPlaceCalls,
    canAutoDial: canPlaceCalls,
  };
};

export const getNativeContactsPermissionStatus = async (): Promise<NativePermissionStatus> => {
  if (!getNativeBridgeCapabilities().canReadContacts) {
    return "unsupported";
  }

  try {
    const result = await invokeNative("getContactsPermissionStatus");
    return toNativePermissionStatus(result);
  } catch {
    return "prompt";
  }
};

export const requestNativeContactsPermission = async (): Promise<NativePermissionStatus> => {
  if (!getNativeBridgeCapabilities().canReadContacts) {
    return "unsupported";
  }

  try {
    const result = await invokeNative("requestContactsPermission");
    return toNativePermissionStatus(result);
  } catch {
    return "denied";
  }
};

export const listNativeContacts = async (): Promise<NativeBridgeContact[]> => {
  if (!getNativeBridgeCapabilities().canReadContacts) {
    return [];
  }

  try {
    const result = await invokeNative("listContacts");
    const contacts = Array.isArray(result) ? result : [];
    return contacts
      .map((contact) => normalizeNativeContact(contact))
      .filter((contact): contact is NativeBridgeContact => Boolean(contact));
  } catch (error) {
    console.warn("No se pudieron listar contactos nativos:", error);
    return [];
  }
};

export const pickNativeContact = async (): Promise<NativeBridgeContact | null> => {
  if (!getNativeBridgeCapabilities().canReadContacts) {
    return null;
  }

  try {
    const result = await invokeNative("pickContact");
    if (Array.isArray(result)) {
      return normalizeNativeContact(result[0]);
    }
    return normalizeNativeContact(result);
  } catch (error) {
    console.warn("No se pudo seleccionar contacto nativo:", error);
    return null;
  }
};

export const placeNativeCall = async (
  phone: string,
  options: { autoDial?: boolean; name?: string } = {},
) => {
  if (!getNativeBridgeCapabilities().canPlaceCalls) {
    return false;
  }

  try {
    const result = await invokeNative("placeCall", {
      phone,
      autoDial: options.autoDial ?? true,
      name: options.name,
    });

    if (typeof result === "boolean") {
      return result;
    }

    if (typeof result === "string") {
      return result.toLowerCase() !== "false";
    }

    return true;
  } catch (error) {
    console.warn("No se pudo iniciar la llamada nativa:", error);
    return false;
  }
};
