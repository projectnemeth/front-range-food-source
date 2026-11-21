import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { adminConfiguration } from "../src/lib/firebase-admin-config";
import { pickupResponse } from "../src/lib/pickup/client";
const base = {
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-food-source",
  VERCEL: "1",
};
test("server credentials reject missing, malformed, quoted and cross-project JSON without leaking contents", () => {
  assert.throws(
    () => adminConfiguration(base),
    /entire Firebase service-account JSON/,
  );
  assert.throws(
    () =>
      adminConfiguration({
        ...base,
        FIREBASE_SERVICE_ACCOUNT_KEY: "private-secret-not-JSON",
      }),
    /not valid JSON/,
  );
  assert.throws(
    () =>
      adminConfiguration({
        ...base,
        FIREBASE_SERVICE_ACCOUNT_KEY: JSON.stringify("quoted-key"),
      }),
    /not a filename/,
  );
  assert.throws(
    () =>
      adminConfiguration({
        ...base,
        FIREBASE_SERVICE_ACCOUNT_KEY: JSON.stringify({
          project_id: "wrong",
          client_email: "fake@example.test",
          private_key: "secret",
        }),
      }),
    /does not match/,
  );
});
test("server credentials normalize escaped private-key newlines", () => {
  const result = adminConfiguration({
    ...base,
    FIREBASE_SERVICE_ACCOUNT_KEY: JSON.stringify({
      project_id: base.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      client_email: "fake@example.test",
      private_key: "first\\nsecond",
    }),
  });
  assert.equal(result.serviceAccount?.privateKey, "first\nsecond");
});
test("empty/HTML login responses retain HTTP error information rather than a JSON parsing exception", async () => {
  await assert.rejects(
    pickupResponse(new Response(null, { status: 500 })),
    /empty response \(HTTP 500\)/,
  );
  await assert.rejects(
    pickupResponse(new Response("<html>proxy error</html>", { status: 502 })),
    /unexpected response \(HTTP 502\)/,
  );
  await assert.rejects(
    pickupResponse(
      Response.json({ error: "Check server configuration" }, { status: 503 }),
    ),
    /Check server configuration/,
  );
  assert.deepEqual(await pickupResponse(Response.json({ ok: true })), {
    ok: true,
  });
});
test("malformed Firebase settings no longer crash route imports and produce structured setup errors", () => {
  const script = `
 const {NextRequest}=await import('next/server.js');
 const session=await import('./src/app/api/pickup/session/route.ts');
 const profile=await import('./src/app/api/profile/route.ts');
 const health=await import('./src/app/api/pickup/health/route.ts');
 const unauth=await session.GET(new NextRequest('http://localhost/api/pickup/session'));
 const login=await session.POST(new NextRequest('http://localhost/api/pickup/session',{method:'POST',headers:{origin:'http://localhost','content-type':'application/json',authorization:'Bearer fake'},body:JSON.stringify({action:'login'})}));
 const result=await profile.GET(new Request('http://localhost/api/profile',{headers:{authorization:'Bearer fake'}}));
 const diagnostic=health.GET();
 process.stdout.write(JSON.stringify({unauth:unauth.status,login:login.status,loginBody:await login.json(),profile:result.status,profileBody:await result.json(),health:diagnostic.status,healthBody:await diagnostic.json()}));
 `;
  const child = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...base,
        FIREBASE_SERVICE_ACCOUNT_KEY: "not-JSON-sensitive-marker",
        PICKUP_HOSTED_ENABLED: "true",
      },
      encoding: "utf8",
      timeout: 20000,
    },
  );
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.unauth, 401);
  assert.equal(result.login, 503);
  assert.equal(result.profile, 503);
  assert.equal(result.health, 503);
  assert.match(result.loginBody.error, /not valid JSON/);
  assert.equal(result.healthBody.firebaseConfigured, false);
  assert.ok(!child.stdout.includes("sensitive-marker"));
});
