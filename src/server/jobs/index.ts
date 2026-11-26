import { liftExpiredBlocks } from "../services/adopter-blocks.js";
import { alertOverdueAdoptions, remindPendingAdoptions, remindPendingHandovers } from "../services/adoption-reminders.js";
import { completePastVisits, expireUnansweredVisits } from "../services/visit-attendance.js";
import { sendVisitReminders } from "../services/visit-reminders.js";

/** How often the scheduled jobs run. Every job is idempotent, so running it often is safe. */
const INTERVAL_MS = 60 * 1000;

const jobs: { name: string; run: () => Promise<number> }[] = [
  { name: "caducar visitas sin respuesta (CU-45)", run: expireUnansweredVisits },
  { name: "marcar visitas realizadas (CU-46)", run: completePastVisits },
  { name: "recordar visitas próximas (CU-53)", run: sendVisitReminders },
  { name: "recordar adopciones pendientes (CU-47)", run: remindPendingAdoptions },
  { name: "recordar entregas pendientes (CU-48)", run: remindPendingHandovers },
  { name: "avisar de adopciones sin completar en plazo (CU-48)", run: alertOverdueAdoptions },
  { name: "levantar bloqueos temporales cumplidos (CU-56)", run: liftExpiredBlocks },
];

async function runAll(): Promise<void> {
  for (const job of jobs) {
    try {
      await job.run();
    } catch (error) {
      console.error(`Error en la tarea programada "${job.name}":`, error);
    }
  }
}

/** Starts the scheduled jobs with setInterval (specifications §4). Returns a function that stops them. */
export function startJobs(): () => void {
  void runAll();
  const timer = setInterval(() => void runAll(), INTERVAL_MS);
  return () => {
    clearInterval(timer);
  };
}
