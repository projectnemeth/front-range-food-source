// Firebase Admin 14 -> jwks-rsa 4.1.0 requires ESM-only jose at module load.
// Vercel's loader disables require(esm). Retain jose 6 and import it lazily in
// the async signing-key path and callback-based Passport integration.
// Remove this patch when upstream ships a compatible implementation.
import fs from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const fromAdmin = createRequire(require.resolve("firebase-admin/auth"));
const version = JSON.parse(
  fs.readFileSync(fromAdmin.resolve("jwks-rsa/package.json"), "utf8"),
).version;
if (version !== "4.1.0")
  throw new Error(
    "Review Firebase ESM compatibility for the changed jwks-rsa version before deploying.",
  );
const hash = (value) => createHash("sha256").update(value).digest("hex");
const headers = [
  "const jose = require('jose');\n",
  "// FRFS compatibility: jose is loaded with import() below.\n",
];
function patch(path, expected, replacements) {
  const file = fromAdmin.resolve(path),
    source = fs.readFileSync(file, "utf8");
  let original = source;
  for (const [before, after] of [...replacements].reverse())
    original = original.replace(after, before);
  if (hash(original) !== expected)
    throw new Error(
      "Unexpected jwks-rsa source; refusing an unreviewed dependency patch: " +
        path,
    );
  let patched = original;
  for (const [before, after] of replacements) {
    if (!patched.includes(before))
      throw new Error("Firebase compatibility patch marker missing: " + path);
    patched = patched.replace(before, after);
  }
  if (source !== patched) fs.writeFileSync(file, patched);
}
patch(
  "jwks-rsa/src/utils.js",
  "c535773fd798202296e846e7c057f96f631148686194ff2990f0729fa4c1b7af",
  [
    headers,
    [
      "async function retrieveSigningKeys(jwks) {\n",
      "async function retrieveSigningKeys(jwks) {\n  const jose = await import('jose');\n",
    ],
  ],
);
patch(
  "jwks-rsa/src/integrations/passport.js",
  "03557fac70296dda6d19872b1702d2b8f1d4c50d22d3fbcf1fb65f9afa7ddcbb",
  [
    headers,
    [
      "return function secretProvider(",
      "return async function secretProvider(",
    ],
    [
      "    try {\n      decoded =",
      "    try {\n      const jose = await import('jose');\n      decoded =",
    ],
  ],
);
console.log(
  "Verified Firebase/JWKS ESM compatibility (jose version unchanged).",
);
