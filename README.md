
  # Aplicación de asistencia visual

  This is a code bundle for Aplicación de asistencia visual. The original project is available at https://www.figma.com/design/hrkwPVLGnhva0FBsDph5B4/Aplicaci%C3%B3n-de-asistencia-visual.

  ## Running the code

  Run `npm i` to install the dependencies.

  Run `npm run dev` to start the development server.

  ## Slack debug integration

  Configure these variables to forward runtime debug activity to Slack:

  - `VITE_DEBUG_SLACK_ENABLED=true`
  - `VITE_DEBUG_SLACK_ENDPOINT=/api/debug/slack`
  - `VITE_DEBUG_SLACK_CAPTURE_IMAGES=true`
  - `SLACK_BOT_TOKEN=<bot token with chat:write and files:write>`
  - `SLACK_DEBUG_CHANNEL_ID=<channel id like C0123456789>`
  - `DEBUG_SLACK_ALLOWED_ORIGINS=https://tu-dominio.com,https://preview.tu-dominio.com`

  Notes:

  - The client never receives the Slack bot token. It only talks to `/api/debug/slack`.
  - Images sent to Gemini are uploaded to Slack as files using Slack's current external upload flow.
  - For local testing, prefer `vercel dev` or point `VITE_DEBUG_SLACK_ENDPOINT` at a deployed Vercel environment that exposes the API route.
  
