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
      <TopNav />
    </header>
  );
}
