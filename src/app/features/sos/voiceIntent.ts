import { normalizeText } from "../../utils/text";

export type VoiceIntent =
  | { type: "activate_sos" }
  | { type: "cancel_sos" }
  | { type: "call"; contactName: string }
  | { type: "search_contact"; contactName?: string }
  | { type: "add_contact"; contactName?: string }
  | { type: "unknown" };

export const parseVoiceIntent = (
  transcript: string,
  parseContactName: (value: string) => string | null,
): VoiceIntent => {
  const normalized = normalizeText(transcript);
  const contactName = parseContactName(transcript) || undefined;

  if (
    /(activar|activa|envia|enviar|lanza|inicia).*(sos|emergencia|alerta)/.test(
      normalized,
    ) ||
    /(necesito ayuda|ayuda urgente|emergencia)/.test(normalized)
  ) {
    return { type: "activate_sos" };
  }

  if (
    /(cancela|cancelar|deten|detener|para|parar).*(sos|emergencia|alerta)?/.test(
      normalized,
    )
  ) {
    return { type: "cancel_sos" };
  }

  if (
    /(llama|llamar|marca|marcar|contacta|contactar|comunicate|comunicar)/.test(
      normalized,
    ) &&
    contactName
  ) {
    return { type: "call", contactName };
  }

  if (
    /(busca|buscar|buscame|encuentra|encontrar|muestrame|mostrar)\b/.test(
      normalized,
    )
  ) {
    return { type: "search_contact", contactName };
  }

  if (
    /(agrega|agregar|anade|añade|guarda|guardar|sincroniza|sincronizar)\b/.test(
      normalized,
    )
  ) {
    return { type: "add_contact", contactName };
  }

  return { type: "unknown" };
};
