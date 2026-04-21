import { BookUser } from "lucide-react";

type ContactsPermissionCardProps = {
  isLoading: boolean;
  onEnable: () => void;
};

export function ContactsPermissionCard({
  isLoading,
  onEnable,
}: ContactsPermissionCardProps) {
  return (
    <div className="mx-5 mb-4 rounded-2xl border border-blue-200 bg-white p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100">
          <BookUser size={18} className="text-blue-600" />
        </div>
        <div className="min-w-0 flex-1">
          <p style={{ fontSize: "13px" }} className="font-medium text-slate-800">
            Permitir acceso a tus contactos
          </p>
          <p style={{ fontSize: "11px" }} className="text-gray-500">
            Esto permite buscar contactos por voz y marcar automaticamente.
          </p>
        </div>
        <button
          onClick={onEnable}
          disabled={isLoading}
          className="rounded-full bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors active:bg-blue-700 disabled:opacity-50"
        >
          Permitir
        </button>
      </div>
    </div>
  );
}
