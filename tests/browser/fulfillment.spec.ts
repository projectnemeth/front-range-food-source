import { test, expect, type Page } from "@playwright/test";
import { adminAuth, adminDb } from "../../src/lib/firebase-admin";
import { createFulfillmentOrder } from "../../src/lib/fulfillment/model";
import { fulfillmentKey } from "../../src/lib/fulfillment/store";
import { manifest } from "../fixtures/fulfillment";

test.skip(
  process.env.FULFILLMENT_PHASE_TWO_ENABLED !== "true",
  "Phase Two opt-in test suite",
);
const eventId = "browser-dry-event";
const orderId = "browser-dry-order";
test.beforeEach(async () => {
  expect(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID).toBe("demo-food-source");
  expect(process.env.FIRESTORE_EMULATOR_HOST).toBe("127.0.0.1:8080");
  try {
    await adminAuth.createUser({
      uid: "dry-packer",
      email: "dry-packer@example.test",
      password: "TestPassword123!",
    });
  } catch {
    await adminAuth.updateUser("dry-packer", { password: "TestPassword123!" });
  }
  await adminDb.doc("users/dry-packer").delete();
  const event = adminDb.doc(`fulfillmentEvents/${eventId}`);
  await event.set({ enabled: true, status: "OPEN" });
  await event
    .collection("staff")
    .doc("dry-packer")
    .set({ active: true, role: "packer" });
  await event.collection("locations").doc(fulfillmentKey("Table B04")).set({
    active: true,
    code: "Table B04",
    capacity: 4,
    count: 0,
    orderId: null,
  });
  await adminDb
    .doc(`fulfillmentOrders/${orderId}`)
    .set(createFulfillmentOrder({ ...manifest, eventId, id: orderId }));
});
async function open(page: Page) {
  await page.goto("/staff/fulfillment");
  await page
    .getByLabel("Email", { exact: true })
    .fill("dry-packer@example.test");
  await page.getByLabel("Password", { exact: true }).fill("TestPassword123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Pickup event ID").fill(eventId);
  await page.getByRole("button", { name: "Open event", exact: true }).click();
  await page.getByRole("button", { name: /Example household/ }).click();
  await expect(
    page.getByRole("button", { name: "Claim dry portion" }),
  ).toBeEnabled();
}
test("staff without client profile can claim, pick and stage dry goods", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Claim dry portion" }).click();
  await expect(page.getByText("You are packing this order.")).toBeVisible();
  await page.getByRole("button", { name: "Picked Rice", exact: true }).click();
  await expect(page.getByText("2 packed · picked")).toBeVisible();
  await page
    .getByRole("button", { name: "Picked Diapers size 3", exact: true })
    .click();
  await expect(page.getByText("1 packed · picked")).toBeVisible();
  await page.getByLabel("Number of packages").fill("2");
  await page.getByLabel("Staging position").selectOption("Table B04");
  await page.getByRole("checkbox").check();
  await page.screenshot({
    path: test.info().outputPath("dry-packing-desktop.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Confirm dry packed and staged" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Dry portion staged" }),
  ).toBeVisible();
  const order = (
    await adminDb.doc(`fulfillmentOrders/${orderId}`).get()
  ).data()!;
  expect(order.packages).toHaveLength(2);
  expect(order.portions.afterArrival.state).toBe("waiting");
  expect(order.arrival).toBeNull();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: test.info().outputPath("dry-packing-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("lost save response retries the same operation without duplicate work", async ({
  page,
}) => {
  await open(page);
  let lost = false;
  await page.route("**/api/fulfillment/dry", async (route) => {
    if (route.request().method() === "POST" && !lost) {
      lost = true;
      await route.fetch(); // Commit the command, then lose only its response.
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Claim dry portion" }).click();
  await expect(
    page.getByRole("button", { name: "Retry same save" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry same save" }).click();
  await expect(page.getByText("You are packing this order.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry same save" }),
  ).toHaveCount(0);
  expect(
    (await adminDb.doc(`fulfillmentOrders/${orderId}`).get()).data()!.version,
  ).toBe(1);
});

test("stale claim refreshes ownership and prevents another picker from editing", async ({
  page,
}) => {
  await open(page);
  await adminDb.doc(`fulfillmentOrders/${orderId}`).update({
    version: 1,
    "portions.advanceDry.owner": "another-volunteer",
    "portions.advanceDry.state": "picking",
  });
  await page.getByRole("button", { name: "Claim dry portion" }).click();
  await expect(
    page.getByText("Assigned to another-volunteer.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Picked Rice", exact: true }),
  ).toBeDisabled();
});

test("revoked access removes the checklist and offline state disables writes", async ({
  page,
  context,
}) => {
  await open(page);
  await context.setOffline(true);
  await expect(
    page.getByRole("button", { name: "Claim dry portion" }),
  ).toBeDisabled();
  await context.setOffline(false);
  await adminDb
    .doc(`fulfillmentEvents/${eventId}/staff/dry-packer`)
    .update({ active: false });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "does not have dry-packing access",
  );
  await expect(
    page.getByRole("button", { name: "Claim dry portion" }),
  ).toHaveCount(0);
});
