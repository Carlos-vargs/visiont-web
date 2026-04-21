import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { Contact } from "../../hooks/useContactPicker";
import {
  INITIAL_CONTACTS,
  SOS_HELP_MESSAGE,
  SOS_REQUEST_CONTACTS_MESSAGE,
} from "./constants";
import { parseVoiceIntent } from "./voiceIntent";
import { normalizeText } from "../../utils/text";
import { mergeContacts } from "../../utils/contacts";

type PermissionStatus = "prompt" | "granted" | "denied" | "unsupported";

type UseSOSCommandHandlerOptions = {
  savedContacts: Contact[];
  deviceContacts: Contact[];
  permissionStatus: PermissionStatus;
  canAutoDial: boolean;
  canListDeviceContacts: boolean;
  isContactPickerSupported: boolean;
  clearContactPickerError: () => void;
  requestContactsAccess: () => Promise<{ granted: boolean; contacts: Contact[] }>;
  refreshDeviceContacts: () => Promise<Contact[]>;
  parseContactName: (value: string) => string | null;
  findContactByName: (
    name: string,
    contacts?: Contact[],
  ) => Contact | undefined;
  pickContact: () => Promise<Contact | null>;
  saveContact: (contact: Contact) => Contact;
  triggerCall: (phone: string, name?: string) => Promise<boolean>;
  speakStatus: (text: string) => Promise<void>;
  sosActive: boolean;
  setSosActive: Dispatch<SetStateAction<boolean>>;
  cancelSOS: () => void;
};

export function useSOSCommandHandler({
  savedContacts,
  deviceContacts,
  permissionStatus,
  canAutoDial,
  canListDeviceContacts,
  isContactPickerSupported,
  clearContactPickerError,
  requestContactsAccess,
  refreshDeviceContacts,
  parseContactName,
  findContactByName,
  pickContact,
  saveContact,
  triggerCall,
  speakStatus,
  sosActive,
  setSosActive,
  cancelSOS,
}: UseSOSCommandHandlerOptions) {
  const [voiceStatus, setVoiceStatus] = useState("");
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualPhone, setManualPhone] = useState("");

  const contacts = useMemo(
    () => mergeContacts(INITIAL_CONTACTS, savedContacts, deviceContacts),
    [deviceContacts, savedContacts],
  );

  const contactsRef = useRef<Contact[]>(contacts);
  const sosActiveRef = useRef(sosActive);
  const pendingCallNameRef = useRef<string | null>(null);
  const commandCycleRef = useRef(0);

  useEffect(() => {
    contactsRef.current = contacts;
  }, [contacts]);

  useEffect(() => {
    sosActiveRef.current = sosActive;
  }, [sosActive]);

  const setCommandCycle = useCallback((cycleId: number) => {
    commandCycleRef.current = cycleId;
  }, []);

  const handleBeforeManualStart = useCallback(() => {
    clearContactPickerError();
    setShowManualInput(false);
  }, [clearContactPickerError]);

  const requestAndSyncContacts = useCallback(async () => {
    setVoiceStatus(SOS_REQUEST_CONTACTS_MESSAGE);
    const result = await requestContactsAccess();
    if (result.granted) {
      const total = result.contacts.length;
      const message =
        total > 0
          ? `Sincronice ${total} contactos del dispositivo`
          : "Permiso concedido, pero no encontre contactos";
      setVoiceStatus(message);
      void speakStatus(message);
      return result.contacts;
    }
    return [];
  }, [requestContactsAccess, speakStatus]);

  const resolveContactByName = useCallback(
    async (contactName: string) => {
      let contact = findContactByName(contactName, contactsRef.current);
      if (contact) {
        return contact;
      }

      if (canListDeviceContacts) {
        const freshContacts =
          permissionStatus === "granted"
            ? await refreshDeviceContacts()
            : await requestAndSyncContacts();

        if (freshContacts.length > 0) {
          contact = findContactByName(
            contactName,
            mergeContacts(contactsRef.current, freshContacts),
          );
        }
      }

      return contact;
    },
    [
      canListDeviceContacts,
      findContactByName,
      permissionStatus,
      refreshDeviceContacts,
      requestAndSyncContacts,
    ],
  );

  const callContact = useCallback(
    async (phone: string, name: string) => {
      if (!phone) {
        const message = "No hay numero disponible para este contacto";
        setVoiceStatus(message);
        void speakStatus(message);
        setShowManualInput(true);
        return false;
      }

      const message = canAutoDial
        ? `Llamando automaticamente a ${name}`
        : `Abriendo la app del telefono para llamar a ${name}`;
      setVoiceStatus(message);
      void speakStatus(message);
      return await triggerCall(phone, name);
    },
    [canAutoDial, speakStatus, triggerCall],
  );

  const handleVoiceCommand = useCallback(
    async (transcript: string, commandCycleId = commandCycleRef.current) => {
      const isCurrentCommand = () =>
        commandCycleRef.current === commandCycleId;
      const publishStatus = (message: string) => {
        if (!isCurrentCommand()) {
          return false;
        }

        setVoiceStatus(message);
        void speakStatus(message);
        return true;
      };

      const normalized = normalizeText(transcript);
      const intent = parseVoiceIntent(transcript, parseContactName);

      if (intent.type === "activate_sos") {
        if (!sosActiveRef.current) {
          setSosActive(true);
          publishStatus("Activando emergencia");
        }
        return;
      }

      if (intent.type === "cancel_sos" && sosActiveRef.current) {
        cancelSOS();
        publishStatus("Emergencia cancelada");
        return;
      }

      if (intent.type === "call") {
        const contact = await resolveContactByName(intent.contactName);
        if (!isCurrentCommand()) return;
        if (contact) {
          pendingCallNameRef.current = null;
          await callContact(contact.phone, contact.name);
        } else if (isContactPickerSupported || canListDeviceContacts) {
          pendingCallNameRef.current = intent.contactName;
          publishStatus(
            `No encontre a ${intent.contactName}. Toca Agregar para elegirlo o sincroniza contactos.`,
          );
        } else {
          pendingCallNameRef.current = intent.contactName;
          setShowManualInput(true);
          publishStatus(
            `No puedo leer tus contactos aqui. Ingresa el numero manualmente para ${intent.contactName}.`,
          );
        }
        return;
      }

      if (intent.type === "search_contact") {
        if (intent.contactName) {
          const contact = await resolveContactByName(intent.contactName);
          if (!isCurrentCommand()) return;
          if (contact) {
            publishStatus(
              `Encontre a ${contact.name} con numero ${contact.phone}`,
            );
          } else {
            publishStatus(`No encontre a ${intent.contactName}.`);
          }
          return;
        }

        if (canListDeviceContacts) {
          await requestAndSyncContacts();
          return;
        }

        if (isContactPickerSupported) {
          publishStatus("Toca Agregar para seleccionar un contacto.");
        } else {
          setShowManualInput(true);
          publishStatus(
            "Este dispositivo no permite abrir contactos. Ingresa el numero manualmente.",
          );
        }
        return;
      }

      if (intent.type === "add_contact") {
        if (intent.contactName) {
          const contact = await resolveContactByName(intent.contactName);
          if (!isCurrentCommand()) return;
          if (contact) {
            saveContact({
              ...contact,
              relation: "Contacto de emergencia",
              isEmergency: false,
            });
            publishStatus(
              `${contact.name} fue agregado como contacto de emergencia`,
            );
          } else {
            publishStatus(
              `No encontre a ${intent.contactName}. Toca Agregar para seleccionarlo manualmente.`,
            );
          }
          return;
        }

        if (normalized.includes("sincroniza") && canListDeviceContacts) {
          await requestAndSyncContacts();
          return;
        }

        publishStatus(
          canListDeviceContacts
            ? "Toca Permitir o Agregar para seleccionar un contacto del dispositivo."
            : "Toca Agregar para seleccionar un contacto.",
        );
        return;
      }

      publishStatus(SOS_HELP_MESSAGE);
    },
    [
      callContact,
      cancelSOS,
      canListDeviceContacts,
      isContactPickerSupported,
      parseContactName,
      requestAndSyncContacts,
      resolveContactByName,
      saveContact,
      setSosActive,
      speakStatus,
    ],
  );

  const handleEnableContacts = useCallback(async () => {
    clearContactPickerError();
    await requestAndSyncContacts();
  }, [clearContactPickerError, requestAndSyncContacts]);

  const handleRefreshContacts = useCallback(async () => {
    clearContactPickerError();
    const refreshed = await refreshDeviceContacts();
    setVoiceStatus(
      refreshed.length > 0
        ? `Actualice ${refreshed.length} contactos del dispositivo`
        : "No encontre contactos para sincronizar",
    );
  }, [clearContactPickerError, refreshDeviceContacts]);

  const handleAddContactManual = useCallback(async () => {
    clearContactPickerError();
    const contact = await pickContact();
    if (!contact) {
      if (!isContactPickerSupported && !canListDeviceContacts) {
        setShowManualInput(true);
      }
      return;
    }

    setVoiceStatus(`Contacto ${contact.name} agregado`);
    void speakStatus(`Contacto ${contact.name} agregado`);

    if (pendingCallNameRef.current) {
      pendingCallNameRef.current = null;
      await callContact(contact.phone, contact.name);
    }
  }, [
    callContact,
    canListDeviceContacts,
    clearContactPickerError,
    isContactPickerSupported,
    pickContact,
    speakStatus,
  ]);

  const handleManualCall = useCallback(async () => {
    if (!manualPhone.trim()) {
      return;
    }

    pendingCallNameRef.current = null;
    await callContact(manualPhone, "ese numero");
    setManualPhone("");
    setShowManualInput(false);
  }, [callContact, manualPhone]);

  return {
    callContact,
    contacts,
    manualPhone,
    setManualPhone,
    setVoiceStatus,
    voiceStatus,
    showManualInput,
    setCommandCycle,
    handleBeforeManualStart,
    handleEnableContacts,
    handleRefreshContacts,
    handleAddContactManual,
    handleManualCall,
    handleVoiceCommand,
  };
}
