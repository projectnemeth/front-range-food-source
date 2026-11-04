import {
  cert,
  getApps,
  initializeApp,
  type ServiceAccount,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
const app =
  getApps()[0] ??
  (() => {
    const key = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (key) {
      let credentials: ServiceAccount;
      try {
        credentials = JSON.parse(key);
      } catch {
        throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY must be valid JSON");
      }
      return initializeApp({
        credential: cert(credentials),
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      });
    }
    return initializeApp({
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    });
  })();
export const adminDb = getFirestore(app);
export const adminAuth = getAuth(app);
