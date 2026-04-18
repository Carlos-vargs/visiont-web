import { useState, useCallback, useEffect } from "react";

export type Contact = {
  id: string;
  name: string;
  phone: string;
  relation?: string;
  isEmergency?: boolean;
};

type UseContactPickerOptions = {
  onContactSelected?: (contact: Contact) => void;
  onError?: (error: string) => void;
};

export function useContactPicker(options: UseContactPickerOptions = {}) {
  const [isSupported, setIsSupported] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedContacts, setSavedContacts] = useState<Contact[]>([]);

  // Check if Contact Picker API is supported
  useEffect(() => {
    const supported = "ContactPicker" in window;
    setIsSupported(supported);
    
    // Load saved contacts from localStorage
    try {
      const stored = localStorage.getItem("sos-contacts");
      if (stored) {
        setSavedContacts(JSON.parse(stored));
      }
    } catch (err) {
      console.warn("Error loading saved contacts:", err);
    }
  }, []);

  // Save contact to localStorage
  const saveContact = useCallback((contact: Contact) => {
    const updated = [...savedContacts, contact];
    setSavedContacts(updated);
    try {
      localStorage.setItem("sos-contacts", JSON.stringify(updated));
    } catch (err) {
      console.warn("Error saving contact:", err);
    }
  }, [savedContacts]);

  // Parse voice command to extract contact name
  const parseContactName = useCallback((transcript: string): string | null => {
    const lower = transcript.toLowerCase().trim();
    
    const patterns = [
      /llamar\s+a\s+(.+)/i,
      /buscar\s+contacto\s+(.+)/i,
      /contacto\s+(.+)/i,
      /emergencia\s+(.+)/i,
    ];
    
    for (const pattern of patterns) {
      const match = lower.match(pattern);
      if (match && match[1]?.trim()) {
        return match[1].trim();
      }
    }
    
    if (lower.includes("emergencia") || lower.includes("ayuda")) {
      return "emergency";
    }
    
    return null;
  }, []);

  // Open native contact picker (requires user gesture)
  const pickContact = useCallback(async (): Promise<Contact | null> => {
    if (!isSupported) {
      const msg = "Función no disponible en este dispositivo";
      setError(msg);
      options.onError?.(msg);
      return null;
    }

    try {
      setIsLoading(true);
      setError(null);

      const props = ["name", "tel"] as const;
      const opts = { multiple: false, hint: "Selecciona un contacto de emergencia" };
      
      // @ts-ignore - ContactPicker is not in TypeScript DOM types yet
      const contacts = await navigator.contacts.select(props, opts);
      
      if (contacts && contacts[0]) {
        const contact: Contact = {
          id: crypto.randomUUID(),
          name: contacts[0].name || "Contacto desconocido",
          phone: contacts[0].tel?.[0] || "",
          relation: "Contacto de emergencia",
          isEmergency: true,
        };
        
        saveContact(contact);
        options.onContactSelected?.(contact);
        return contact;
      }
      
      return null;
    } catch (err: any) {
      if (err.name === "AbortError") return null;
      const msg = `Error al acceder a contactos: ${err.message}`;
      setError(msg);
      options.onError?.(msg);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, saveContact, options]);

  // Initiate call using tel: protocol
  const callContact = useCallback((phone: string) => {
    if (!phone) return;
    const cleanPhone = phone.replace(/[^\d+]/g, "");
    window.location.href = `tel:${cleanPhone}`;
  }, []);

  // Remove saved contact
  const removeSavedContact = useCallback((id: string) => {
    const updated = savedContacts.filter(c => c.id !== id);
    setSavedContacts(updated);
    try {
      localStorage.setItem("sos-contacts", JSON.stringify(updated));
    } catch (err) {
      console.warn("Error removing contact:", err);
    }
  }, [savedContacts]);

  return {
    isSupported,
    isLoading,
    error,
    savedContacts,
    parseContactName,
    pickContact,
    callContact,
    removeSavedContact,
  };
}