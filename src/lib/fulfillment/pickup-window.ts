import { Temporal } from "@js-temporal/polyfill";

function distribution(date: Temporal.PlainDate) {
  return (
    date.dayOfWeek === 6 &&
    (date.day <= 7 || (date.day >= 15 && date.day <= 21))
  );
}

/** User-confirmed calendar rule; not a substitute for actual form opening/closing times. */
export function reviewPickupTimestamp(timestamp: string) {
  // Formatted US Sheets timestamp. Preserve the raw input in the calling review record.
  const match = timestamp
    .trim()
    .match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s+(AM|PM))?$/i,
    );
  if (!match)
    return { status: "timestampReviewRequired" as const, pickupDate: null };
  try {
    let hour = Number(match[4]);
    if (match[7]) {
      if (hour < 1 || hour > 12) throw new Error("Invalid hour");
      hour = (hour % 12) + (match[7].toUpperCase() === "PM" ? 12 : 0);
    }
    const local = Temporal.PlainDateTime.from(
      {
        year: Number(match[3]),
        month: Number(match[1]),
        day: Number(match[2]),
        hour,
        minute: Number(match[5]),
        second: Number(match[6] ?? 0),
      },
      { overflow: "reject" },
    );
    const date = local.toPlainDate();
    for (let offset = 0; offset <= 40; offset++) {
      const pickup = date.add({ days: offset });
      if (!distribution(pickup)) continue;
      let previous = pickup.subtract({ days: 1 });
      while (!distribution(previous)) previous = previous.subtract({ days: 1 });
      const opens = previous.add({ days: 2 }),
        closes = pickup.subtract({ days: 4 });
      if (
        Temporal.PlainDate.compare(date, opens) >= 0 &&
        Temporal.PlainDate.compare(date, closes) <= 0
      ) {
        return {
          status: "candidate" as const,
          pickupDate: pickup.toString(),
          opensOn: opens.toString(),
          closesOn: closes.toString(),
          boundaryClockReview: date.equals(opens) || date.equals(closes),
          sourceTimeZone: "America/Boise",
          eventReviewRequired: true as const,
        };
      }
    }
    return { status: "outsideOrderingDates" as const, pickupDate: null };
  } catch {
    return { status: "timestampReviewRequired" as const, pickupDate: null };
  }
}
