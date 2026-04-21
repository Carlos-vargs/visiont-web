import { MapPin, MessageSquare } from "lucide-react";

type SOSStatusCardsProps = {
  locationShared: boolean;
  messageSent: boolean;
};

export function SOSStatusCards({
  locationShared,
  messageSent,
}: SOSStatusCardsProps) {
  return (
    <div className="mx-5 mb-4 flex gap-2">
      <div
        className={`flex flex-1 items-center gap-2 rounded-2xl border p-3 transition-colors ${locationShared ? "border-emerald-200 bg-emerald-50" : "border-gray-100 bg-white"}`}
      >
        <MapPin
          size={16}
          className={locationShared ? "text-emerald-600" : "text-gray-400"}
        />
        <div>
          <p
            style={{ fontSize: "10px" }}
            className={`font-medium uppercase tracking-wide ${locationShared ? "text-emerald-700" : "text-gray-400"}`}
          >
            Ubicacion
          </p>
          <p
            style={{ fontSize: "11px" }}
            className={locationShared ? "text-emerald-600" : "text-gray-500"}
          >
            {locationShared ? "Compartida" : "Lista para enviar"}
          </p>
        </div>
      </div>

      <div
        className={`flex flex-1 items-center gap-2 rounded-2xl border p-3 transition-colors ${messageSent ? "border-emerald-200 bg-emerald-50" : "border-gray-100 bg-white"}`}
      >
        <MessageSquare
          size={16}
          className={messageSent ? "text-emerald-600" : "text-gray-400"}
        />
        <div>
          <p
            style={{ fontSize: "10px" }}
            className={`font-medium uppercase tracking-wide ${messageSent ? "text-emerald-700" : "text-gray-400"}`}
          >
            Mensaje
          </p>
          <p
            style={{ fontSize: "11px" }}
            className={messageSent ? "text-emerald-600" : "text-gray-500"}
          >
            {messageSent ? "Enviado" : "Listo"}
          </p>
        </div>
      </div>
    </div>
  );
}
