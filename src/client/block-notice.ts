// Pure helper for the restricted-access notice, with no DOM, so it can be unit-tested in Node.

const DATE = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "long", year: "numeric" });

/** RN-149: neutral text for a blocked adopter; with the end date when the block is temporary. */
export function blockNoticeText(shelterName: string, endsAt: string | null): string {
  const base = `La protectora ${shelterName} ha restringido tu acceso a sus mascotas`;
  return endsAt ? `${base} hasta el ${DATE.format(new Date(endsAt))}.` : `${base}.`;
}
