import { createBrowserRouter } from "react-router";
import { VoiceView } from "./components/VoiceView";
import { CameraView } from "./components/CameraView";
import { SOSView } from "./components/SOSView";
import { SettingsView } from "./components/SettingsView";

export const router = createBrowserRouter([
  { path: "/", Component: VoiceView },
  { path: "/camera", Component: CameraView },
  { path: "/sos", Component: SOSView },
  { path: "/settings", Component: SettingsView },
]);
