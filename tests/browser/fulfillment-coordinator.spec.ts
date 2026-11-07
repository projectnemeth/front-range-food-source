import { test, expect } from "@playwright/test";
import { adminAuth, adminDb } from "../../src/lib/firebase-admin";
import { manifest } from "../fixtures/fulfillment";

test.skip(
  process.env.FULFILLMENT_PHASE_TWO_ENABLED !== "true",
  "Phase Two opt-in suite",
);
test("coordinator prepares a disabled event, reviews an import and enables dry packing", async ({
  page,
}) => {
  expect(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID).toBe("demo-food-source");
  expect(process.env.FIRESTORE_EMULATOR_HOST).toBe("127.0.0.1:8080");
  const uid = "setup-admin",
    email = "setup-admin@example.test";
  try {
    await adminAuth.createUser({ uid, email, password: "TestPassword123!" });
  } catch {
    await adminAuth.updateUser(uid, { password: "TestPassword123!" });
  }
  await adminDb
    .doc(`users/${uid}`)
    .set({ uid, role: "ADMIN", displayName: "Example Coordinator" });
  const eventId = `setup-${Date.now()}`;
  await page.goto("/staff/fulfillment");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("TestPassword123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Pickup event ID")).toBeVisible();
  await page.goto("/staff/fulfillment/coordinator");
  await page.getByText("Create a new event", { exact: true }).click();
  await page.getByLabel("New event ID", { exact: true }).fill(eventId);
  await page
    .getByLabel("Event name", { exact: true })
    .fill("Coordinator rehearsal");
  await page.getByLabel("Pickup date", { exact: true }).fill("2026-11-21");
  await page
    .getByLabel("Source scope (spreadsheet ID/tab ID)")
    .fill("example-sheet/tab");
  await page
    .getByLabel("Reviewed mapping version")
    .fill(manifest.mappingVersion);
  await page.getByRole("button", { name: "Create disabled event" }).click();
  await expect(
    page.getByRole("heading", { name: "Coordinator rehearsal · 2026-11-21" }),
  ).toBeVisible();
  expect(
    (await adminDb.doc(`fulfillmentEvents/${eventId}`).get()).data()!.enabled,
  ).toBe(false);
  await page.getByLabel("Position code").fill("Table B04");
  await page.getByLabel("Capacity in packages").fill("3");
  await page.getByRole("button", { name: "Save position" }).click();
  await expect(
    page.getByText("Table B04: 0/3 packages · active"),
  ).toBeVisible();
  const records = [{ ...manifest, eventId }];
  await page
    .getByLabel("Mapped order records", { exact: true })
    .fill(JSON.stringify(records));
  await page.getByRole("button", { name: "Generate import preview" }).click();
  await expect(
    page.getByText("Example household — new", { exact: true }),
  ).toBeVisible();
  expect(
    (
      await adminDb
        .collection("fulfillmentOrders")
        .where("manifest.eventId", "==", eventId)
        .get()
    ).size,
  ).toBe(0);
  await page
    .getByLabel("Mapped order records", { exact: true })
    .fill(JSON.stringify(records, null, 2));
  await expect(
    page.getByRole("button", { name: "Apply reviewed import" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Generate import preview" }).click();
  await expect(
    page.getByText("Example household — new", { exact: true }),
  ).toBeVisible();
  await page.getByText("Example household — new", { exact: true }).click();
  await expect(page.getByText(/Rice: 2 bags · Advance dry/)).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("coordinator-preview.png"),
    fullPage: true,
  });
  await page
    .getByLabel(
      "I reviewed the event, identities, quantities, instructions and preparation stages.",
    )
    .check();
  await page.getByRole("button", { name: "Apply reviewed import" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "1 new orders",
  );
  const orders = await adminDb
    .collection("fulfillmentOrders")
    .where("manifest.eventId", "==", eventId)
    .get();
  expect(orders.size).toBe(1);
  expect(orders.docs[0].data().portions.afterArrival.state).toBe("waiting");
  // Re-preview the same source as changed: it must not overwrite existing work.
  await page
    .getByLabel("Mapped order records", { exact: true })
    .fill(JSON.stringify([{ ...records[0], notes: "Changed source" }]));
  await page.getByRole("button", { name: "Generate import preview" }).click();
  await expect(
    page.getByText("Example household — blocked", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Apply reviewed import" }),
  ).toBeDisabled();
  await page
    .getByLabel("I intend to enable packing for this Phase Two event.")
    .check();
  await page
    .getByRole("button", { name: "Enable packing", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Pause packing", exact: true }),
  ).toBeVisible();
  await page.goto("/staff/fulfillment");
  await page.getByLabel("Pickup event ID").fill(eventId);
  await page.getByRole("button", { name: "Open event", exact: true }).click();
  await page.getByRole("button", { name: /Example household/ }).click();
  await expect(
    page.getByRole("button", { name: "Claim dry portion" }),
  ).toBeEnabled();
});
