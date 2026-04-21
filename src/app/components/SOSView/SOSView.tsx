import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AppHeader } from "../AppHeader";
import { AudioLevelIndicator } from "../AudioLevelIndicator";
import { MicButton, type MicButtonMode } from "../MicButton";
import { TranscriptOverlay } from "../TranscriptOverlay";
import { InlineErrorMessage } from "../InlineErrorMessage";
import { useAudio } from "../../hooks/useAudio";
import { useSOSInteractionController } from "../../hooks/useSOSInteractionController";
import { useContactPicker } from "../../hooks/useContactPicker";
import { SOSAlertPanel } from "./SOSAlertPanel";
import { SOSStatusCards } from "./SOSStatusCards";
import { ContactsPermissionCard } from "./ContactsPermissionCard";
import { ManualPhoneInput } from "./ManualPhoneInput";
import { EmergencyContactsList } from "./EmergencyContactsList";
import { useSOSCommandHandler } from "../../features/sos/useSOSCommandHandler";

const isDevelopment = import.meta.env.VITE_ENVIRONMENT !== "production";

export function SOSView() {
  const [sosActive, setSosActive] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const [locationShared, setLocationShared] = useState(false);
  const [messageSent, setMessageSent] = useState(false);

  const speechStatusIdRef = useRef(0);

  const {
    isSupported: isContactPickerSupported,
    isLoading: isContactPickerLoading,
    error: contactPickerError,
    savedContacts,
    deviceContacts,
    permissionStatus,
    canAutoDial,
    canListDeviceContacts,
    clearError: clearContactPickerError,
    saveContact,
    requestContactsAccess,
    refreshDeviceContacts,
    parseContactName,
    findContactByName,
    pickContact,
    callContact: triggerCall,
  } = useContactPicker();

  const audio = useAudio({
    sendSampleRate: 16000,
    enableEchoCancellation: true,
  });
  const {
    error: audioError,
    transcript: userTranscript,
    speakText,
    cancelSpeech,
  } = audio;

  const speakStatus = useCallback(
    async (text: string) => {
      const speechStatusId = speechStatusIdRef.current + 1;
      speechStatusIdRef.current = speechStatusId;
      cancelSpeech();
      try {
        await speakText(text);
      } finally {
        if (speechStatusIdRef.current !== speechStatusId) return;
      }
    },
    [cancelSpeech, speakText],
  );

  const cancelSOS = useCallback(() => {
    setSosActive(false);
    setLocationShared(false);
    setMessageSent(false);
    setCountdown(5);
  }, []);

  const commandHandler = useSOSCommandHandler({
    savedContacts,
    deviceContacts,
    permissionStatus,
    canAutoDial,
    canListDeviceContacts,
    isContactPickerSupported,
    clearContactPickerError,
    requestContactsAccess,
    refreshDeviceContacts,
    parseContactName,
    findContactByName,
    pickContact,
    saveContact,
    triggerCall,
    speakStatus,
    sosActive,
    setSosActive,
    cancelSOS,
  });

  const sosController = useSOSInteractionController({
    audio,
    processTranscript: commandHandler.handleVoiceCommand,
    speakStatus,
    onStatus: commandHandler.setVoiceStatus,
    onBeforeManualStart: commandHandler.handleBeforeManualStart,
    onCycleChange: commandHandler.setCommandCycle,
  });

  const isListening =
    sosController.mode === "starting" || sosController.mode === "listening";
  const micButtonMode: MicButtonMode =
    sosController.mode === "cancelling"
      ? "cancelling"
      : sosController.mode === "processing"
        ? "analyzing"
        : isListening
          ? "listening"
          : "idle";
  const displayError = sosController.errorMessage || audioError;

  useEffect(() => {
    if (!sosActive) {
      setCountdown(5);
      return;
    }

    if (countdown <= 0) {
      setLocationShared(true);
      setMessageSent(true);
      void speakStatus("Alerta de emergencia enviada. Ayuda en camino.");
      return;
    }

    const timer = setTimeout(() => setCountdown((current) => current - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown, sosActive, speakStatus]);

  useEffect(() => {
    if (
      permissionStatus === "granted" &&
      canListDeviceContacts &&
      deviceContacts.length === 0
    ) {
      void refreshDeviceContacts();
    }
  }, [
    canListDeviceContacts,
    deviceContacts.length,
    permissionStatus,
    refreshDeviceContacts,
  ]);

  useEffect(() => {
    if (userTranscript) {
      console.log("[Voice Transcript]", userTranscript);
    }
  }, [userTranscript]);

  return (
    <>
      <AppHeader />

      <div
        className="flex flex-1 flex-col overflow-y-auto pb-40 pt-10"
        style={{ background: "#F8FAFC" }}
      >
        <AnimatePresence>
          {(commandHandler.voiceStatus || contactPickerError) && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mx-5 mt-3"
            >
              <div
                className={`rounded-xl px-4 py-2.5 text-center ${
                  contactPickerError
                    ? "border border-red-200 bg-red-50"
                    : "border border-blue-200 bg-blue-50"
                }`}
                aria-live={contactPickerError ? "assertive" : "polite"}
              >
                <p
                  style={{ fontSize: "12px" }}
                  className={
                    contactPickerError ? "text-red-600" : "text-blue-700"
                  }
                >
                  {contactPickerError || commandHandler.voiceStatus}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <SOSAlertPanel
          sosActive={sosActive}
          countdown={countdown}
          onActivate={() => setSosActive(true)}
          onCancel={cancelSOS}
        />

        <SOSStatusCards
          locationShared={locationShared}
          messageSent={messageSent}
        />

        {canListDeviceContacts && permissionStatus !== "granted" && (
          <ContactsPermissionCard
            isLoading={isContactPickerLoading}
            onEnable={() => void commandHandler.handleEnableContacts()}
          />
        )}

        <ManualPhoneInput
          visible={commandHandler.showManualInput}
          value={commandHandler.manualPhone}
          onChange={commandHandler.setManualPhone}
          onSubmit={() => void commandHandler.handleManualCall()}
        />

        <EmergencyContactsList
          contacts={commandHandler.contacts}
          deviceContactsCount={deviceContacts.length}
          permissionStatus={permissionStatus}
          canListDeviceContacts={canListDeviceContacts}
          isContactPickerSupported={isContactPickerSupported}
          isLoading={isContactPickerLoading}
          onRefresh={() => void commandHandler.handleRefreshContacts()}
          onAddContact={() => void commandHandler.handleAddContactManual()}
          onCallContact={(phone, name) => {
            void commandHandler.callContact(phone, name);
          }}
        />

        <div className="pointer-events-none fixed bottom-0 left-0 right-0 z-40">
          <div className="mx-auto flex w-full max-w-sm flex-col items-center px-4 pb-6 pt-16">
            <div className="relative flex w-full flex-col items-center">
              <AudioLevelIndicator
                isListening={isListening}
                hasRealAudioLevel={sosController.hasRealAudioLevel}
                audioLevel={sosController.audioLevel}
                className="pointer-events-none left-1/2 top-0 -translate-x-1/2"
              />
              <TranscriptOverlay
                transcript={userTranscript}
                visible={isDevelopment}
                className="pointer-events-none bottom-[7rem] left-1/2 w-[calc(100%-2rem)] max-w-xs -translate-x-1/2"
              />
              <p
                style={{ fontSize: "12px" }}
                className="mb-3 text-center text-gray-400"
              >
                {sosController.statusMessage}
              </p>
              <div className="pointer-events-auto">
                <MicButton
                  mode={micButtonMode}
                  disabled={
                    sosController.mode === "starting" ||
                    sosController.mode === "cancelling"
                  }
                  onPress={() => void sosController.handleMicPress()}
                />
              </div>
            </div>
          </div>
        </div>

        <InlineErrorMessage message={displayError} />
      </div>
    </>
  );
}
