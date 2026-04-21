import { motion } from "motion/react";
import { Phone, RefreshCcw, Shield, UserPlus } from "lucide-react";
import type { Contact } from "../../hooks/useContactPicker";
import { getInitials } from "../../utils/contacts";

type EmergencyContactsListProps = {
  contacts: Contact[];
  deviceContactsCount: number;
  permissionStatus: string;
  canListDeviceContacts: boolean;
  isContactPickerSupported: boolean;
  isLoading: boolean;
  onRefresh: () => void;
  onAddContact: () => void;
  onCallContact: (phone: string, name: string) => void;
};

export function EmergencyContactsList({
  contacts,
  deviceContactsCount,
  permissionStatus,
  canListDeviceContacts,
  isContactPickerSupported,
  isLoading,
  onRefresh,
  onAddContact,
  onCallContact,
}: EmergencyContactsListProps) {
  return (
    <div className="mx-5 mb-4">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          <Shield size={13} className="text-slate-500" />
          <p
            style={{ fontSize: "11px" }}
            className="font-medium uppercase tracking-wider text-gray-400"
          >
            {deviceContactsCount > 0
              ? "Contactos disponibles"
              : "Contactos de emergencia"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {permissionStatus === "granted" && canListDeviceContacts && (
            <button
              onClick={onRefresh}
              disabled={isLoading}
              className="flex items-center gap-1 text-slate-500 transition-colors hover:text-slate-700 disabled:opacity-50"
              style={{ fontSize: "11px" }}
            >
              <RefreshCcw size={12} />
              Actualizar
            </button>
          )}
          <button
            onClick={onAddContact}
            disabled={isLoading}
            className="flex items-center gap-1 text-blue-600 transition-colors hover:text-blue-700 disabled:opacity-50"
            style={{ fontSize: "11px" }}
          >
            <UserPlus size={12} />
            {canListDeviceContacts || isContactPickerSupported
              ? "Agregar"
              : "Manual"}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {contacts.map((contact) => (
          <motion.div
            key={contact.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className={`flex items-center gap-3 rounded-2xl border bg-white px-4 py-3 shadow-sm ${contact.isEmergency ? "border-red-100" : "border-gray-100"}`}
          >
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${contact.isEmergency ? "bg-red-100" : "bg-slate-100"}`}
            >
              <span
                style={{ fontSize: "12px" }}
                className={`font-bold ${contact.isEmergency ? "text-red-600" : "text-slate-600"}`}
              >
                {contact.initials || getInitials(contact.name)}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p
                style={{ fontSize: "13px" }}
                className="truncate font-medium text-slate-800"
              >
                {contact.name}
              </p>
              <p style={{ fontSize: "11px" }} className="text-gray-400">
                {contact.relation || "Contacto"} · {contact.phone}
              </p>
            </div>
            <button
              type="button"
              aria-label={`Llamar a ${contact.name}`}
              onClick={() => onCallContact(contact.phone, contact.name)}
              className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${contact.isEmergency ? "bg-red-500 active:bg-red-600" : "bg-slate-900 active:bg-slate-700"}`}
            >
              <Phone size={14} className="text-white" />
            </button>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
