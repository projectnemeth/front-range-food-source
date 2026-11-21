import type { PickupEvent } from "./model";
// Parse explicit tab dates rather than relying on Firestore document order or host Date parsing.
export function pickupTabDate(label: string, fallbackYear: number): number {
  let month: number, day: number, year: number;
  const numeric = label
    .trim()
    .match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?$/);
  const named = label.trim().match(/^([a-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?$/i);
  if (numeric) {
    month = Number(numeric[1]);
    day = Number(numeric[2]);
    year = numeric[3] ? Number(numeric[3]) : fallbackYear;
    if (year < 100) year += 2000;
  } else if (named) {
    month =
      [
        "jan",
        "feb",
        "mar",
        "apr",
        "may",
        "jun",
        "jul",
        "aug",
        "sep",
        "oct",
        "nov",
        "dec",
      ].indexOf(named[1].slice(0, 3).toLowerCase()) + 1;
    day = Number(named[2]);
    year = named[3] ? Number(named[3]) : fallbackYear;
  } else return -1;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date.getTime()
    : -1;
}
export function newestPickupEvents(
  events: PickupEvent[],
  year: number,
): PickupEvent[] {
  return [...events].sort(
    (a, b) =>
      pickupTabDate(b.label, year) - pickupTabDate(a.label, year) ||
      b.sourceSheetId - a.sourceSheetId,
  );
}
