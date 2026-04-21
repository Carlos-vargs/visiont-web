import { useState, useCallback, useEffect, useRef } from "react";
import {
  getNativeBridgeCapabilities,
  getNativeContactsPermissionStatus,
  listNativeContacts,
  pickNativeContact,
  placeNativeCall,
  requestNativeContactsPermission,
  type NativePermissionStatus,
} from "../lib/nativeBridge";
import { getInitials, normalizePhone } from "../utils/contacts";
import { normalizeText } from "../utils/text";

export type Contact = {
  id: string;
  name: string;
  phone: string;
  relation?: string;
  initials?: string;
  isEmergency?: boolean;
};

type UseContactPickerOptions = {
  onContactSelected?: (contact: Contact) => void;
  onError?: (error: string) => void;
};

type ContactPickerNavigator = Navigator & {
  contacts?: {
    select?: (
      properties: readonly string[],
      options?: { multiple?: boolean; hint?: string },
    ) => Promise<Array<{ name?: string[]; tel?: string[] }>>;
  };
};

const STORAGE_KEY = "sos-contacts";

const hasBrowserContactPickerSupport = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }

  const nav = navigator as ContactPickerNavigator;
  return typeof nav.contacts?.select === "function";
};

const readStoredContacts = (): Contact[] => {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return [];
    }

    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("Error loading saved contacts:", error);
    return [];
  }
};

const persistContacts = (contacts: Contact[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts));
  } catch (error) {
    console.warn("Error saving contacts:", error);
  }
};

const mergeUniqueContacts = (contacts: Contact[]): Contact[] => {
  const byPhone = new Map<string, Contact>();

  for (const contact of contacts) {
    const normalizedPhone = normalizePhone(contact.phone);
    const key = normalizedPhone || contact.id;
    byPhone.set(key, {
      ...contact,
      phone: normalizedPhone || contact.phone,
      initials: contact.initials || getInitials(contact.name),
    });
  }

  return Array.from(byPhone.values());
};

const toContact = (
  value: Partial<Contact> & { name?: string; phone?: string },
  fallbackRelation = "Contacto del dispositivo",
): Contact | null => {
  const name = value.name?.trim() || "Contacto desconocido";
  const phone = normalizePhone(value.phone || "");

  if (!phone) {
    return null;
  }

  return {
    id: value.id || crypto.randomUUID(),
    name,
    phone,
    relation: value.relation || fallbackRelation,
    initials: value.initials || getInitials(name),
    isEmergency: value.isEmergency ?? false,
  };
};

export function useContactPicker(options: UseContactPickerOptions = {}) {
  const capabilities = getNativeBridgeCapabilities();

  const [isSupported, setIsSupported] = useState(
    () => hasBrowserContactPickerSupport() || capabilities.canReadContacts,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedContacts, setSavedContacts] = useState<Contact[]>([]);
  const [deviceContacts, setDeviceContacts] = useState<Contact[]>([]);
  const [permissionStatus, setPermissionStatus] = useState<NativePermissionStatus>(
    capabilities.canReadContacts ? "prompt" : "unsupported",
  );

  const optionsRef = useRef(options);
  const browserContactPickerSupportedRef = useRef(hasBrowserContactPickerSupport());
  const nativeCapabilitiesRef = useRef(capabilities);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    const browserSupported = hasBrowserContactPickerSupport();
    const nativeCapabilities = getNativeBridgeCapabilities();

    browserContactPickerSupportedRef.current = browserSupported;
    nativeCapabilitiesRef.current = nativeCapabilities;

    setIsSupported(browserSupported || nativeCapabilities.canReadContacts);
    setSavedContacts(readStoredContacts());

    let isMounted = true;

    const initializeNativeContacts = async () => {
      if (!nativeCapabilities.canReadContacts) {
        if (isMounted) {
          setPermissionStatus("unsupported");
        }
        return;
      }

      const status = await getNativeContactsPermissionStatus();
      if (!isMounted) {
        return;
      }

      setPermissionStatus(status);

      if (status === "granted") {
        const contacts = await listNativeContacts();
        if (!isMounted) {
          return;
        }

        setDeviceContacts(
          mergeUniqueContacts(
            contacts
              .map((contact) =>
                toContact(
                  {
                    id: contact.id,
                    name: contact.name,
                    phone: contact.phone,
                    relation: contact.relation || "Contacto del dispositivo",
                  },
                  "Contacto del dispositivo",
                ),
              )
              .filter((contact): contact is Contact => Boolean(contact)),
          ),
        );
      }
    };

    void initializeNativeContacts();

    return () => {
      isMounted = false;
    };
  }, []);

  const saveContacts = useCallback((updater: (previous: Contact[]) => Contact[]) => {
    setSavedContacts((previous) => {
      const next = mergeUniqueContacts(updater(previous));
      persistContacts(next);
      return next;
    });
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const saveContact = useCallback(
    (contact: Contact) => {
      let selectedContact = contact;

      saveContacts((previous) => {
        const merged = mergeUniqueContacts([
          ...previous,
          {
            ...contact,
            initials: contact.initials || getInitials(contact.name),
            phone: normalizePhone(contact.phone),
          },
        ]);

        selectedContact =
          merged.find(
            (item) => normalizePhone(item.phone) === normalizePhone(contact.phone),
          ) || selectedContact;

        return merged;
      });

      optionsRef.current.onContactSelected?.(selectedContact);
      return selectedContact;
    },
    [saveContacts],
  );

  const refreshDeviceContacts = useCallback(async () => {
    if (!nativeCapabilitiesRef.current.canReadContacts) {
      return [];
    }

    const contacts = await listNativeContacts();
    const normalizedContacts = mergeUniqueContacts(
      contacts
        .map((contact) =>
          toContact(
            {
              id: contact.id,
              name: contact.name,
              phone: contact.phone,
              relation: contact.relation || "Contacto del dispositivo",
            },
            "Contacto del dispositivo",
          ),
        )
        .filter((contact): contact is Contact => Boolean(contact)),
    );

    setDeviceContacts(normalizedContacts);
    return normalizedContacts;
  }, []);

  const requestContactsAccess = useCallback(async () => {
    if (!nativeCapabilitiesRef.current.canReadContacts) {
      return {
        granted: false,
        contacts: [] as Contact[],
      };
    }

    const status = await requestNativeContactsPermission();
    setPermissionStatus(status);

    if (status !== "granted") {
      const message =
        status === "denied"
          ? "Permiso de contactos denegado."
          : "No se pudo obtener permiso para leer tus contactos.";
      setError(message);
      optionsRef.current.onError?.(message);

      return {
        granted: false,
        contacts: [] as Contact[],
      };
    }

    const contacts = await refreshDeviceContacts();
    return {
      granted: true,
      contacts,
    };
  }, [refreshDeviceContacts]);

  const parseContactName = useCallback((transcript: string): string | null => {
    const normalized = normalizeText(transcript);
    const cleaned = normalized
      .replace(
        /\b(por favor|porfa|ahora|ya|rapido|necesito|quiero|puedes|podrias|podrías|me|por)\b/g,
        " ",
      )
      .replace(/\s+/g, " ")
      .trim();

    const patterns = [
      /(?:llama|llamar|marca|marcar|contacta|contactar)\s+(?:a\s+)?(.+)/,
      /(?:busca|buscar|buscame|encuentra|encontrar)\s+(?:a\s+)?(?:contacto\s+(?:de\s+)?)?(.+)/,
      /(?:agrega|agregar|guarda|guardar)\s+(?:a\s+)?(.+?)(?:\s+como\s+contacto(?:\s+de\s+emergencia)?)?$/,
      /(?:contacto\s+de\s+)?(.+)/,
    ];

    for (const pattern of patterns) {
      const match = cleaned.match(pattern);
      if (match?.[1]?.trim()) {
        return match[1]
          .trim()
          .replace(/\b(al|la|el|de)\s+final$/g, "")
          .trim();
      }
    }

    if (cleaned.includes("emergencia") || cleaned.includes("ayuda")) {
      return "emergency";
    }

    return null;
  }, []);

  const findContactByName = useCallback(
    (
      name: string,
      contacts: Contact[] = [...savedContacts, ...deviceContacts],
    ): Contact | undefined => {
      const normalizedQuery = normalizeText(name);
      if (!normalizedQuery) {
        return undefined;
      }

      const queryTokens = normalizedQuery.split(" ").filter(Boolean);

      return contacts
        .slice()
        .sort((left, right) => left.name.length - right.name.length)
        .find((contact) => {
          const normalizedName = normalizeText(contact.name);
          return (
            normalizedName.includes(normalizedQuery) ||
            queryTokens.every((token) => normalizedName.includes(token))
          );
        });
    },
    [deviceContacts, savedContacts],
  );

  const pickContact = useCallback(async (): Promise<Contact | null> => {
    try {
      setIsLoading(true);
      setError(null);

      if (nativeCapabilitiesRef.current.canReadContacts) {
        const status =
          permissionStatus === "granted"
            ? permissionStatus
            : await requestNativeContactsPermission();

        setPermissionStatus(status);

        if (status !== "granted") {
          const message =
            status === "denied"
              ? "Permiso de contactos denegado."
              : "No se pudo acceder a los contactos del dispositivo.";
          setError(message);
          optionsRef.current.onError?.(message);
          return null;
        }

        const nativeContact = await pickNativeContact();
        const selectedContact = toContact(
          {
            id: nativeContact?.id,
            name: nativeContact?.name,
            phone: nativeContact?.phone,
            relation: nativeContact?.relation || "Contacto de emergencia",
          },
          "Contacto de emergencia",
        );

        if (!selectedContact) {
          return null;
        }

        return saveContact(selectedContact);
      }

      if (!browserContactPickerSupportedRef.current) {
        const message =
          "Este dispositivo no permite leer contactos directamente. Usa ingreso manual.";
        setError(message);
        optionsRef.current.onError?.(message);
        return null;
      }

      const nav = navigator as ContactPickerNavigator;
      const selected = await nav.contacts?.select?.(["name", "tel"], {
        multiple: false,
        hint: "Selecciona un contacto de emergencia",
      });

      const picked = selected?.[0];
      const selectedContact = toContact(
        {
          name: picked?.name?.[0]?.trim(),
          phone: picked?.tel?.[0] || "",
          relation: "Contacto de emergencia",
        },
        "Contacto de emergencia",
      );

      if (!selectedContact) {
        return null;
      }

      return saveContact(selectedContact);
    } catch (err: any) {
      if (err?.name === "AbortError") {
        return null;
      }

      const message = `Error al acceder a contactos: ${err?.message || "desconocido"}`;
      setError(message);
      optionsRef.current.onError?.(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [permissionStatus, saveContact]);

  const callContact = useCallback(
    async (phone: string, name?: string) => {
      const cleanedPhone = normalizePhone(phone);
      if (!cleanedPhone) {
        return false;
      }

      if (nativeCapabilitiesRef.current.canPlaceCalls) {
        const didCall = await placeNativeCall(cleanedPhone, {
          autoDial: true,
          name,
        });

        if (didCall) {
          return true;
        }
      }

      window.location.assign(`tel:${cleanedPhone}`);
      return true;
    },
    [],
  );

  const removeSavedContact = useCallback(
    (id: string) => {
      saveContacts((previous) => previous.filter((contact) => contact.id !== id));
    },
    [saveContacts],
  );

  return {
    isSupported,
    isLoading,
    error,
    savedContacts,
    deviceContacts,
    permissionStatus,
    isNativeBridgeAvailable: nativeCapabilitiesRef.current.isNativeBridgeAvailable,
    canAutoDial: nativeCapabilitiesRef.current.canAutoDial,
    canListDeviceContacts: nativeCapabilitiesRef.current.canReadContacts,
    clearError,
    saveContact,
    requestContactsAccess,
    refreshDeviceContacts,
    parseContactName,
    findContactByName,
    pickContact,
    callContact,
    removeSavedContact,
  };
}
