import { describe, expect, it } from "vitest";
import { normalizeText } from "./text";

describe("normalizeText", () => {
  it("removes accents and punctuation while preserving words", () => {
    expect(normalizeText("¡Lláma a Mamá, por favor!")).toBe(
      "llama a mama por favor",
    );
  });
});
