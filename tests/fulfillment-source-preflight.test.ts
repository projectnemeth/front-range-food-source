import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inspectSourceHeaders,
  type SourcePreflightInput,
} from "../src/lib/fulfillment/source-preflight";

const fixture = (): SourcePreflightInput => ({
  snapshot: {
    sheetTitle: "Fictional pickup",
    columnCount: 6,
    headers: ["Timestamp", "ID#", "Name ", "Food requests", "Dietary", "Phone"],
  },
  mapping: {
    version: "fictional-only-v1",
    sheetTitle: "Fictional pickup",
    columnCount: 6,
    columns: [
      {
        index: 0,
        header: "Timestamp",
        role: "responseTimestamp",
        reason: "Candidate revision, not a unique identity",
      },
      {
        index: 1,
        header: "ID#",
        role: "registrationId",
        reason: "Duplicates need review",
      },
      {
        index: 2,
        header: "Name",
        role: "householdLabel",
        reason: "Packing label",
      },
      {
        index: 3,
        header: "Food requests",
        role: "request",
        reason: "Preserve original request",
      },
      {
        index: 4,
        header: "Dietary",
        role: "dietary",
        reason: "Show all instructions",
      },
      {
        index: 5,
        header: "Phone",
        role: "ignore",
        reason: "Contact data excluded from picking",
      },
    ],
  },
});
const codes = (input: SourcePreflightInput) =>
  inspectSourceHeaders(input).issues.map((i) => i.code);

test("matching reviewed headers tolerate trailing whitespace but never authorize import", () => {
  const input = fixture(),
    before = structuredClone(input);
  const report = inspectSourceHeaders(input);
  assert.equal(report.layoutMatches, true);
  assert.equal(report.importReady, false);
  assert.deepEqual(input, before);
  input.snapshot.headers[2] = "Name";
  assert.equal(
    inspectSourceHeaders(input).headerFingerprint,
    report.headerFingerprint,
  );
});

test("household-only and blank timestamp sources fail without inventing request columns", () => {
  const input = fixture();
  input.snapshot.headers[0] = null;
  input.snapshot.headers[3] = null;
  input.mapping.columns = input.mapping.columns.filter(
    (c) => c.role !== "request",
  );
  assert.ok(codes(input).includes("headerMismatch"));
  assert.ok(codes(input).includes("missingRole"));
});

test("added, renamed, reordered and duplicate headers block the layout", () => {
  for (const headers of [
    ["Timestamp", "ID#", "Name", "Food requests", "Dietary", "New question"],
    ["Timestamp", "Name", "ID#", "Food requests", "Dietary", "Phone"],
    ["Timestamp", "ID#", "Name", "Food requests", "Dietary", "Name "],
  ]) {
    const input = fixture();
    input.snapshot.headers = headers;
    assert.equal(inspectSourceHeaders(input).layoutMatches, false);
  }
  const input = fixture();
  input.mapping.columns.pop();
  assert.ok(codes(input).includes("unmappedColumn"));
});

test("wrong tabs, changed grid width, duplicate mappings and ambiguous identities are rejected", () => {
  const input = fixture();
  input.snapshot.sheetTitle = "Another pickup";
  input.snapshot.columnCount = 7;
  input.mapping.columns.push({ ...input.mapping.columns[0] });
  assert.ok(codes(input).includes("wrongSheet"));
  assert.ok(codes(input).includes("gridWidthChanged"));
  assert.ok(codes(input).includes("duplicateMapping"));
  assert.ok(codes(input).includes("ambiguousIdentity"));
  input.mapping.columns[0].index = 9;
  assert.ok(codes(input).includes("columnOutOfBounds"));
});

test("omitted trailing blank cells match explicit nulls while unreviewed fields cannot be dropped", () => {
  const input = fixture();
  input.snapshot.columnCount = input.mapping.columnCount = 8;
  const report = inspectSourceHeaders(input);
  assert.equal(report.layoutMatches, true);
  input.snapshot.headers.push(null, null);
  assert.equal(
    inspectSourceHeaders(input).headerFingerprint,
    report.headerFingerprint,
  );
  input.snapshot.headers[7] = "Special requests";
  assert.ok(codes(input).includes("unmappedColumn"));
});

test("invalid inputs and silent ignores are rejected", () => {
  assert.throws(() =>
    inspectSourceHeaders({ ...fixture(), rows: [["private"]] }),
  );
  const input = fixture();
  input.mapping.columns[5].reason = "";
  assert.throws(() => inspectSourceHeaders(input));
  input.mapping.columns[5].reason = "Excluded";
  input.snapshot.columnCount = 2;
  assert.throws(() => inspectSourceHeaders(input));
});

test("CLI reports success, blocked layouts and invalid inputs with distinct exit codes", () => {
  const dir = mkdtempSync(join(tmpdir(), "frfs-header-test-"));
  const path = join(dir, "headers.json");
  const run = () =>
    spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/fulfillment-source-preflight.ts", path],
      { encoding: "utf8" },
    );
  try {
    writeFileSync(path, JSON.stringify(fixture()));
    let result = run();
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).importReady, false);
    const input = fixture();
    input.snapshot.headers[0] = null;
    writeFileSync(path, JSON.stringify(input));
    result = run();
    assert.equal(result.status, 1);
    writeFileSync(path, '{"private data');
    result = run();
    assert.equal(result.status, 2);
    assert.equal(result.stderr.includes("private data"), false);
    writeFileSync(path, "x".repeat(256 * 1024 + 1));
    assert.equal(run().status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
