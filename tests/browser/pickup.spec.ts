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
        actor: "device:test-ipad",
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
    } else if (method === "addWalkIn") {
      const q = args[0];
      expect(q.print).toBe(false);
      const row = {
        ...records[0],
        id: "fictional-walkup",
        name: q.name,
        phone: q.phone || "No phone",
        householdSize: q.householdSize,
        checkedInAt: new Date().toISOString(),
        arrival: q.arrival,
        pickupType: "prepacked",
        prepackedReason: "walkUp",
      };
      records.push(row);
      value = {
        id: row.id,
        checkedInAt: row.checkedInAt,
        arrival: row.arrival,
        job: null,
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

async function mockCoordinatorSignIn(
  page: Page,
  sessionStatus: number,
  sessionBody: string,
) {
  expect(process.env.FIREBASE_AUTH_EMULATOR_HOST).toBe("127.0.0.1:9099");
  const email = `pickup-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
  const created = await fetch(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: "FictionalPassword123!",
        returnSecureToken: true,
      }),
    },
  );
  expect(created.ok).toBe(true);
  let profileReads = 0;
  await page.route("**/api/profile", async (route) => {
    profileReads++;
    await route.fulfill({ status: 500, body: "" });
  });
  await page.route("**/api/pickup/session", async (route) => {
    await route.fulfill({
      status: sessionStatus,
      contentType: "application/json",
      body: sessionBody,
    });
  });
  return { email, profileReads: () => profileReads };
}
test("coordinator login explains empty server responses and stays on the pickup page", async ({
  page,
}) => {
  const f = await mockCoordinatorSignIn(page, 500, "");
  await page.goto("/pickup/manage");
  await page.getByLabel("Email", { exact: true }).fill(f.email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("FictionalPassword123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "empty response (HTTP 500)",
  );
  await expect(page).toHaveURL(/\/pickup\/manage$/);
  expect(f.profileReads()).toBe(0);
});
test("coordinator-only account signs in without a food-ordering profile", async ({
  page,
}) => {
  const f = await mockCoordinatorSignIn(
    page,
    200,
    JSON.stringify({ ok: true, owner: false }),
  );
  await page.goto("/pickup/manage");
  await page.getByLabel("Email", { exact: true }).fill(f.email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("FictionalPassword123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Signed in.");
  expect(f.profileReads()).toBe(0);
});

async function readyForCheckin(page: Page) {
  await page.goto("/pickup");
  await page.getByLabel("Setup PIN").fill("123456");
  await page.getByRole("button", { name: "Authorize this iPad" }).click();
  await page.getByRole("button", { name: "Blue line", exact: true }).click();
  await page.getByRole("button", { name: /Fictional Household/ }).click();
  for (const digit of ["0", "0", "7"])
    await page.getByRole("button", { name: digit, exact: true }).click();
}
test("a disconnected iPad keeps a check-in pending then sends it once when Wi-Fi returns", async ({
  page,
  context,
}) => {
  const f = await fixture(page);
  await readyForCheckin(page);
  await context.setOffline(true);
  await page
    .getByRole("button", { name: "Check in to Blue line & print", exact: true })
    .click();
  await expect(page.locator("#outbox")).toContainText(
    "1 check-in(s) saved on this iPad",
  );
  await expect(page.locator("#list")).toContainText("Waiting to sync");
  expect(f.sends()).toBe(0);
  await context.setOffline(false);
  await expect.poll(f.sends).toBe(1);
  await expect(page.locator("#outbox")).toBeHidden();
  await expect(page.locator("#list")).toContainText("Arrived");
  await page.reload();
  await expect(page.locator("#list")).toContainText("Arrived");
  expect(f.sends()).toBe(1);
});
test("a saved check-in survives reload and preserves its token after a network failure", async ({
  page,
}) => {
  const f = await fixture(page);
  let disconnected = true;
  const tokens: string[] = [];
  await page.route("**/api/pickup", async (route) => {
    const body = route.request().postDataJSON();
    if (body.method === "requestAction") {
      tokens.push(body.args[0].token);
      if (disconnected) {
        await route.abort("failed");
        return;
      }
    }
    await route.fallback();
  });
  await readyForCheckin(page);
  await page
    .getByRole("button", { name: "Check in to Blue line & print", exact: true })
    .click();
  await expect(page.locator("#outbox")).toContainText("1 check-in(s)");
  await page.reload();
  await expect(page.locator("#outbox")).toContainText("1 check-in(s)");
  disconnected = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(f.sends).toBe(1);
  await expect(page.locator("#outbox")).toBeHidden();
  expect(new Set(tokens).size).toBe(1);
});

test("a walk-up box given without a label is saved offline and reported after reconnecting", async ({
  page,
  context,
}) => {
  const f = await fixture(page);
  await readyForCheckin(page);
  await page
    .getByRole("button", { name: "+ Pre-Packed Pickup", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("Fictional Walk Up");
  for (const digit of ["0", "0", "9"])
    await page.getByRole("button", { name: digit, exact: true }).click();
  await context.setOffline(true);
  await page
    .getByRole("button", { name: "Record box given (no label)", exact: true })
    .click();
  await expect(page.locator("#outbox")).toContainText("Fictional Walk Up");
  await context.setOffline(false);
  await expect(page.locator("#list")).toContainText("Fictional Walk Up");
  await expect(page.locator("#outbox")).toBeHidden();
  expect(f.sends()).toBe(0);
});

test("all and expected families are alphabetical; arrived families sort numerically by vehicle", async ({
  page,
}) => {
  await fixture(page);
  const households = [
    { name: "Zulu", number: "002", arrived: true },
    { name: "Alpha", number: "010", arrived: true },
    { name: "Beta", number: undefined, arrived: true },
    { name: "Echo", number: undefined, arrived: false },
    { name: "Delta", number: undefined, arrived: false },
  ].map((r, i) => ({
    id: String(i),
    eventId: "event",
    name: r.name,
    phone: "No phone",
    phoneSearch: "",
    householdSize: 2,
    revision: 1,
    errors: [],
    jobs: [],
    lastJob: null,
    checkedInAt: r.arrived ? "2026-11-22T18:00:00Z" : null,
    arrival: r.number ? { number: r.number, line: "blue" } : null,
  }));
  await page.route("**/api/pickup", async (route) => {
    if (route.request().postDataJSON().method === "listRegistrations")
      await route.fulfill({ json: households });
    else await route.fallback();
  });
  await page.goto("/pickup");
  await page.getByLabel("Setup PIN").fill("123456");
  await page.getByRole("button", { name: "Authorize this iPad" }).click();
  const names = () =>
    page
      .locator("#list button.person")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.firstChild?.textContent),
      );
  await expect.poll(names).toEqual(["Alpha", "Beta", "Delta", "Echo", "Zulu"]);
  await page.getByLabel("Show households").selectOption("expected");
  await expect.poll(names).toEqual(["Delta", "Echo"]);
  await page.getByLabel("Show households").selectOption("arrived");
  await expect.poll(names).toEqual(["Zulu", "Alpha", "Beta"]);
  await page.getByLabel("Show households").selectOption("all");
  await expect.poll(names).toEqual(["Alpha", "Beta", "Delta", "Echo", "Zulu"]);
});
