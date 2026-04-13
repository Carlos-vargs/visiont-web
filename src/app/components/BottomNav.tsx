import { Camera, Mic, AlertTriangle, Settings } from "lucide-react";
import { NavLink } from "react-router";

const navItems = [
  {
    path: "/",
    label: "Visor",
    icon: Mic,
    ariaLabel: "Abrir asistente de voz y camara",
  },
  {
    path: "/sos",
    label: "SOS",
    icon: AlertTriangle,
    isSOS: true,
    ariaLabel: "Botón de emergencia SOS",
  },
  {
    path: "/settings",
    label: "Ajustes",
    icon: Settings,
    ariaLabel: "Abrir ajustes",
  },
];

export function BottomNav() {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 w-full px-4 py-3 bg-white border-t border-gray-100 z-50"
      aria-label="Navegación principal"
    >
      <div className="flex items-center justify-between gap-2">
        {navItems.map((item) => (
          <NavLink
            key={item.path + item.label}
            to={item.path}
            end={item.path === "/"}
            aria-label={item.ariaLabel}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-2xl transition-all duration-200 select-none
              ${
                item.isSOS
                  ? isActive
                    ? "bg-orange-500 shadow-md"
                    : "bg-orange-100"
                  : isActive
                    ? "bg-slate-900 shadow-sm"
                    : "bg-gray-100 hover:bg-gray-150"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <item.icon
                  size={20}
                  strokeWidth={2}
                  className={
                    item.isSOS
                      ? isActive
                        ? "text-white"
                        : "text-orange-600"
                      : isActive
                        ? "text-white"
                        : "text-slate-700"
                  }
                  aria-hidden="true"
                />
                <span
                  style={{ fontSize: "10px", lineHeight: "1.2" }}
                  className={`font-medium tracking-wide
                  ${
                    item.isSOS
                      ? isActive
                        ? "text-white"
                        : "text-orange-700"
                      : isActive
                        ? "text-white"
                        : "text-slate-600"
                  }`}
                >
                  {item.label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
