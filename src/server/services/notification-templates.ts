/**
 * RN-143: automatic notification texts come from a template per type (and reason).
 * The text is rendered when the notification is created and stored in the row, so
 * editing a template later does not change notifications already sent.
 *
 * RN-144 lists the expected types; each task adds the templates it needs here.
 */

const dateTimeFormat = new Intl.DateTimeFormat("es-ES", {
  timeZone: "Europe/Madrid",
  dateStyle: "long",
  timeStyle: "short",
});

/** "3 de diciembre de 2026 a las 10:30", always in Spanish time. */
export function formatDateTime(date: Date): string {
  return dateTimeFormat.format(date);
}

export interface RenderedNotification {
  title: string;
  body: string;
}

export const notificationTemplates = {
  VISIT_CONFIRMED: (p: { petName: string; startsAt: Date }): RenderedNotification => ({
    title: "Visita confirmada",
    body: `La protectora ha confirmado tu visita para conocer a ${p.petName} el ${formatDateTime(p.startsAt)}.`,
  }),

  VISIT_REJECTED: (p: { petName: string; startsAt: Date; reason: string | null }): RenderedNotification => ({
    title: "Visita rechazada",
    body:
      `La protectora ha rechazado tu solicitud de visita para conocer a ${p.petName} el ${formatDateTime(p.startsAt)}.` +
      (p.reason ? ` Motivo: ${p.reason}` : ""),
  }),

  /** RN-111: the shelter changed or deleted the slot; the adopter is invited to choose another one. */
  VISIT_VOIDED_SLOT_CANCELLED: (p: { petName: string; startsAt: Date }): RenderedNotification => ({
    title: "Visita anulada por cambio de turno",
    body:
      `La protectora ha cambiado o eliminado el turno de tu visita para conocer a ${p.petName} el ${formatDateTime(p.startsAt)}. ` +
      "Elige otro turno: la nueva visita quedará confirmada directamente.",
  }),
};

export type NotificationType = keyof typeof notificationTemplates;
export type NotificationParams<T extends NotificationType> = Parameters<(typeof notificationTemplates)[T]>[0];

export function renderNotification<T extends NotificationType>(
  type: T,
  params: NotificationParams<T>,
): RenderedNotification {
  const template = notificationTemplates[type] as (p: NotificationParams<T>) => RenderedNotification;
  return template(params);
}
