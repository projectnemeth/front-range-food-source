// Parse once and retain HTTP status even when a platform/proxy returns no JSON.
export async function pickupResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    const detail =
      response.status >= 500
        ? "The server could not start or complete the request. Check the pickup diagnostics and Vercel server configuration, then retry."
        : "Reload this page at /pickup/manage on the production website and retry.";
    throw new Error(
      `The pickup service returned ${text.trim() ? "an unexpected response" : "an empty response"} (HTTP ${response.status}). ${detail}`,
    );
  }
  if (!response.ok) {
    const error =
      body && typeof body === "object" && "error" in body
        ? body.error
        : undefined;
    throw new Error(
      typeof error === "string"
        ? error
        : `Pickup request failed (HTTP ${response.status}).`,
    );
  }
  if (!body || typeof body !== "object")
    throw new Error(
      "The pickup service returned an invalid response. Reload and retry.",
    );
  return body as T;
}
