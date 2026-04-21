import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SOSView } from "./SOSView";

const mockHandleMicPress = vi.fn();
const mockCallContact = vi.fn();

const mockAudioState = {
  error: null as string | null,
  transcript: "",
  speakText: vi.fn(),
  cancelSpeech: vi.fn(),
};

const mockControllerState = {
  mode: "idle" as
    | "idle"
    | "starting"
    | "listening"
    | "processing"
    | "cancelling"
    | "error",
  statusMessage: "Toca para hablar",
  errorMessage: null as string | null,
  isListening: false,
  isProcessingVoice: false,
  audioLevel: 0.5,
  hasRealAudioLevel: true,
  handleMicPress: mockHandleMicPress,
  cancelCurrentInteraction: vi.fn(),
};

const mockCommandHandlerState = {
  callContact: mockCallContact,
  contacts: [
    {
      id: "emergency-128",
      name: "Cruz Blanca",
      phone: "128",
      relation: "Emergencias",
      initials: "CB",
      isEmergency: true,
    },
  ],
  manualPhone: "",
  setManualPhone: vi.fn(),
  setVoiceStatus: vi.fn(),
  voiceStatus: "",
  showManualInput: false,
  setCommandCycle: vi.fn(),
  handleBeforeManualStart: vi.fn(),
  handleEnableContacts: vi.fn(),
  handleRefreshContacts: vi.fn(),
  handleAddContactManual: vi.fn(),
  handleManualCall: vi.fn(),
  handleVoiceCommand: vi.fn(),
};

const mockContactPickerState = {
  isSupported: true,
  isLoading: false,
  error: null as string | null,
  savedContacts: [],
  deviceContacts: [],
  permissionStatus: "prompt",
  canAutoDial: true,
  canListDeviceContacts: false,
  clearError: vi.fn(),
  saveContact: vi.fn(),
  requestContactsAccess: vi.fn().mockResolvedValue({ granted: false, contacts: [] }),
  refreshDeviceContacts: vi.fn().mockResolvedValue([]),
  parseContactName: vi.fn(() => null),
  findContactByName: vi.fn(() => null),
  pickContact: vi.fn().mockResolvedValue(null),
  callContact: vi.fn(),
};

vi.mock("../AppHeader", () => ({
  AppHeader: () => <div data-testid="app-header" />,
}));

vi.mock("../../hooks/useAudio", () => ({
  useAudio: () => mockAudioState,
}));

vi.mock("../../hooks/useSOSInteractionController", () => ({
  useSOSInteractionController: () => mockControllerState,
}));

vi.mock("../../hooks/useContactPicker", () => ({
  useContactPicker: () => mockContactPickerState,
}));

vi.mock("../../features/sos/useSOSCommandHandler", () => ({
  useSOSCommandHandler: () => mockCommandHandlerState,
}));

describe("SOSView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAudioState.error = null;
    mockAudioState.transcript = "";
    mockControllerState.mode = "idle";
    mockControllerState.statusMessage = "Toca para hablar";
    mockControllerState.errorMessage = null;
    mockControllerState.isListening = false;
    mockControllerState.isProcessingVoice = false;
    mockControllerState.audioLevel = 0.5;
    mockControllerState.hasRealAudioLevel = true;
    mockCommandHandlerState.voiceStatus = "";
    mockCommandHandlerState.showManualInput = false;
    mockCommandHandlerState.manualPhone = "";
    mockContactPickerState.error = null;
    mockContactPickerState.permissionStatus = "prompt";
    mockContactPickerState.canListDeviceContacts = false;
    mockContactPickerState.deviceContacts = [];
    mockContactPickerState.savedContacts = [];
  });

  afterEach(() => {
    cleanup();
  });

  it("renders shared mic button and keeps press wiring", () => {
    render(<SOSView />);

    fireEvent.click(screen.getByLabelText("Activar micrófono"));

    expect(mockHandleMicPress).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Toca para hablar")).toBeInTheDocument();
  });

  it("shows shared listening feedback and transcript overlay", () => {
    mockControllerState.mode = "listening";
    mockControllerState.isListening = true;
    mockControllerState.hasRealAudioLevel = false;
    mockAudioState.transcript = "llama a mamá";

    render(<SOSView />);

    expect(screen.getByLabelText("Detener y analizar")).toBeInTheDocument();
    expect(screen.getByText("Escuchando")).toBeInTheDocument();
    expect(screen.getByTestId("transcript-overlay")).toBeInTheDocument();
  });

  it("shows inline error message from controller or audio", () => {
    mockControllerState.errorMessage = "No pude procesar el comando de voz.";

    render(<SOSView />);

    expect(
      screen.getByText("No pude procesar el comando de voz."),
    ).toBeInTheDocument();
  });
});
