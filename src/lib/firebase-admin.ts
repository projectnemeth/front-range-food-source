import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import {
  adminConfiguration,
  FirebaseConfigurationError,
} from "./firebase-admin-config";

// Initialize inside request handlers, never at module load. A malformed deployment
// setting must produce a JSON setup error rather than an empty Vercel 500 response.
let services: { auth: Auth; db: Firestore } | undefined;
export function getAdminServices() {
  if (services) return services;
  const configuration = adminConfiguration();
  try {
    const app =
      getApps()[0] ??
      initializeApp({
        projectId: configuration.projectId,
        ...(configuration.serviceAccount
          ? { credential: cert(configuration.serviceAccount) }
          : {}),
      });
    services = { auth: getAuth(app), db: getFirestore(app) };
    return services;
  } catch {
    throw new FirebaseConfigurationError(
      "Firebase server initialization failed. Check the full FIREBASE_SERVICE_ACCOUNT_KEY JSON and its private_key in Vercel, then redeploy. Never paste the key into chat.",
    );
  }
}
function lazyService<T extends object>(get: () => T): T {
  return new Proxy({} as T, {
    get(_target, property) {
      const service = get();
      const value = Reflect.get(service, property, service);
      return typeof value === "function" ? value.bind(service) : value;
    },
  });
}
// Preserve existing imports and Firestore/Auth method binding across the app.
export const adminDb: Firestore = lazyService(() => getAdminServices().db);
export const adminAuth: Auth = lazyService(() => getAdminServices().auth);
