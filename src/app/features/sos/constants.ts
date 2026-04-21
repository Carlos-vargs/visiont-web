import type { Contact } from "../../hooks/useContactPicker";

export const INITIAL_CONTACTS: Contact[] = [
  {
    id: "emergency-128",
    name: "Cruz Blanca",
    relation: "Emergencias",
    phone: "128",
    initials: "CB",
    isEmergency: true,
  },
];

export const SOS_DEFAULT_STATUS_MESSAGE = "Toca para hablar";
export const SOS_HELP_MESSAGE =
  "Puedes decir llama a mama, marca a Juan, agrega contacto o activa emergencia.";
export const SOS_REQUEST_CONTACTS_MESSAGE =
  "Solicitando permiso para leer contactos...";
