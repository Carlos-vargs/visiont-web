import { describe, expect, it } from "vitest";
import { getInitials, mergeContacts, normalizePhone } from "./contacts";

describe("contacts utils", () => {
  it("builds initials from a multi-part name", () => {
    expect(getInitials("Cruz Blanca")).toBe("CB");
  });

  it("normalizes phone numbers", () => {
    expect(normalizePhone("+502 5555-5555")).toBe("+50255555555");
  });

  it("merges contacts by phone and keeps emergency contacts first", () => {
    const contacts = mergeContacts(
      [
        {
          id: "2",
          name: "Ana",
          phone: "2222",
          isEmergency: false,
        },
      ],
      [
        {
          id: "1",
          name: "Cruz Blanca",
          phone: "128",
          isEmergency: true,
        },
        {
          id: "3",
          name: "Ana Perez",
          phone: "2222",
          isEmergency: false,
        },
      ],
    );

    expect(contacts).toHaveLength(2);
    expect(contacts[0].name).toBe("Cruz Blanca");
  });
});
