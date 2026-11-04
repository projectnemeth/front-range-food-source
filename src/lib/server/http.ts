import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { adminAuth, adminDb } from "../firebase-admin";
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export async function identity(request: Request) {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) throw new HttpError(401, "unauthorized");
  try {
    return await adminAuth.verifyIdToken(header.slice(7), true);
  } catch {
    throw new HttpError(401, "unauthorized");
  }
}
export async function administrator(request: Request) {
  const token = await identity(request);
  if ((await adminDb.doc(`users/${token.uid}`).get()).data()?.role !== "ADMIN")
    throw new HttpError(403, "forbidden");
  return token;
}
export async function json(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 20000)
    throw new HttpError(413, "invalidInput");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "invalidInput");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 20000) {
        await reader.cancel();
        throw new HttpError(413, "invalidInput");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, "invalidInput");
  }
}
export function failure(error: unknown) {
  if (error instanceof ZodError)
    return NextResponse.json(
      {
        error: "invalidInput",
        fields: error.issues.map((v) => ({
          path: v.path.join("."),
          message: v.message,
        })),
      },
      { status: 400 },
    );
  if (error instanceof HttpError)
    return NextResponse.json({ error: error.code }, { status: error.status });
  console.error(
    "Request failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return NextResponse.json({ error: "serverError" }, { status: 500 });
}
