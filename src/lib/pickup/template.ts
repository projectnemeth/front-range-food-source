import { readFileSync } from "node:fs";
import { join } from "node:path";
import { offlineShell } from "./offline-shell";
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
      "Creates or updates an FRFS Attendance tab in the original",
      "Updates attendance columns on the matching dated tabs in the original",
    )
    .replace(
      "Write attendance history to the FRFS Attendance tab in the original response workbook?",
      "Update the FRFS attendance columns on the matching dated pickup tabs? Original Form answers stay intact.",
    )
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
    `      async function rawPickupApi(method, ...args) {
        const response = await fetch('/api/pickup', {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify({method,args}), cache:'no-store', signal:AbortSignal.timeout(15000)});
        let value;
        try { value = JSON.parse(await response.text()); }
        catch (_) { const error = new Error('The pickup service returned an empty or unexpected response (HTTP ' + response.status + '). Check /api/pickup/health and reload to retry.'); error.status = response.status >= 400 ? response.status : 502; throw error; }
        if (!response.ok) {
          if (String(value.error).includes('DEVICE_ACCESS_REQUIRED')) {deviceToken=null;showDeviceGate('This iPad needs a new coordinator pairing PIN.');}
          const error = new Error(value.error || 'Could not reach the pickup service.'); error.status = response.status; throw error;
        }
        return value;
      }
` +
    offlineShell +
    html.slice(end);
  html = html.replace(
    "<script>",
    "<script>" +
      readFileSync(join(process.cwd(), "public/pickup-outbox.js"), "utf8") +
      "</script><script>",
  );
  html = html.replace(
    'const result = await api("requestAction", request);',
    `const result = await api("requestAction", request);
          if (result.queued) { tokens.delete(key); arrivalDrafts.delete(r.id); $("search").value = ""; current = null; render(); note(result.message, true); return; }`,
  );
  html = html.replace(
    'const result = await api("addWalkIn", request);',
    `const result = await api("addWalkIn", request);
          if (result.queued) { walkInDraft = null; arrivalDrafts.delete(WALKIN); current = null; render(); note(result.message, true); return; }`,
  );
  html = html.replace(
    "async function submitWalkIn() {",
    "async function submitWalkIn(print = true) {",
  );
  html = html.replace(
    "add.onclick = submitWalkIn;",
    "add.onclick = () => submitWalkIn();",
  );
  html = html.replace(
    "token: walkInDraft.token,\n          print: true,",
    "token: walkInDraft.token,\n          print,",
  );
  html = html.replace(
    "actions.append(add, cancel);",
    `const recordOnly = el("button", "Record box given (no label)");
        recordOnly.onclick = () => submitWalkIn(false);
        actions.append(add, recordOnly, cancel);`,
  );
  html = html.replace(
    "if (r.reviewRequired) return;",
    `if (pendingCheckin(r.id)) { box.append(el("p", "Saved on this iPad—waiting to sync. Arrival and labels are not confirmed. See the pending check-ins above.", "notice")); return; }
        if (r.reviewRequired) return;`,
  );
  html = html.replace(
    '(r.errors.length\n                  ? "Needs review"',
    '(pendingCheckin(r.id) ? "Waiting to sync" : r.errors.length\n                  ? "Needs review"',
  );
  html = html.replace(
    "Connection lost. Check-in cannot be saved until you reconnect. Refresh before retrying.",
    "Connection lost. New check-ins will be saved on this iPad and sent after reconnecting. No labels can print until then.",
  );
  html = html.replace(
    "Connection restored. Refresh the list to check saved arrivals before retrying.",
    "Connection restored. Sending saved check-ins; check the pending list for anything needing review.",
  );
  html = html.replace(
    "if (settings.events.length) await refresh();",
    "if (settings.events.length) { await refresh(); reconnectCheckins(); }",
  );
  html = html.replace(
    "Enable scheduled attendance sync",
    "Enable automatic attendance sync",
  );
  html = html.replace(
    '<div class="small muted" id="syncTime"></div>',
    `<p class="small"><a href="/pickup/manage">Coordinator sign-in and access management</a></p><div class="small muted" id="syncTime"></div>`,
  );
  return html;
}
