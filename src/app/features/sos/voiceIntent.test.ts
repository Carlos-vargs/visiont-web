import { describe, expect, it, vi } from "vitest";
import { parseVoiceIntent } from "./voiceIntent";

describe("parseVoiceIntent", () => {
  const parseContactName = vi.fn((value: string) =>
    value.includes("mama") ? "mama" : null,
  );

  it("detects SOS activation intent", () => {
    expect(parseVoiceIntent("necesito ayuda urgente", parseContactName)).toEqual(
      { type: "activate_sos" },
    );
  });

  it("detects call intent with contact name", () => {
    expect(parseVoiceIntent("llama a mama", parseContactName)).toEqual({
      type: "call",
      contactName: "mama",
    });
  });

  it("falls back to unknown for unmatched commands", () => {
    expect(parseVoiceIntent("hola mundo", parseContactName)).toEqual({
      type: "unknown",
    });
  });
});
