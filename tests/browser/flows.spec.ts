import { test, expect } from "@playwright/test";
import { itemKeys, freshKeys } from "../../src/lib/catalog";
import { adminAuth, adminDb } from "../../src/lib/firebase-admin";
const profile = {
  firstName: "Browser",
  lastName: "Family",
  address: "12 Test St",
  phone: "3035559876",
  county: "Denver",
  foodBankId: "BROWSER",
  familySize: { adults: 1, children: 0, seniors: 0 },
};
const fullProfile = {
  ...profile,
  firstName: "Admin",
  lastName: "Tester",
  phone: "3035550001",
  address: "99 Admin St",
  foodBankId: "ADMIN",
  uid: "browser-admin",
  email: "admin@example.test",
  displayName: "Browser Admin",
  role: "ADMIN",
};
test.beforeAll(async () => {
  for (const [uid, email] of [
    ["browser-admin", "admin@example.test"],
    ["browser-family", "family@example.test"],
  ]) {
    try {
      await adminAuth.createUser({ uid, email, password: "TestPassword123!" });
    } catch {
      await adminAuth.updateUser(uid, { password: "TestPassword123!" });
    }
  }
  await adminDb.doc("users/browser-admin").set(fullProfile);
  await adminDb.doc("users/browser-family").delete();
});
async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.locator("input[type=email]").fill(email);
  await page.locator("input[type=password]").fill("TestPassword123!");
  await page.getByRole("button", { name: "Login", exact: true }).click();
  await expect(page).toHaveURL("/");
}
test("incomplete profile retries after server failure without recreating login", async ({
  page,
}) => {
  await login(page, "family@example.test");
  await page
    .getByRole("link", { name: "Complete your family profile to continue." })
    .click();
  const fields = page.locator("form input");
  await fields.nth(0).fill(profile.firstName);
  await fields.nth(1).fill(profile.lastName);
  await fields.nth(2).fill(profile.address);
  await fields.nth(3).fill(profile.phone);
  await page.locator("select").selectOption("Denver");
  await page.route(
    "**/api/finalize-registration",
    (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "serverError" }),
      }),
    { times: 1 },
  );
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "Your login account is ready",
  );
  await expect(page.locator("input[type=email]")).toHaveCount(0);
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("link", {
      name: "Complete your family profile to continue.",
    }),
  ).toHaveCount(0);
});
test("Russian language survives reload", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("language", "ru"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
});
test("both print routes expose all fulfillment details and correct date", async ({
  page,
}) => {
  await adminDb.doc("batches/browser").set({
    id: "browser",
    name: "Browser pickup",
    pickupDate: "2026-11-07",
    status: "OPEN",
    createdAt: new Date().toISOString(),
  });
  await adminDb
    .doc("settings/global")
    .set({ currentBatchId: "browser", isFormOpen: true });
  await adminDb.doc("orders/browser-order").set({
    userId: "browser-admin",
    userName: "Browser Admin",
    userEmail: "admin@example.test",
    pickupDate: "2026-11-07",
    batchId: "browser",
    createdAt: new Date().toISOString(),
    selectedItems: ["rice", "milkDairy"],
    dryGoodsItems: ["rice"],
    freshGoodsItems: ["milkDairy"],
    dietaryRestrictions: {
      hasRestrictions: true,
      glutenFreeCount: 1,
      veganCount: 1,
    },
    babyNeeds: {
      hasBaby: true,
      needs: { diapers: true, formula: true },
      details: {
        diaperSize: "Size 3",
        formulaType: "Sensitive formula",
        other: "Baby note",
      },
    },
    otherItems: "Pack carefully",
    familySize: profile.familySize,
    packingStatus: { dryGoods: "PENDING", freshGoods: "PENDING" },
  });
  const base = (await adminDb.doc("orders/browser-order").get()).data()!;
  await adminDb.doc("orders/overflow-order").set({
    ...base,
    userName: "Long Request Family",
    selectedItems: itemKeys,
    dryGoodsItems: itemKeys.filter((k) => !freshKeys.has(k)),
    freshGoodsItems: itemKeys.filter((k) => freshKeys.has(k)),
    otherItems: "Long packing note with details. ".repeat(60),
    babyNeeds: {
      ...base.babyNeeds,
      details: {
        ...base.babyNeeds.details,
        other: "Baby details. ".repeat(130),
      },
    },
  });
  await login(page, "admin@example.test");
  await page.addInitScript(() => {
    window.print = () => {};
  });
  for (const route of ["/admin", "/admin/print"]) {
    await page.goto(route);
    await page
      .getByRole("button", { name: "Print loaded orders", exact: true })
      .click();
    await page.emulateMedia({ media: "print" });
    const print = page.locator("#print-container");
    await expect(print).toBeVisible();
    await expect(print).not.toContainText("request.sections.");
    await expect(print).toContainText("11/7/2026");
    await expect(print).toContainText("Gluten-free people: 1");
    await expect(print).toContainText("Sensitive formula");
    await expect(print).toContainText("Size 3");
    await expect(print).toContainText("Baby note");
    const pages = page.locator(".packing-pages .packing-page");
    expect(await pages.count()).toBeGreaterThanOrEqual(8);
    expect((await pages.count()) % 2).toBe(0);
    expect(
      await pages.evaluateAll((nodes) =>
        nodes.every((n) => n.scrollHeight <= n.clientHeight),
      ),
    ).toBe(true);
    await page.pdf({
      path: `test-results/${route.replaceAll("/", "-")}.pdf`,
      format: "Letter",
      preferCSSPageSize: true,
    });
    await page.emulateMedia({ media: "screen" });
  }
});
