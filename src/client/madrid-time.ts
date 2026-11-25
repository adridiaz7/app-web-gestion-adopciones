// Pure helpers for Madrid local times (the app's reference time), with no DOM, so they can be unit-tested in Node.

const PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Madrid",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function madridParts(instant: Date): Record<string, string> {
  return Object.fromEntries(PARTS.formatToParts(instant).map((part) => [part.type, part.value]));
}

/** Minutes Madrid is ahead of UTC at that instant (60 in winter, 120 in summer). */
function offsetMinutes(instant: Date): number {
  const p = madridParts(instant);
  const asUtc = Date.UTC(Number(p["year"]), Number(p["month"]) - 1, Number(p["day"]), Number(p["hour"]), Number(p["minute"]));
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/** "2026-12-03" + "10:30" in Madrid → ISO instant. */
export function madridToIso(date: string, time: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const naive = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0);
  // Two passes, so a date near a change of time gets the offset of the final instant.
  let instant = naive - offsetMinutes(new Date(naive)) * 60000;
  instant = naive - offsetMinutes(new Date(instant)) * 60000;
  return new Date(instant).toISOString();
}

/** ISO instant → "YYYY-MM-DD" in Madrid. */
export function madridDate(iso: string): string {
  const p = madridParts(new Date(iso));
  return `${p["year"] ?? ""}-${p["month"] ?? ""}-${p["day"] ?? ""}`;
}

/** ISO instant → "HH:MM" in Madrid. */
export function madridTime(iso: string): string {
  const p = madridParts(new Date(iso));
  return `${p["hour"] ?? ""}:${p["minute"] ?? ""}`;
}
