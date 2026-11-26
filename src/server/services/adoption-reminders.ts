import { getConfig } from "../config.js";
import { withTransaction } from "../db/transaction.js";
import { markDueHandoverReminders, markDuePendingReminders, markOverdueAdoptions } from "../models/adoptions.js";
import { selectAdminIds } from "../models/users.js";
import { createNotification } from "./notifications.js";

/**
 * RN-122, CU-47 (scheduled job): reminds the shelter of each adoption request still PENDING
 * every configured number of days, counted from the request and then from the last reminder.
 * Idempotent. Returns how many reminders were sent.
 */
export async function remindPendingAdoptions(): Promise<number> {
  const days = getConfig().rules.adoptionReminderIntervalDays;
  return withTransaction(async (client) => {
    const adoptions = await markDuePendingReminders(client, days);
    for (const a of adoptions) {
      await createNotification(client, {
        userId: a.shelterId,
        type: "ADOPTION_PENDING_REMINDER",
        params: { petName: a.petName, adopterName: a.adopterName },
        link: { adoptionId: a.id },
      });
    }
    return adoptions.length;
  });
}

/**
 * RN-127, CU-48 (scheduled job): reminds the shelter of each APPROVED adoption without a
 * registered handover, every configured number of days since the approval. Once delivered
 * or cancelled it is no longer APPROVED, so the reminders stop. Idempotent.
 */
export async function remindPendingHandovers(): Promise<number> {
  const days = getConfig().rules.handoverReminderIntervalDays;
  return withTransaction(async (client) => {
    const adoptions = await markDueHandoverReminders(client, days);
    for (const a of adoptions) {
      await createNotification(client, {
        userId: a.shelterId,
        type: "HANDOVER_REMINDER",
        params: { petName: a.petName, adopterName: a.adopterName },
        link: { adoptionId: a.id },
      });
    }
    return adoptions.length;
  });
}

/**
 * RN-128, CU-48 (scheduled job): when an APPROVED adoption passes the configured deadline
 * without handover, the administrators are told once. Nothing else changes automatically.
 * Returns how many adoptions were reported.
 */
export async function alertOverdueAdoptions(): Promise<number> {
  const days = getConfig().rules.adoptionCompletionDeadlineDays;
  return withTransaction(async (client) => {
    const adoptions = await markOverdueAdoptions(client, days);
    if (adoptions.length === 0) return 0;
    const admins = await selectAdminIds(client);
    for (const a of adoptions) {
      for (const adminId of admins) {
        await createNotification(client, {
          userId: adminId,
          type: "ADOPTION_OVERDUE",
          params: { petName: a.petName, shelterName: a.shelterName, days },
          link: { adoptionId: a.id },
        });
      }
    }
    return adoptions.length;
  });
}
