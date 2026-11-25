// Pure helpers about ages, with no DOM, so they can be unit-tested in Node.

/** RN-205: under a year, in months; from a year on, in years. */
export function ageLabel(birthDate: string, today = new Date()): string {
  const [year, month, day] = birthDate.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return "";
  let months = (today.getFullYear() - year) * 12 + (today.getMonth() + 1 - month);
  if (today.getDate() < day) months -= 1;
  months = Math.max(months, 0);
  if (months < 12) return months === 1 ? "1 mes" : `${String(months)} meses`;
  const years = Math.floor(months / 12);
  return years === 1 ? "1 año" : `${String(years)} años`;
}

/** RN-205: choices for a minimum or maximum age, in months (gallery filters and preferences). */
export const AGE_CHOICES: [months: string, label: string][] = [
  ["0", "0 meses"],
  ["6", "6 meses"],
  ["12", "1 año"],
  ["24", "2 años"],
  ["36", "3 años"],
  ["60", "5 años"],
  ["96", "8 años"],
  ["120", "10 años"],
];
