import { RouterProvider } from "react-router";
import { router } from "./routes";
import { StrictMode } from "react";

export default function App() {
  return (
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>
  );
}
