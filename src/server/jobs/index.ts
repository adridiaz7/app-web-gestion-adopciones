import { completePastVisits, expireUnansweredVisits } from "../services/visit-attendance.js";

/** How often the scheduled jobs run. Every job is idempotent, so running it often is safe. */
const INTERVAL_MS = 60 * 1000;

const jobs: { name: string; run: () => Promise<number> }[] = [
  { name: "caducar visitas sin respuesta (CU-45)", run: expireUnansweredVisits },
  { name: "marcar visitas realizadas (CU-46)", run: completePastVisits },
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
