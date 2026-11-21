export class FirebaseConfigurationError extends Error {
  readonly code = "firebaseServerConfiguration";
  constructor(message: string) {
    super(message);
    this.name = "FirebaseConfigurationError";
  }
}
export function adminConfiguration(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const projectId = env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  if (!projectId)
    throw new FirebaseConfigurationError(
      "Set NEXT_PUBLIC_FIREBASE_PROJECT_ID in Vercel's Production environment, then redeploy.",
    );
  const raw = env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim().replace(/^\uFEFF/, "");
  if (!raw) {
    if (env.VERCEL === "1" && !env.GOOGLE_APPLICATION_CREDENTIALS)
      throw new FirebaseConfigurationError(
        "Set FIREBASE_SERVICE_ACCOUNT_KEY in Vercel's Production environment to the entire Firebase service-account JSON file, then redeploy.",
      );
    return { projectId };
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new FirebaseConfigurationError(
      "FIREBASE_SERVICE_ACCOUNT_KEY is not valid JSON. Paste the entire downloaded JSON file into Vercel, including braces, without extra wrapping quotes, then redeploy.",
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new FirebaseConfigurationError(
      "FIREBASE_SERVICE_ACCOUNT_KEY must contain the JSON object from the downloaded service-account file, not a filename or a quoted JSON string.",
    );
  const data = value as Record<string, unknown>;
  const serviceProject = data.project_id ?? data.projectId;
  const clientEmail = data.client_email ?? data.clientEmail;
  const privateKey = data.private_key ?? data.privateKey;
  if (
    typeof serviceProject !== "string" ||
    typeof clientEmail !== "string" ||
    typeof privateKey !== "string" ||
    !clientEmail ||
    !privateKey
  )
    throw new FirebaseConfigurationError(
      "The server key must include project_id, client_email and private_key. Paste the entire Firebase service-account JSON file, then redeploy.",
    );
  if (serviceProject !== projectId)
    throw new FirebaseConfigurationError(
      "NEXT_PUBLIC_FIREBASE_PROJECT_ID does not match project_id in FIREBASE_SERVICE_ACCOUNT_KEY. Use settings and a service account from the same Firebase project, then redeploy.",
    );
  return {
    projectId,
    serviceAccount: {
      projectId: serviceProject,
      clientEmail,
      privateKey: privateKey.replace(/\\n/g, "\n"),
    },
  };
}
