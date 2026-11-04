// Nonsecret configuration for tests/build only. Never connects to production Firebase.
import { spawnSync } from "node:child_process";
const env = {
  ...process.env,
  NEXT_PUBLIC_FIREBASE_API_KEY: "fake-api-key",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "demo-food-source.firebaseapp.com",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-food-source",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:123:web:test",
  NEXT_PUBLIC_USE_EMULATORS: "true",
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
};
delete env.FIREBASE_SERVICE_ACCOUNT_KEY;
delete env.GOOGLE_APPLICATION_CREDENTIALS;
const result = spawnSync(process.argv[2], process.argv.slice(3), {
  env,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
