export type ContactLike = {
  id: string;
  name: string;
  phone: string;
  initials?: string;
  isEmergency?: boolean;
};

export const getInitials = (name: string): string =>
  name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

export const normalizePhone = (phone: string): string =>
  phone.replace(/[^\d+]/g, "");

export const mergeContacts = <T extends ContactLike>(...groups: T[][]): T[] => {
  const byPhone = new Map<string, T>();

  for (const group of groups) {
    for (const contact of group) {
      const key = normalizePhone(contact.phone) || contact.id;
      byPhone.set(key, {
        ...contact,
        initials: contact.initials || getInitials(contact.name),
      });
    }
  }

  return Array.from(byPhone.values()).sort((left, right) => {
    if (left.isEmergency && !right.isEmergency) return -1;
    if (!left.isEmergency && right.isEmergency) return 1;
    return left.name.localeCompare(right.name, "es");
  });
};
