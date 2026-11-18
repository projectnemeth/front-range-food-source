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
  await page.getByLabel("Allocation item key", { exact: true }).fill("rice");
  await page.getByLabel("Item name", { exact: true }).fill("Rice");
  await page
    .getByLabel("Unit or package size", { exact: true })
    .fill("1-pound bag");
  await page.getByLabel("Available units", { exact: true }).fill("12");
  await page.getByLabel("Registration reference 1", { exact: true }).fill("a");
  await page.getByLabel("Household name 1", { exact: true }).fill("Example A");
  await page.getByLabel("Household size 1", { exact: true }).fill("2");
  await page
    .getByRole("button", { name: "Add household", exact: true })
    .click();
  await page.getByLabel("Registration reference 2", { exact: true }).fill("b");
  await page.getByLabel("Household name 2", { exact: true }).fill("Example B");
  await page.getByLabel("Household size 2", { exact: true }).fill("4");
  await page
    .getByLabel(
      "I verified the complete eligible list, household sizes, item identity and stock for this event.",
    )
    .check();
  await page
    .getByRole("button", { name: "Propose quantities", exact: true })
    .click();
  await expect(
    page.getByLabel("Quantity for Example A", { exact: true }),
  ).toHaveValue("4");
  await expect(
    page.getByLabel("Quantity for Example B", { exact: true }),
  ).toHaveValue("8");
  await page.getByLabel("Quantity for Example A", { exact: true }).fill("3");
  await page
    .getByLabel(
      "I reviewed all quantities, including zero allocations, and rechecked available stock.",
    )
    .check();
  await page
    .getByRole("button", { name: "Approve allocation plan", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "Record a reason",
  );
  await page
    .getByLabel("Reason for changing Example A", { exact: true })
    .fill("Reserve one bag");
  await page
    .getByRole("button", { name: "Approve allocation plan", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Rice allocation — approved",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Approved total: 11 · unallocated: 1 1-pound bag", {
      exact: true,
    }),
  ).toBeVisible();
  expect(
    (
      await adminDb
        .doc(`fulfillmentEvents/${eventId}/allocationItems/rice`)
        .get()
    ).data()!.allocated,
  ).toBe(11);
  await page.screenshot({
    path: test.info().outputPath("allocation-review.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("allocation-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 720 });
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
  // An unstarted change shows both versions and requires explicit review.
  await page
    .getByLabel("Mapped order records", { exact: true })
    .fill(JSON.stringify([{ ...records[0], notes: "Changed source" }]));
  await page.getByRole("button", { name: "Generate import preview" }).click();
  await expect(
    page.getByText("Example household — update", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Previously accepted order" }),
  ).toBeVisible();
  await expect(
    page.getByText("Notes: Changed source", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel(
      "I reviewed the event, identities, quantities, instructions and preparation stages.",
    )
    .check();
  await page.getByRole("button", { name: "Apply reviewed import" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "1 unstarted orders updated",
  );
  expect((await orders.docs[0].ref.get()).data()!.manifest.notes).toBe(
    "Changed source",
  );
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
