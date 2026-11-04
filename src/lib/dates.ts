import { Temporal } from "@js-temporal/polyfill";
export const BUSINESS_ZONE = "America/Denver";
export function validDate(value: string): boolean {
  try {
    return (
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Temporal.PlainDate.from(value).toString() === value
    );
  } catch {
    return false;
  }
}
export function formatPickupDate(value?: string, language = "en"): string {
  if (!value || !validDate(value)) return "—";
  return new Intl.DateTimeFormat(language, { timeZone: "UTC" }).format(
    new Date(`${value}T12:00:00Z`),
  );
}
// An explicit offset can resolve a repeated fall-back hour; nonexistent times always fail.
export function denverInstant(local: string, offset?: string): string {
  return Temporal.ZonedDateTime.from(
    `${local}${offset ?? ""}[${BUSINESS_ZONE}]`,
    { disambiguation: "reject", offset: "reject" },
  )
    .toInstant()
    .toString();
}
export function denverLocal(instant?: string): string {
  return instant
    ? Temporal.Instant.from(instant)
        .toZonedDateTimeISO(BUSINESS_ZONE)
        .toPlainDateTime()
        .toString()
        .slice(0, 16)
    : "";
}
export function orderingOpen(
  settings: { isFormOpen?: boolean | null },
  batch:
    | { pickupDate?: string; scheduledOpen?: string; scheduledClose?: string }
    | undefined,
  now = Date.now(),
): boolean {
  if (
    !batch?.pickupDate ||
    !validDate(batch.pickupDate) ||
    settings.isFormOpen === false
  )
    return false;
  if (settings.isFormOpen === true) return true;
  if (!batch.scheduledOpen || !batch.scheduledClose) return false;
  return (
    Date.parse(batch.scheduledOpen) <= now &&
    now < Date.parse(batch.scheduledClose)
  );
}
