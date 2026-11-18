import { open } from "node:fs/promises";
import { reviewFormResponses } from "../src/lib/fulfillment/form-response-review";

// No credentials, network requests, application imports or database writes.
async function main() {
  const path = process.argv[2];
  if (!path || process.argv.length !== 3) {
    console.error(
      "Usage: npm run fulfillment:review-source -- /absolute/path/to/response-review.json",
    );
    process.exitCode = 2;
  } else {
    try {
      const file = await open(path, "r");
      let input: string;
      try {
        const buffer = Buffer.alloc(1024 * 1024 + 1);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        if (bytesRead > 1024 * 1024) throw new Error("Input exceeds 1 MB");
        input = buffer.subarray(0, bytesRead).toString("utf8");
      } finally {
        await file.close();
      }
      const report = reviewFormResponses(JSON.parse(input));
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = report.layout.layoutMatches ? 0 : 1;
    } catch {
      // Do not echo uploaded values, file paths or parser excerpts into logs.
      console.error(
        "Invalid response-review input. Supply a valid JSON header snapshot and at most 50 response rows (maximum 1 MB).",
      );
      process.exitCode = 2;
    }
  }
}
void main();
