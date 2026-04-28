import { createRoot } from "react-dom/client";
import App from "./app/App";
import "./styles/index.css";
import { StrictMode } from "react";
import { initDebugTelemetry } from "./app/lib/debugTelemetry";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

initDebugTelemetry();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
