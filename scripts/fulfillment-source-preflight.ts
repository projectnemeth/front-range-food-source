import { open } from "node:fs/promises";
import { inspectSourceHeaders } from "../src/lib/fulfillment/source-preflight";

// No credentials, network requests, application imports or database writes.
async function main() {
  const path = process.argv[2];
  if (!path || process.argv.length !== 3) {
    console.error(
      "Usage: npm run fulfillment:preflight -- /absolute/path/to/header-review.json",
    );
    process.exitCode = 2;
  } else {
    try {
      const file = await open(path, "r");
      let input: string;
      try {
        const buffer = Buffer.alloc(256 * 1024 + 1);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        if (bytesRead > 256 * 1024) throw new Error("Input exceeds 256 KB");
        input = buffer.subarray(0, bytesRead).toString("utf8");
      } finally {
        await file.close();
      }
      const report = inspectSourceHeaders(JSON.parse(input));
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = report.layoutMatches ? 0 : 1;
    } catch {
      // Do not echo uploaded values, file paths or parser excerpts into logs.
      console.error(
        "Invalid header-review input. Supply a valid JSON snapshot and reviewed mapping (maximum 256 KB).",
      );
      process.exitCode = 2;
    }
  }
}
void main();
