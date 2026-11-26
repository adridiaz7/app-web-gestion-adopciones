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

/** RN-62, RN-66: why a pet was unlisted, as told to the adopter. */
export type UnlistReasonText = "DECEASED" | "TRANSFERRED" | "TREATMENT" | "FOSTER" | "ERROR" | "OTHER" | "REMOVED_BY_ADMIN";

/** RN-66: one sentence per unlisting reason; the shelter adds no free text. */
function unlistReasonText(petName: string, reason: UnlistReasonText): string {
  switch (reason) {
    case "DECEASED":
      return `Lamentamos comunicarte que ${petName} ha fallecido.`;
    case "TRANSFERRED":
      return `${petName} se ha trasladado a otro centro.`;
    case "TREATMENT":
      return `${petName} está en tratamiento veterinario y de momento no se puede visitar ni adoptar. Te avisaremos si vuelve a estar disponible.`;
    case "FOSTER":
      return `${petName} se ha ido a una casa de acogida. Te avisaremos si vuelve a estar disponible.`;
    case "ERROR":
      return `La ficha de ${petName} se ha retirado porque se publicó por error.`;
    case "OTHER":
      return `La protectora ha retirado a ${petName} de la adopción.`;
    case "REMOVED_BY_ADMIN":
      return `La ficha de ${petName} ha sido retirada por la administración de la plataforma.`;
  }
}

export const notificationTemplates = {
  /** RN-65, RN-66, RN-110: a visit voided because its pet was unlisted. */
  VISIT_VOIDED_PET_UNLISTED: (p: { petName: string; startsAt: Date; reason: UnlistReasonText }): RenderedNotification => ({
    title: "Visita anulada",
    body: `Tu visita para conocer a ${p.petName} el ${formatDateTime(p.startsAt)} se ha anulado. ${unlistReasonText(p.petName, p.reason)}`,
  }),

  /** CU-47, RN-122: a request still unanswered (to the shelter). */
  ADOPTION_PENDING_REMINDER: (p: { petName: string; adopterName: string }): RenderedNotification => ({
    title: "Solicitud de adopción pendiente",
    body: `${p.adopterName} sigue esperando tu respuesta a su solicitud para adoptar a ${p.petName}. Revisa los candidatos y apruébala o recházala.`,
  }),

  /** CU-48, RN-127: an approved adoption still without its handover (to the shelter). */
  HANDOVER_REMINDER: (p: { petName: string; adopterName: string }): RenderedNotification => ({
    title: "Entrega pendiente",
    body: `La adopción de ${p.petName} por ${p.adopterName} está aprobada, pero aún no has registrado la entrega. Regístrala cuando se la entregues.`,
  }),

  /** CU-48, RN-128: an approved adoption not completed within the deadline (to the administrator). */
  ADOPTION_OVERDUE: (p: { petName: string; shelterName: string; days: number }): RenderedNotification => ({
    title: "Adopción sin completar en plazo",
    body: `La adopción de ${p.petName} en ${p.shelterName} se aprobó hace más de ${String(p.days)} días y la entrega sigue sin registrarse. No se ha cambiado nada: revísalo.`,
  }),

  /** CU-29, RN-124: the adopter's request was approved. */
  ADOPTION_APPROVED: (p: { petName: string }): RenderedNotification => ({
    title: "Adopción aprobada",
    body: `¡Enhorabuena! La protectora ha aprobado tu solicitud para adoptar a ${p.petName}. Acordad la entrega por el chat.`,
  }),

  /** CU-30, RN-129: the adopter backed out of an approved adoption (to the shelter). */
  ADOPTION_CANCELLED_BY_ADOPTER: (p: { petName: string; reason: string }): RenderedNotification => ({
    title: "Adopción cancelada por el adoptante",
    body: `El adoptante ha cancelado la adopción aprobada de ${p.petName}. Motivo: ${p.reason}. ${p.petName} vuelve a estar disponible.`,
  }),

  /** CU-30, RN-129: the shelter backed out of an approved adoption (to the adopter). */
  ADOPTION_CANCELLED_BY_SHELTER: (p: { petName: string; reason: string }): RenderedNotification => ({
    title: "Adopción cancelada",
    body: `La protectora ha cancelado tu adopción aprobada de ${p.petName}. Motivo: ${p.reason}`,
  }),

  /** CU-29, RN-124: another candidate was chosen. */
  ADOPTION_NOT_SELECTED: (p: { petName: string }): RenderedNotification => ({
    title: "Solicitud de adopción no seleccionada",
    body: `La protectora ha elegido otro hogar para ${p.petName}. Gracias por tu interés: te avisaremos si vuelve a estar disponible.`,
  }),

  /** CU-29, RN-123: rejected with a reason. */
  ADOPTION_REJECTED: (p: { petName: string; reason: string }): RenderedNotification => ({
    title: "Solicitud de adopción rechazada",
    body: `La protectora ha rechazado tu solicitud para adoptar a ${p.petName}. Motivo: ${p.reason}`,
  }),

  /** RN-109, RN-110, RN-124: a visit voided because the pet was reserved for another adopter. */
  VISIT_VOIDED_PET_RESERVED: (p: { petName: string; startsAt: Date }): RenderedNotification => ({
    title: "Visita anulada",
    body: `Tu visita para conocer a ${p.petName} el ${formatDateTime(p.startsAt)} se ha anulado porque ${p.petName} ya está reservada.`,
  }),

  /** RN-65, RN-66: a pending adoption voided because its pet was unlisted. */
  ADOPTION_VOIDED_PET_UNLISTED: (p: { petName: string; reason: UnlistReasonText }): RenderedNotification => ({
    title: "Solicitud de adopción anulada",
    body: `Tu solicitud para adoptar a ${p.petName} se ha anulado. ${unlistReasonText(p.petName, p.reason)}`,
  }),

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

  /** CU-45, RN-95: the shelter did not answer in time. */
  VISIT_EXPIRED: (p: { petName: string; startsAt: Date }): RenderedNotification => ({
    title: "Solicitud de visita caducada",
    body:
      `La protectora no ha respondido a tiempo a tu solicitud de visita para conocer a ${p.petName} el ${formatDateTime(p.startsAt)}. ` +
      "Puedes solicitar otra.",
  }),

  /** RN-103, RN-110: voided because the adopter did not show up at another visit of the shelter. */
  VISIT_VOIDED_NO_SHOW: (p: { petName: string; startsAt: Date }): RenderedNotification => ({
    title: "Visita anulada",
    body:
      `Tu visita para conocer a ${p.petName} el ${formatDateTime(p.startsAt)} se ha anulado porque la protectora ha registrado ` +
      "que no acudiste a una visita confirmada.",
  }),

  /** RN-103: pending adoption voided for a no-show. */
  ADOPTION_VOIDED_NO_SHOW: (p: { petName: string }): RenderedNotification => ({
    title: "Solicitud de adopción anulada",
    body: `Tu solicitud para adoptar a ${p.petName} se ha anulado porque la protectora ha registrado que no acudiste a una visita confirmada.`,
  }),

  /** RN-103: approved adoption cancelled by the system for a no-show. */
  ADOPTION_CANCELLED_NO_SHOW: (p: { petName: string }): RenderedNotification => ({
    title: "Adopción cancelada",
    body: `Tu adopción aprobada de ${p.petName} se ha cancelado porque la protectora ha registrado que no acudiste a una visita confirmada.`,
  }),

  /** RN-103, RN-144: the pet is available again; for the adopters who were not selected. */
  PET_AVAILABLE_AGAIN: (p: { petName: string }): RenderedNotification => ({
    title: "Mascota disponible de nuevo",
    body: `${p.petName} vuelve a estar disponible para adopción.`,
  }),

  /** RN-100: the shelter cancelled a confirmed visit; it does not count for the quota. */
  VISIT_CANCELLED_BY_SHELTER: (p: { petName: string; startsAt: Date }): RenderedNotification => ({
    title: "Visita cancelada por la protectora",
    body:
      `La protectora ha cancelado tu visita para conocer a ${p.petName} el ${formatDateTime(p.startsAt)}. ` +
      "No te cuenta para el cupo de visitas: puedes solicitar otra.",
  }),

  /** CU-25: the adopter cancelled; the shelter is told (the other party). */
  VISIT_CANCELLED_BY_ADOPTER: (p: { petName: string; startsAt: Date }): RenderedNotification => ({
    title: "Visita cancelada por el adoptante",
    body: `El adoptante ha cancelado la visita para conocer a ${p.petName} el ${formatDateTime(p.startsAt)}. La plaza del turno queda libre.`,
  }),

  /** RN-197, CU-53: reminder of a confirmed visit; `cancelUntil` is null when it can no longer be cancelled (RN-98). */
  VISIT_REMINDER: (p: {
    petName: string;
    startsAt: Date;
    shelterName: string;
    shelterAddress: string;
    cancelUntil: Date | null;
  }): RenderedNotification => ({
    title: "Recordatorio de visita",
    body:
      `Tienes una visita para conocer a ${p.petName} el ${formatDateTime(p.startsAt)} en ${p.shelterName}, ${p.shelterAddress}. ` +
      (p.cancelUntil ? `Puedes cancelarla hasta el ${formatDateTime(p.cancelUntil)}.` : "Ya no se puede cancelar."),
  }),

  /** CU-51, RN-196: the adopter moved a visit to another slot; the new request awaits the shelter's answer. */
  VISIT_RESCHEDULED: (p: { petName: string; previousStartsAt: Date; startsAt: Date }): RenderedNotification => ({
    title: "Visita reprogramada por el adoptante",
    body:
      `El adoptante ha cambiado su visita para conocer a ${p.petName} del ${formatDateTime(p.previousStartsAt)} ` +
      `al ${formatDateTime(p.startsAt)}. La nueva solicitud está pendiente de tu respuesta.`,
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
