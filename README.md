
  # Aplicación de asistencia visual

  This is a code bundle for Aplicación de asistencia visual. The original project is available at https://www.figma.com/design/hrkwPVLGnhva0FBsDph5B4/Aplicaci%C3%B3n-de-asistencia-visual.

  ## Running the code

  Run `npm i` to install the dependencies.

  Run `npm run dev` to start the development server.

  ## Native bridge contract

  The web app now supports an optional native bridge for contacts and phone calls.
  If the app runs inside a mobile WebView, expose either:

  1. `window.VisionTNativeBridge`
  2. `window.webkit.messageHandlers.visiontNativeBridge`

  Supported actions:

  - `getContactsPermissionStatus()` -> `"granted" | "denied" | "prompt"`
  - `requestContactsPermission()` -> `"granted" | "denied" | "prompt"`
  - `listContacts()` -> array of `{ id?, name, phone, relation? }`
  - `pickContact()` -> one contact object or an array with one contact
  - `placeCall({ phone, autoDial, name })` -> `true` when the native layer handled the call

  For the `webkit.messageHandlers.visiontNativeBridge` variant, the host should:

  - Receive `{ id, action, payload }`
  - Resolve with `window.__visiontNativeBridgeResolve(id, result)`
  - Reject with `window.__visiontNativeBridgeReject(id, error)`
  
