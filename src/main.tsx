import { createRoot } from "react-dom/client";
import App from "./app/App";
import "./styles/index.css";
import { StrictMode } from "react";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
