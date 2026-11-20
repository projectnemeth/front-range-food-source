import { createSign } from "node:crypto";
import { PickupError } from "./model";
let cached: { token: string; expires: number } | undefined;
async function accessToken() {
  if (cached && cached.expires > Date.now() + 60000) return cached.token;
  const raw =
    process.env.PICKUP_GOOGLE_SERVICE_ACCOUNT_KEY ||
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw)
    throw new PickupError(
      503,
      "Configure server Google service-account credentials and share the response workbook with that account.",
    );
  const credentials = JSON.parse(raw) as {
    client_email: string;
    private_key: string;
  };
  const now = Math.floor(Date.now() / 1000),
    encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned =
    encode({ alg: "RS256", typ: "JWT" }) +
    "." +
    encode({
      iss: credentials.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    });
  const jwt =
    unsigned +
    "." +
    createSign("RSA-SHA256")
      .update(unsigned)
      .sign(credentials.private_key, "base64url");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!response.ok)
    throw new PickupError(
      503,
      "Google authorization failed; check the integration account.",
    );
  const body = await response.json();
  cached = {
    token: body.access_token,
    expires: Date.now() + Number(body.expires_in) * 1000,
  };
  return cached.token;
}
export function sourceId() {
  const id = process.env.PICKUP_SOURCE_SPREADSHEET_ID;
  if (!id || !/^[\w-]+$/.test(id))
    throw new PickupError(503, "Configure PICKUP_SOURCE_SPREADSHEET_ID.");
  return id;
}
export async function sheets(path: string, method = "GET", body?: unknown) {
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sourceId()}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
      cache: "no-store",
    },
  );
  if (!response.ok)
    throw new PickupError(
      503,
      `Google Sheets ${method} failed (${response.status}); attendance/check-ins remain saved. Check workbook sharing and API access.`,
    );
  return response.json();
}
export interface SourceTab {
  sheetId: number;
  title: string;
  rows: number;
  columns: number;
}
export async function tabs(): Promise<SourceTab[]> {
  const data = await sheets("?fields=sheets.properties");
  return data.sheets.map(
    (s: {
      properties: {
        sheetId: number;
        title: string;
        gridProperties: { rowCount: number; columnCount: number };
      };
    }) => ({
      sheetId: s.properties.sheetId,
      title: s.properties.title,
      rows: s.properties.gridProperties.rowCount,
      columns: s.properties.gridProperties.columnCount,
    }),
  );
}
export const quote = (title: string) => "'" + title.replace(/'/g, "''") + "'";
export async function values(tab: string, range: string): Promise<unknown[][]> {
  const data = await sheets(
    "/values/" +
      encodeURIComponent(quote(tab) + "!" + range) +
      "?valueRenderOption=FORMATTED_VALUE",
  );
  return data.values || [];
}
export const formulaSafe = (value: unknown) =>
  typeof value === "string" && /^\s*[=+@-]/.test(value)
    ? "'" + value
    : (value ?? "");
