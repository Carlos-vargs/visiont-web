import { useState } from "react";
import { AppHeader } from "./AppHeader";
import { TopNav } from "./TopNav";
import {
  Volume2,
  Vibrate,
  Globe,
  Moon,
  BellRing,
  Wifi,
  ChevronRight,
  Mic,
  Eye,
  Contrast,
  HelpCircle,
} from "lucide-react";

type ToggleSetting = {
  id: string;
  icon: React.ComponentType<{
    size?: number;
    className?: string;
    strokeWidth?: number;
  }>;
  label: string;
  description: string;
  type: "toggle";
  defaultValue: boolean;
  color: string;
};

type SelectSetting = {
  id: string;
  icon: React.ComponentType<{
    size?: number;
    className?: string;
    strokeWidth?: number;
  }>;
  label: string;
  description: string;
  type: "select";
  value: string;
  color: string;
};

type Setting = ToggleSetting | SelectSetting;

const settingsGroups: { title: string; items: Setting[] }[] = [
  {
    title: "Accesibilidad",
    items: [
      {
        id: "contrast",
        icon: Contrast,
        label: "Alto contraste",
        description: "Mejora la visibilidad",
        type: "toggle",
        defaultValue: true,
        color: "bg-indigo-100 text-indigo-600",
      },
      {
        id: "large_text",
        icon: Eye,
        label: "Texto grande",
        description: "Tamaño de fuente aumentado",
        type: "toggle",
        defaultValue: false,
        color: "bg-blue-100 text-blue-600",
      },
    ],
  },
  {
    title: "Audio",
    items: [
      {
        id: "voice_feedback",
        icon: Volume2,
        label: "Respuesta de voz",
        description: "El asistente habla en voz alta",
        type: "toggle",
        defaultValue: true,
        color: "bg-emerald-100 text-emerald-600",
      },
      {
        id: "vibration",
        icon: Vibrate,
        label: "Vibración háptica",
        description: "Alertas táctiles",
        type: "toggle",
        defaultValue: true,
        color: "bg-purple-100 text-purple-600",
      },
      {
        id: "mic_sensitivity",
        icon: Mic,
        label: "Sensibilidad de micrófono",
        description: "Alta",
        type: "select",
        value: "Alta",
        color: "bg-orange-100 text-orange-600",
      },
    ],
  },
  {
    title: "Sistema",
    items: [
      {
        id: "language",
        icon: Globe,
        label: "Idioma",
        description: "Español",
        type: "select",
        value: "Español",
        color: "bg-sky-100 text-sky-600",
      },
      {
        id: "dark_mode",
        icon: Moon,
        label: "Modo oscuro",
        description: "Adaptar según la hora",
        type: "toggle",
        defaultValue: false,
        color: "bg-slate-200 text-slate-600",
      },
      {
        id: "notifications",
        icon: BellRing,
        label: "Notificaciones",
        description: "Activadas",
        type: "toggle",
        defaultValue: true,
        color: "bg-yellow-100 text-yellow-600",
      },
      {
        id: "wifi",
        icon: Wifi,
        label: "Solo Wi-Fi",
        description: "Guardar datos móviles",
        type: "toggle",
        defaultValue: false,
        color: "bg-cyan-100 text-cyan-600",
      },
    ],
  },
];

function Toggle({ value, onChange }: { value: boolean; onChange: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={value}
      onClick={onChange}
      className={`relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
        value ? "bg-slate-900" : "bg-gray-200"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
          value ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

const PROFILE_IMAGE =
  "https://images.unsplash.com/photo-1577565177023-d0f29c354b69?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxwZXJzb24lMjBwb3J0cmFpdCUyMGNsb3NlJTIwdXAlMjBwcm9maWxlfGVufDF8fHx8MTc3NTUyODg1Mnww&ixlib=rb-4.1.0&q=80&w=400";

export function SettingsView() {
  const [toggles, setToggles] = useState<Record<string, boolean>>(
    Object.fromEntries(
      settingsGroups.flatMap((g) =>
        g.items
          .filter((i): i is ToggleSetting => i.type === "toggle")
          .map((i) => [i.id, i.defaultValue]),
      ),
    ),
  );

  return (
    <>
      <div
        className="flex flex-col flex-1 pb-20 overflow-scroll [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ background: "#F8FAFC" }}
      >
        {/* Version / About */}
        <div className="mx-5 mt-3 mb-4 bg-gradient-to-br from-slate-900 to-slate-700 rounded-3xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center">
            <Eye size={20} className="text-white" strokeWidth={1.5} />
          </div>
          <div>
            <p
              style={{ fontSize: "15px" }}
              className="text-white font-semibold"
            >
              VisionAI
            </p>
            <p style={{ fontSize: "11px" }} className="text-slate-400">
              Versión 2.4.1 · Actualizado hoy
            </p>
          </div>
          <div className="ml-auto">
            <span
              className="bg-emerald-500 rounded-full px-2 py-0.5 text-white"
              style={{ fontSize: "10px" }}
            >
              Al día
            </span>
          </div>
        </div>

        {settingsGroups.map((group) => (
          <div key={group.title} className="mx-5 mb-4">
            <p
              style={{ fontSize: "11px" }}
              className="text-gray-400 uppercase tracking-wider px-1 mb-2"
            >
              {group.title}
            </p>
            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
              {group.items.map((item, idx) => (
                <div key={item.id}>
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div
                      className={`w-8 h-8 rounded-xl flex items-center justify-center ${item.color}`}
                    >
                      <item.icon size={15} strokeWidth={2} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        style={{ fontSize: "13px" }}
                        className="text-slate-800 font-medium"
                      >
                        {item.label}
                      </p>
                      <p
                        style={{ fontSize: "11px" }}
                        className="text-gray-400 truncate"
                      >
                        {item.description}
                      </p>
                    </div>
                    {item.type === "toggle" ? (
                      <Toggle
                        value={toggles[item.id] ?? false}
                        onChange={() =>
                          setToggles((t) => ({ ...t, [item.id]: !t[item.id] }))
                        }
                      />
                    ) : (
                      <div className="flex items-center gap-1">
                        <span
                          style={{ fontSize: "12px" }}
                          className="text-gray-400"
                        >
                          {item.value}
                        </span>
                        <ChevronRight size={14} className="text-gray-300" />
                      </div>
                    )}
                  </div>
                  {idx < group.items.length - 1 && (
                    <div className="ml-16 mr-4 h-px bg-gray-50" />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Help */}
        <div className="mx-5">
          <button className="w-full bg-white rounded-3xl shadow-sm border border-gray-100 px-4 py-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center">
              <HelpCircle size={15} className="text-blue-500" strokeWidth={2} />
            </div>
            <p
              style={{ fontSize: "13px" }}
              className="text-slate-800 font-medium"
            >
              Centro de ayuda y soporte
            </p>
            <ChevronRight size={14} className="text-gray-300 ml-auto" />
          </button>
        </div>
      </div>
      <TopNav />
    </>
  );
}
