import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUILD } from "./model";
// Reuse the pilot's touch UI without an iframe. Only the transport/enrollment shell changes.
export function hostedHtml(coordinator: boolean) {
  let html = readFileSync(
    join(process.cwd(), "tools/pickup-station/Index.html"),
    "utf8",
  );
  html = html
    .replace('data-coordinator="false"', `data-coordinator="${coordinator}"`)
    .replace(
      "const demo = !(window.google && google.script && google.script.run);",
      "const demo = false;",
    )
    .replace(/const clientBuild = "[^"]+";/, `const clientBuild = "${BUILD}";`)
    .replace(
      "deviceToken = storedDeviceToken();",
      'deviceToken = bootstrap.paired ? "hosted-cookie" : null;',
    )
    .replace("deviceToken = result.token;", 'deviceToken = "hosted-cookie";')
    .replace(
      "const saved = rememberDeviceToken(result.token);",
      "const saved = true;",
    )
    .replace(/maxlength="4"/g, 'maxlength="6"')
    .replace(/4-digit/g, "6-digit")
    .replace(/15 minutes/g, "10 minutes")
    .replace(
      "Five wrong tries cancel it.",
      "Pairing attempts are rate limited.",
    )
    .replace(/New version of both deployments/g, "Reload the hosted app")
    .replace(
      "Enable five-minute attendance sync",
      "Enable scheduled attendance sync",
    );
  const start = html.indexOf("      function api(method, ...args) {");
  const end = html.indexOf("      function fold(text)", start + 35);
  // Exact helper boundaries and the transport tests guard against pilot-template drift.
  if (start < 0 || end < 0)
    throw new Error("Pickup template transport marker missing");
  html =
    html.slice(0, start) +
    `      async function api(method, ...args) {
        const response = await fetch('/api/pickup', {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify({method,args}), cache:'no-store'});
        const value = await response.json();
        if (!response.ok) {
          if (String(value.error).includes('DEVICE_ACCESS_REQUIRED')) {deviceToken=null;showDeviceGate('This iPad needs a new coordinator pairing PIN.');}
          throw new Error(value.error || 'Could not reach the pickup service.');
        }
        return value;
      }
` +
    html.slice(end);
  html = html.replace(
    '<div class="small muted" id="syncTime"></div>',
    `<p class="small"><a href="/pickup/manage">Coordinator sign-in and access management</a></p><div class="small muted" id="syncTime"></div>`,
  );
  return html;
}
