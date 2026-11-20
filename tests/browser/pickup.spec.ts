import { test, expect, type Page } from "@playwright/test";
import { BUILD } from "../../src/lib/pickup/model";
async function fixture(page: Page) {
  const records = [
    {
      id: "fictional-1",
      eventId: "event",
      name: "Fictional Household",
      phone: "3035550101",
      phoneSearch: "3035550101",
      householdSize: 4,
      revision: 1,
      errors: [],
      jobs: [] as unknown[],
      lastJob: null as unknown,
    },
  ];
  let sends = 0;
  await page.route("**/api/pickup", async (route) => {
    const { method, args } = route.request().postDataJSON();
    let value: unknown;
    if (method === "getBootstrap")
      value = {
        authMode: "devices",
        paired: (await page.context().cookies()).some(
          (c) => c.name === "frfs_pickup",
        ),
      };
    else if (method === "getBuild") value = BUILD;
    else if (method === "enrollDevice") {
      expect(args[0]).toBe("123456");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: {
          "Set-Cookie":
            "frfs_pickup=fictional-cookie; Path=/; HttpOnly; SameSite=Strict; Max-Age=15552000",
        },
        body: JSON.stringify({
          label: "Test iPad",
          expiresAt: "2027-05-01T00:00:00Z",
        }),
      });
      return;
    } else if (method === "getStation")
      value = {
        admin: false,
        deviceLabel: "Test iPad",
        station: "Packing",
        configured: true,
        events: [{ id: "event", label: "Saturday" }],
        lastSync: null,
      };
    else if (method === "listRegistrations") value = records;
    else if (method === "requestAction") {
      const q = args[0];
      sends++;
      const r = records[0] as (typeof records)[0] & {
        checkedInAt?: string;
        arrival?: unknown;
        previousNoShow?: boolean;
        pickupType?: string;
        prepackedReason?: string;
      };
      r.checkedInAt = new Date().toISOString();
      r.arrival = q.arrival;
      r.previousNoShow = q.prepackedReason === "noShow";
      r.prepackedReason = q.prepackedReason;
      r.pickupType = q.prepackedReason ? "prepacked" : undefined;
      const job = {
        id: "fictional-job",
        status: "Submitted",
        providerId: 12345,
        action: "checkin",
        createdAt: r.checkedInAt,
        revision: 1,
        copies: q.copies,
        arrival: q.arrival,
      };
      r.jobs = [job];
      r.lastJob = job;
      value = {
        checkedInAt: r.checkedInAt,
        arrival: q.arrival,
        job: {
          id: "fictional-job",
          status: "Submitted",
          providerId: 12345,
          action: "checkin",
          createdAt: r.checkedInAt,
        },
      };
    } else throw Error("Unexpected pickup method " + method);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(value),
    });
  });
  return { sends: () => sends };
}
test("iPad pairs once, reloads with a private cookie, and filters a previous no-show check-in", async ({
  page,
}) => {
  await page.setViewportSize({ width: 834, height: 1112 });
  const f = await fixture(page);
  await page.goto("/pickup");
  await expect(
    page.getByRole("button", { name: "Authorize this iPad" }),
  ).toBeVisible();
  await page.getByLabel("Setup PIN").fill("123456");
  await page.getByRole("button", { name: "Authorize this iPad" }).click();
  await expect(
    page.getByRole("button", { name: /Fictional Household/ }),
  ).toBeVisible();
  expect(
    (await page.context().cookies()).find((c) => c.name === "frfs_pickup")
      ?.httpOnly,
  ).toBe(true);
  await page.reload();
  await expect(
    page.getByRole("button", { name: /Fictional Household/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Authorize this iPad" }),
  ).toBeHidden();
  await page.getByRole("button", { name: "Blue line", exact: true }).click();
  await page.getByRole("button", { name: /Fictional Household/ }).click();
  await page.getByRole("checkbox", { name: "No Show", exact: true }).check();
  for (const digit of ["0", "0", "7"])
    await page.getByRole("button", { name: digit, exact: true }).click();
  await page
    .getByRole("button", { name: "Check in to Blue line & print", exact: true })
    .click();
  await expect(page.locator("#detail")).toContainText("Previous No-Show");
  await page.getByLabel("Show households").selectOption("noShow");
  await expect(page.locator("#list")).toContainText("Fictional Household");
  await page.getByLabel("Show households").selectOption("expected");
  await expect(page.locator("#list")).not.toContainText("Fictional Household");
  expect(f.sends()).toBe(1);
  await page.screenshot({
    path: test.info().outputPath("hosted-pickup-ipad.png"),
    fullPage: true,
  });
});
test("staff HTML is a normal page with no Apps Script iframe or Google authorization", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/pickup");
  await expect(page.getByLabel("Setup PIN")).toHaveAttribute("maxlength", "6");
  expect(page.frames().length).toBe(1);
  await expect(page.getByText("DEMO", { exact: true })).toBeHidden();
});
