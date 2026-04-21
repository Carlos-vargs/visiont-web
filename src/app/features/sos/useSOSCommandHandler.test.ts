import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSOSCommandHandler } from "./useSOSCommandHandler";

const createOptions = () => ({
  savedContacts: [],
  deviceContacts: [],
  permissionStatus: "prompt" as const,
  canAutoDial: true,
  canListDeviceContacts: false,
  isContactPickerSupported: false,
  clearContactPickerError: vi.fn(),
  requestContactsAccess: vi.fn().mockResolvedValue({
    granted: false,
    contacts: [],
  }),
  refreshDeviceContacts: vi.fn().mockResolvedValue([]),
  parseContactName: vi.fn((value: string) =>
    value.includes("mama") ? "mama" : null,
  ),
  findContactByName: vi.fn(() => undefined),
  pickContact: vi.fn().mockResolvedValue(null),
  saveContact: vi.fn((contact) => contact),
  triggerCall: vi.fn().mockResolvedValue(true),
  speakStatus: vi.fn().mockResolvedValue(undefined),
  sosActive: false,
  setSosActive: vi.fn(),
  cancelSOS: vi.fn(),
});

describe("useSOSCommandHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("falls back to manual input when no contact access is available", async () => {
    const options = createOptions();
    const { result } = renderHook(() => useSOSCommandHandler(options));

    await act(async () => {
      result.current.setCommandCycle(1);
      await result.current.handleVoiceCommand("llama a mama", 1);
    });

    expect(result.current.showManualInput).toBe(true);
    expect(result.current.voiceStatus).toContain(
      "Ingresa el numero manualmente",
    );
  });

  it("handles manual call submission and resets the form", async () => {
    const options = createOptions();
    const { result } = renderHook(() => useSOSCommandHandler(options));

    await act(async () => {
      result.current.setManualPhone("+502 5555 5555");
    });

    await act(async () => {
      await result.current.handleManualCall();
    });

    expect(options.triggerCall).toHaveBeenCalledWith(
      "+502 5555 5555",
      "ese numero",
    );
    expect(result.current.manualPhone).toBe("");
  });

  it("activates SOS from a matching voice command", async () => {
    const options = createOptions();
    const { result } = renderHook(() => useSOSCommandHandler(options));

    await act(async () => {
      result.current.setCommandCycle(2);
      await result.current.handleVoiceCommand("necesito ayuda urgente", 2);
    });

    expect(options.setSosActive).toHaveBeenCalledWith(true);
  });
});
