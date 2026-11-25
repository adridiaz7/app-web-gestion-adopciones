import { getConfig } from "../config.js";
import { withTransaction, type Db } from "../db/transaction.js";
import { markDueReminders } from "../models/visits.js";
import { createNotification } from "./notifications.js";

const HOUR = 60 * 60 * 1000;

/**
 * RN-197, CU-53: reminds the adopter of each confirmed visit that starts within the configured
 * notice and has not been reminded yet, with the date, the shelter's address and until when it
 * can be cancelled (RN-97). Visits cancelled, voided or rescheduled before are no longer
 * CONFIRMED, so they are skipped. With `visitId`, only that visit. Returns how many.
 */
export async function remindDueVisits(db: Db, visitId: number | null = null): Promise<number> {
  const rules = getConfig().rules;
  const visits = await markDueReminders(db, rules.visitReminderNoticeHours, visitId);
  for (const visit of visits) {
    const cancelUntil = new Date(visit.startsAt.getTime() - rules.visitCancelMinNoticeHours * HOUR);
    await createNotification(db, {
      userId: visit.adopterId,
      type: "VISIT_REMINDER",
      params: {
        petName: visit.petName,
        startsAt: visit.startsAt,
        shelterName: visit.shelterName,
        shelterAddress: visit.shelterAddress,
        cancelUntil: cancelUntil.getTime() > Date.now() ? cancelUntil : null,
      },
      link: { visitId: visit.id },
    });
  }
  return visits.length;
}

/** CU-53 (scheduled job): sends the due visit reminders. Idempotent. */
export async function sendVisitReminders(): Promise<number> {
  return withTransaction((client) => remindDueVisits(client));
}
