import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatPickupDate,
  validDate,
  denverInstant,
  orderingOpen,
} from "../src/lib/dates";
import { orderSchema, profileSchema } from "../src/lib/schemas";
import { itemKeys, freshKeys } from "../src/lib/catalog";
import { messages } from "../src/lib/messages";
const order = {
  batchId: "test-batch",
  selectedItems: ["rice", "milkDairy"],
  otherItems: "",
  confirmedPickup: true,
  disclaimerAgreed: true,
  disclaimerVersion: "2026-11-03",
  dietaryRestrictions: {
    hasRestrictions: true,
    glutenFreeCount: 1,
    veganCount: 0,
  },
  babyNeeds: { hasBaby: false, needs: null, details: null },
};
test("calendar pickup dates preserve their day in all supported locales", () => {
  for (const tz of ["America/Denver", "America/Los_Angeles", "UTC"]) {
    process.env.TZ = tz;
    assert.equal(formatPickupDate("2026-11-07", "en-US"), "11/7/2026");
  }
  assert.equal(validDate("2026-02-30"), false);
  assert.equal(formatPickupDate("nonsense"), "—");
});
test("Denver schedules handle DST gaps and repeated hours explicitly", () => {
  assert.throws(() => denverInstant("2026-03-08T02:30"));
  assert.throws(() => denverInstant("2026-11-01T01:30"));
  assert.equal(
    denverInstant("2026-11-01T01:30", "-06:00"),
    "2026-11-01T07:30:00Z",
  );
  assert.equal(
    denverInstant("2026-11-01T01:30", "-07:00"),
    "2026-11-01T08:30:00Z",
  );
  assert.throws(() => denverInstant("2026-03-08T02:30", "-07:00"));
});
test("opening inclusive, closing exclusive and manual override still requires pickup", () => {
  const batch = {
    pickupDate: "2026-11-07",
    scheduledOpen: "2026-11-03T10:00:00Z",
    scheduledClose: "2026-11-03T11:00:00Z",
  };
  assert.equal(orderingOpen({}, batch, Date.parse(batch.scheduledOpen)), true);
  assert.equal(
    orderingOpen({}, batch, Date.parse(batch.scheduledClose)),
    false,
  );
  assert.equal(
    orderingOpen({ isFormOpen: false }, batch, Date.parse(batch.scheduledOpen)),
    false,
  );
  assert.equal(orderingOpen({ isFormOpen: true }, undefined), false);
});
test("order schema rejects spoofing, unknown items, missing consent and negative counts", () => {
  assert.equal(orderSchema.safeParse(order).success, true);
  for (const change of [
    { status: "COMPLETED" },
    { userId: "victim" },
    { pickupDate: "2026-11-08" },
    { selectedItems: ["unknown"] },
    { confirmedPickup: false },
    { disclaimerAgreed: false },
    {
      dietaryRestrictions: {
        hasRestrictions: true,
        glutenFreeCount: -1,
        veganCount: 0,
      },
    },
    {
      babyNeeds: {
        hasBaby: true,
        needs: { diapers: true, formula: false },
        details: { diaperSize: "", formulaType: "", other: "" },
      },
    },
  ])
    assert.equal(orderSchema.safeParse({ ...order, ...change }).success, false);
});
test("profiles reject arbitrary identity/role, invalid counties and empty households", () => {
  const profile = {
    firstName: "Ada",
    lastName: "Test",
    address: "1 Main St",
    phone: "(303) 555-1234",
    county: "Denver",
    foodBankId: "",
    familySize: { adults: 1, children: 0, seniors: 0 },
  };
  assert.equal(profileSchema.safeParse(profile).success, true);
  for (const change of [
    { uid: "victim" },
    { role: "ADMIN" },
    { county: "Unknown" },
    { familySize: { adults: 0, children: 0, seniors: 0 } },
  ])
    assert.equal(
      profileSchema.safeParse({ ...profile, ...change }).success,
      false,
    );
});
test("catalog keys are unique and every new message has all supported translations", () => {
  assert.equal(new Set(itemKeys).size, itemKeys.length);
  assert.equal(freshKeys.has("milkDairy"), true);
  assert.equal(freshKeys.has("rice"), false);
  assert.deepEqual(
    Object.keys(messages.es).sort(),
    Object.keys(messages.en).sort(),
  );
  assert.deepEqual(
    Object.keys(messages.ru).sort(),
    Object.keys(messages.en).sort(),
  );
});

// A visible raw key on a packing sheet is a fulfillment defect, not just a localization issue.
test("every packing category and item has a label in every supported language", async () => {
  const { translations } = await import("../src/lib/translations");
  const { checklistConfig } = await import("../src/lib/catalog");
  for (const [language, copy] of Object.entries(translations)) {
    const sections: Record<string, string> = copy.request.sections;
    const items: Record<string, string> = copy.request.items;
    for (const section of Object.keys(checklistConfig))
      assert.ok(sections[section], `${language}: ${section}`);
    for (const key of itemKeys) assert.ok(items[key], `${language}: ${key}`);
  }
});
