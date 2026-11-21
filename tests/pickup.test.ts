import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  parseSheet,
  mergeSource,
  normalize,
  BUILD,
} from "../src/lib/pickup/model";
import { renderZpl_ } from "../src/lib/pickup/label";
import { hostedHtml } from "../src/lib/pickup/template";
const headers = [
  "",
  "ID#",
  "First & Last Name ",
  "Phone Number ",
  "Total in Family",
];
test("hosted importer accepts known blank Date header, retains IDs/phones, and holds repeated IDs", () => {
  const parsed = parseSheet(headers, [
    ["today", "R1", "Pat Lee", "03035550101", "4"],
    ["today", "R2", "Kim", "No phone", "2"],
    ["tomorrow", "R2", "Kim", "No phone", "3"],
    ["", "", "", "", "Totals"],
  ]);
  assert.equal(parsed.assumedDateColumn, true);
  assert.equal(parsed.groups.size, 2);
  assert.equal(parsed.ignoredAfterList, 1);
  const event = {
    id: "sheet-12",
    label: "Saturday",
    sourceSheetId: 12,
    enabled: true,
  };
  const r = mergeSource("source", event, "R2", parsed.groups.get("R2")!);
  assert.equal(r.reviewRequired, true);
  assert.equal(r.duplicateCandidates!.length, 2);
  assert.throws(
    () =>
      parseSheet(
        ["Date", "ID#", "Wrong name", "Phone Number", "Total in Family"],
        [],
      ),
    /header/,
  );
  assert.throws(
    () => parseSheet(headers, [["today", "", "No ID", "No phone", 2]]),
    /Missing ID/,
  );
});
test("source refresh preserves arrival/history while changed duplicate sets invalidate review", () => {
  const event = {
    id: "sheet-12",
    label: "Saturday",
    sourceSheetId: 12,
    enabled: true,
  };
  const candidates = parseSheet(headers, [
    ["today", "R1", "Pat Lee", "No phone", 4],
  ]).groups.get("R1")!;
  const r = mergeSource("source", event, "R1", candidates);
  r.checkedInAt = "2026-11-20T18:00:00Z";
  r.previousNoShow = true;
  const again = mergeSource("source", event, "R1", candidates, r);
  assert.equal(again.revision, r.revision);
  assert.equal(again.checkedInAt, r.checkedInAt);
  assert.equal(again.previousNoShow, true);
  const changed = mergeSource(
    "source",
    event,
    "R1",
    [...candidates, { ...candidates[0], key: "different", householdSize: 5 }],
    r,
  );
  assert.equal(changed.reviewRequired, true);
  assert.equal(changed.revision, r.revision + 1);
});
test("hosted label renderer matches pilot output including small labels, accents and injection text", () => {
  const context = vm.createContext({});
  vm.runInContext(
    readFileSync("tools/pickup-station/Code.gs", "utf8"),
    context,
  );
  const pilot = context.renderZpl_ as typeof renderZpl_;
  for (const dpi of [203, 300] as const)
    for (const widthIn of [2.25, 3])
      for (const line of ["blue", "orange"] as const) {
        const r = {
            ...normalize({
              name: "María Guadalupe Hernández",
              phone: "^XZ ~JA",
              householdSize: 12,
            }),
            pickupType: "prepacked",
          },
          p = { id: 12, dpi, widthIn, heightIn: widthIn === 3 ? 2 : 1.25 },
          arrival = { number: "007", line, vehicle: "Silver van" };
        assert.equal(renderZpl_(r, p, 3, arrival), pilot(r, p, 3, arrival));
      }
});
test("hosted HTML uses same-origin API and server cookies, with no Google bridge or iframe", () => {
  const html = hostedHtml(false);
  assert.ok(!html.includes("google.script.run"));
  assert.ok(html.includes("credentials:'same-origin'"));
  assert.ok(html.includes('bootstrap.paired ? "hosted-cookie"'));
  assert.ok(html.includes('maxlength="6"'));
  assert.ok(html.includes(BUILD));
  for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g))
    new vm.Script(script[1]);
  assert.ok(hostedHtml(true).includes('data-coordinator="true"'));
});
