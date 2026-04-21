import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContactsPermissionCard } from "./ContactsPermissionCard";
import { ManualPhoneInput } from "./ManualPhoneInput";
import { EmergencyContactsList } from "./EmergencyContactsList";
import { SOSStatusCards } from "./SOSStatusCards";

describe("SOSView subcomponents", () => {
  it("renders permission card and calls enable handler", () => {
    const onEnable = vi.fn();

    render(
      <ContactsPermissionCard isLoading={false} onEnable={onEnable} />,
    );

    fireEvent.click(screen.getByText("Permitir"));
    expect(onEnable).toHaveBeenCalledTimes(1);
  });

  it("renders manual phone input when visible", () => {
    render(
      <ManualPhoneInput
        visible={true}
        value="+502 5555 5555"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(
      screen.getByPlaceholderText("+57 310 123 4567"),
    ).toBeInTheDocument();
  });

  it("renders emergency contacts list items and call button", () => {
    const onCallContact = vi.fn();

    render(
      <EmergencyContactsList
        contacts={[
          {
            id: "1",
            name: "Cruz Blanca",
            phone: "128",
            relation: "Emergencias",
            initials: "CB",
            isEmergency: true,
          },
        ]}
        deviceContactsCount={0}
        permissionStatus="prompt"
        canListDeviceContacts={false}
        isContactPickerSupported={true}
        isLoading={false}
        onRefresh={vi.fn()}
        onAddContact={vi.fn()}
        onCallContact={onCallContact}
      />,
    );

    fireEvent.click(screen.getByLabelText("Llamar a Cruz Blanca"));
    expect(onCallContact).toHaveBeenCalledWith("128", "Cruz Blanca");
  });

  it("renders SOS status cards", () => {
    render(<SOSStatusCards locationShared={true} messageSent={false} />);

    expect(screen.getByText("Compartida")).toBeInTheDocument();
    expect(screen.getByText("Listo")).toBeInTheDocument();
  });
});
