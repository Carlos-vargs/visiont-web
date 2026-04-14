import { useLocation } from "react-router";
import { Eye, ChevronLeft } from "lucide-react";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { useNavigate } from "react-router";
import { TopNav } from "./TopNav";

const viewTitles: Record<string, string> = {
  "/": "VisionAI",
  "/camera": "Modo Visor",
  "/sos": "Emergencia",
  "/settings": "Ajustes",
};

export function AppHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const title = viewTitles[location.pathname] ?? "VisionAI";
  const isHome = location.pathname === "/";

  return (
    <header
      className="w-full px-5 pt-4 pb-3 flex items-center justify-between"
      style={{ background: "#F8FAFC" }}
      aria-label="Encabezado de la aplicación"
    >
      {/* Left: back or logo */}
      <div className="flex items-center gap-2">
        {!isHome ? (
          <button
            onClick={() => navigate(-1)}
            aria-label="Volver atrás"
            className="w-8 h-8 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center active:bg-gray-50 transition-colors mr-1"
          >
            <ChevronLeft size={16} className="text-slate-700" />
          </button>
        ) : (
          <div className="w-8 h-8 rounded-xl bg-slate-900 flex items-center justify-center mr-1">
            <Eye size={16} className="text-white" strokeWidth={1.5} />
          </div>
        )}
        <h1
          style={{
            fontSize: "18px",
            fontWeight: 700,
            letterSpacing: "-0.02em",
          }}
          className="text-slate-900"
        >
          {title}
        </h1>
      </div>

      <TopNav />
    </header>
  );
}
