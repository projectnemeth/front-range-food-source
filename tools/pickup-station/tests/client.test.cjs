// In-memory DOM contract tests. These do not replace browser/layout verification.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
async function client() {
  const roots = [];
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.style = {};
      this.attrs = {};
      this._text = "";
      this._value = "";
      this.disabled = false;
      this.hidden = false;
    }
    set textContent(v) {
      this._text = String(v);
      this.children = [];
    }
    get textContent() {
      return this._text + this.children.map((x) => x.textContent).join("");
    }
    set value(v) {
      this._value = String(v);
    }
    get value() {
      if (this.tagName === "SELECT" && !this._value)
        return (
          (this.children.find((c) => c.selected) || this.children[0])?.value ||
          ""
        );
      return this._value;
    }
    append(...children) {
      this.children.push(...children);
    }
    replaceChildren(...children) {
      this.children = children;
      this._text = "";
    }
    setAttribute(k, v) {
      this.attrs[k] = v;
    }
    scrollIntoView() {}
  }
  const html = fs.readFileSync(path.join(__dirname, "../Index.html"), "utf8");
  for (const match of html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const node = new Element(match[1]);
    node.id = match[2];
    roots.push(node);
  }
  function all() {
    const nodes = [];
    function walk(n) {
      nodes.push(n);
      n.children.forEach(walk);
    }
    roots.forEach(walk);
    return nodes;
  }
  const document = {
    hidden: false,
    activeElement: null,
    getElementById: (id) => all().find((n) => n.id === id) || null,
    createElement: (t) => new Element(t),
    querySelectorAll: () =>
      all().filter(
        (n) =>
          ["BUTTON", "SELECT"].includes(n.tagName) ||
          (n.tagName === "INPUT" && n.type === "checkbox"),
      ),
  };
  for (const [id, value] of Object.entries({
    filter: "all",
    demoOutcome: "Submitted",
    batchCopies: "3",
  }))
    document.getElementById(id).value = value;
  const context = vm.createContext({
    document,
    window: { addEventListener() {} },
    navigator: { onLine: true },
    crypto: { randomUUID: () => require("node:crypto").randomUUID() },
    confirm: () => true,
    Date,
    JSON,
    Math,
    String,
    Number,
    Array,
    Object,
    Set,
    Map,
    Promise,
    Error,
    setTimeout: (fn) => setTimeout(fn, 0),
    setInterval() {},
  });
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  await vm.runInContext("stationReady", context);
  return {
    c: context,
    document,
    get: (id) => document.getElementById(id),
    run: (code) => vm.runInContext(code, context),
  };
}
test("fictional demo initializes and search matches accents and phone digits", async () => {
  const f = await client();
  assert.equal(f.get("total").textContent, "6");
  assert.equal(f.get("demo").hidden, false);
  f.get("search").value = "rodriguez";
  f.get("search").oninput();
  assert.match(f.get("list").textContent, /Elena Rodríguez/);
  assert.equal(f.run("visible().length"), 1);
  f.get("search").value = "0185";
  assert.equal(f.run("visible()[0].phone"), "(720) 555-0185");
});
test("arrival appears in packing view; advance printing does not create arrival", async () => {
  const f = await client();
  await f.run("api('requestAction',{id:'demo-0',action:'advance',copies:3})");
  await f.run("refresh()");
  f.run("switchView('packing')");
  assert.match(f.get("queue").textContent, /No matching arrivals/);
  await f.run("api('requestAction',{id:'demo-0',action:'checkin',copies:3,arrival:{number:'101',line:'blue',vehicle:''}})");
  await f.run("refresh()");
  assert.match(f.get("queue").textContent, /Maria Garcia/);
  assert.match(f.get("packingCount").textContent, /1 arrived/);
  assert.equal(f.get("checkinPanel").hidden, true);
});
test("unknown output gets attention and confirmation clears the print problem", async () => {
  const f = await client();
  f.get("demoOutcome").value = "Outcome unknown";
  await f.run("api('requestAction',{id:'demo-2',action:'checkin',copies:1,arrival:{number:'101',line:'blue',vehicle:''}})");
  await f.run("refresh()");
  f.run("switchView('packing')");
  assert.match(f.get("packingCount").textContent, /1 need attention/);
  assert.match(f.get("queue").textContent, /may have printed/);
  await f.run("api('confirmPrinted',demoRecords[2].lastJob.id)");
  await f.run("refresh()");
  assert.match(f.get("packingCount").textContent, /0 need attention/);
});
test("check-in-only arrival does not mistake advance labels for a packing notification", async () => {
  const f = await client();
  await f.run("api('requestAction',{id:'demo-1',action:'advance',copies:2})");
  await f.run(
    "api('requestAction',{id:'demo-1',action:'checkinOnly',copies:2,arrival:{number:'101',line:'blue',vehicle:''}})",
  );
  await f.run("refresh()");
  f.run("switchView('packing')");
  assert.match(f.get("queue").textContent, /No arrival label/);
  assert.match(f.get("packingCount").textContent, /1 need attention/);
});
test("refresh preserves copy selection, reprint reason, and expanded details", async () => {
  const f = await client();
  f.run("current='demo-0';render()");
  f.get("copies").value = "1";
  f.get("reason").value = "Paper jam checked";
  f.get("otherActions").open = true;
  await f.run("refresh()");
  assert.equal(f.get("copies").value, "1");
  assert.equal(f.get("reason").value, "Paper jam checked");
  assert.equal(f.get("otherActions").open, true);
});
test("successful mutation followed by refresh failure does not invite repeating a saved action", async () => {
  const f = await client();
  f.run(
    "carLine='blue';arrivalDrafts.set('demo-0',{number:'111',vehicle:'',line:null});current='demo-0';render();refresh=async()=>{throw new Error('network dropped')}",
  );
  await f.run("action('checkin',records[0])");
  assert.match(f.get("feedback").textContent, /action was saved/);
  assert.equal(f.run("tokens.size"), 0);
  assert.equal(f.run("demoRecords[0].jobs.length"), 1);
});
test("expected/arrived filters and packing view are independent", async () => {
  const f = await client();
  await f.run("api('requestAction',{id:'demo-0',action:'checkin',copies:3,arrival:{number:'101',line:'blue',vehicle:''}})");
  await f.run("refresh()");
  f.get("filter").value = "expected";
  assert.equal(f.run("visible().length"), 5);
  f.run("switchView('packing')");
  assert.match(f.get("packingCount").textContent, /1 arrived/);
});
test("coordinator resolves a fictional repeated ID before check-in, without printing", async () => {
  const f = await client();
  f.run("current='demo-5';render()");
  assert.match(f.get("detail").textContent, /Review repeated ID/);
  assert.equal(f.get("copies"), null);
  await assert.rejects(
    f.run("api('requestAction',{id:'demo-5',action:'checkin',copies:1,arrival:{number:'101',line:'blue',vehicle:''}})"),
    /review required/,
  );
  f.get("duplicateChoice").value = "demo-candidate-2";
  f.get("duplicateReason").value = "Confirmed revised household size";
  await f.run("resolveGroup(records[5])");
  assert.equal(f.run("demoRecords[5].householdSize"), 3);
  assert.equal(f.run("demoRecords[5].jobs.length"), 0);
  assert.ok(f.get("copies"));
  assert.match(f.get("feedback").textContent, /Nothing was printed/);
});
test("advance batch preflight blocks unresolved duplicates before sending any labels", async () => {
  const f = await client();
  f.run("records.forEach(r=>selected.add(r.id))");
  await f.get("batch").onclick();
  assert.match(f.get("feedback").textContent, /Nothing was sent/);
  assert.equal(f.run("demoRecords.reduce((n,r)=>n+r.jobs.length,0)"), 0);
});
test("coordinator setup loads a tab and updates demo event label without importing or printing", async () => {
  const f = await client();
  await f.run("loadSetup()");
  assert.match(f.get("setupResult").textContent, /Setup checklist/);
  assert.equal(f.get("setupTab").value, "101");
  f.get("setupEventLabel").value = "Saturday rehearsal";
  await f.run("saveSetupEvent()");
  assert.equal(f.run("settings.events[0].label"), "Saturday rehearsal");
  assert.equal(f.run("demoRecords.reduce((n,r)=>n+r.jobs.length,0)"), 0);
  assert.match(
    f.get("feedback").textContent,
    /Nothing was imported or printed/,
  );
});
test("service diagnostics show spooling without confirming physical labels", async () => {
  const f = await client();
  await f.run("api('requestAction',{id:'demo-0',action:'checkin',copies:1,arrival:{number:'101',line:'blue',vehicle:''}})");
  await f.run("refresh()");
  await f.run("checkJobStatus(demoRecords[0].lastJob.id)");
  f.run("switchView('packing')");
  assert.match(f.get("queue").textContent, /Sent to the printer at the packing station/);
  assert.doesNotMatch(f.get("queue").textContent, /I saw these labels print/);
  assert.equal(f.run("demoRecords[0].lastJob.status"), "Submitted");
  assert.equal(f.run("demoRecords[0].jobs.length"), 1);
});
test("service error needs attention until a reprint is sent", async () => {
  const f = await client();
  await f.run("api('requestAction',{id:'demo-0',action:'checkin',copies:1,arrival:{number:'101',line:'blue',vehicle:''}})");
  await f.run("refresh()");
  f.get("demoOutcome").value = "Failed";
  await f.run("checkJobStatus(demoRecords[0].lastJob.id)");
  f.run("switchView('packing')");
  assert.match(f.get("packingCount").textContent, /1 need attention/);
  f.get("demoOutcome").value = "Submitted";
  await f.run("api('requestAction',{id:'demo-0',action:'reprint',copies:1,reason:'Printer jammed'})");
  await f.run("refresh()");
  assert.match(f.get("packingCount").textContent, /0 need attention/);
  assert.equal(f.run("demoRecords[0].jobs.length"), 2);
});
test("device gate clears household data and hides staff operations", async () => {
  const f = await client();
  f.run("showDeviceGate('Setup required')");
  assert.equal(f.get("staffApp").hidden, true);
  assert.equal(f.get("deviceGate").hidden, false);
  assert.equal(f.run("records.length"), 0);
  assert.equal(f.get("list").textContent, "");
  assert.equal(f.get("queue").textContent, "");
});
test("enrollment opens staff view without coordinator tools", async () => {
  const f = await client();
  f.run("authMode='devices'; showDeviceGate('Setup required')");
  f.get("deviceCode").value = "1234";
  await f.run("enrollThisDevice()");
  assert.equal(f.get("deviceGate").hidden, true);
  assert.equal(f.get("staffApp").hidden, false);
  assert.equal(f.get("adminTools").hidden, true);
  assert.equal(f.get("deviceCode").value, "");
  assert.equal(f.get("station").textContent, "Demo car-line iPad");
});
test("invalid enrollment keeps household operations hidden", async () => {
  const f = await client();
  f.run("authMode='devices'; showDeviceGate('Setup required')");
  f.get("deviceCode").value = "wrong";
  await f.run("enrollThisDevice()");
  assert.equal(f.get("staffApp").hidden, true);
  assert.equal(f.get("deviceGate").hidden, false);
  assert.equal(f.run("records.length"), 0);
  assert.ok(f.get("deviceMessage").textContent.length > 0);
});

const settle = async () => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 5));
};
test("normal print is followed up automatically with no alert and no extra job", async () => {
  const f = await client();
  f.run("carLine='blue';arrivalDrafts.set('demo-3',{number:'123',vehicle:'',line:null});current='demo-3';render()");
  await f.run("action('checkin',records.find(r=>r.id==='demo-3'))");
  await settle();
  assert.equal(f.run("demoRecords[3].lastJob.providerState"), "done");
  assert.equal(f.run("printAlerts.size"), 0);
  assert.equal(f.get("printAlerts").children.length, 0);
  assert.equal(f.run("demoRecords[3].jobs.length"), 1);
});
test("offline print computer raises a persistent iPad alert without resending", async () => {
  const f = await client();
  f.get("demoOutcome").value = "offline";
  f.run("carLine='blue';arrivalDrafts.set('demo-3',{number:'123',vehicle:'',line:null});current='demo-3';render()");
  await f.run("action('checkin',records.find(r=>r.id==='demo-3'))");
  assert.equal(f.run("demoRecords[3].lastJob.status"), "Submitted");
  await settle();
  assert.equal(f.run("printAlerts.size"), 1);
  assert.equal(f.get("printAlerts").hidden, false);
  assert.match(f.get("printAlerts").textContent, /Label problem: David Martinez/);
  assert.match(f.get("printAlerts").textContent, /has not picked up/);
  assert.equal(f.run("demoRecords[3].jobs.length"), 1);
  assert.equal(f.run("demoRecords[3].lastJob.status"), "Submitted");
});
test("stalled print appears under needs attention once it has waited too long", async () => {
  const f = await client();
  await f.run("api('requestAction',{id:'demo-0',action:'checkin',copies:1,arrival:{number:'101',line:'blue',vehicle:''}})");
  f.run("demoRecords[0].lastJob.providerState='new';demoRecords[0].lastJob.createdAt=new Date(Date.now()-60000).toISOString();demoRecords[0].lastJob.providerCheckedAt=new Date().toISOString()");
  await f.run("refresh()");
  f.run("switchView('packing')");
  assert.match(f.get("packingCount").textContent, /1 need attention/);
});
test("print service error raises an alert that can be dismissed and reviewed", async () => {
  const f = await client();
  f.run("carLine='blue';arrivalDrafts.set('demo-1',{number:'123',vehicle:'',line:null});current='demo-1';render()");
  await f.run("action('checkin',records.find(r=>r.id==='demo-1'))");
  f.get("demoOutcome").value = "Failed";
  await settle();
  assert.equal(f.run("printAlerts.size"), 1);
  assert.match(f.get("printAlerts").textContent, /James Thompson/);
  assert.match(f.get("printAlerts").textContent, /reported a problem/);
  const card = f.get("printAlerts").children[0];
  const [review, dismiss] = card.children.filter((c) => c.tagName === "BUTTON");
  review.onclick();
  assert.equal(f.run("current"), "demo-1");
  dismiss.onclick();
  assert.equal(f.run("printAlerts.size"), 0);
  assert.equal(f.get("printAlerts").hidden, true);
});
test("rejected or uncertain sends alert immediately and are not watched again", async () => {
  const f = await client();
  f.get("demoOutcome").value = "Outcome unknown";
  f.run("carLine='blue';arrivalDrafts.set('demo-2',{number:'123',vehicle:'',line:null});current='demo-2';render()");
  await f.run("action('checkin',records.find(r=>r.id==='demo-2'))");
  assert.equal(f.run("printAlerts.size"), 1);
  assert.match(f.get("printAlerts").textContent, /Amina Hassan/);
  await settle();
  assert.equal(f.run("printAlerts.size"), 1);
  assert.equal(f.run("demoRecords[2].jobs.length"), 1);
});

test("check-in is blocked until this iPad has a line and a 3-digit number", async () => {
  const f = await client();
  f.run("carLine=null;current='demo-4';render()");
  await f.run("action('checkin',records.find(r=>r.id==='demo-4'))");
  assert.match(f.get("feedback").textContent, /Choose this iPad/);
  f.run("setLine('orange')");
  await f.run("action('checkin',records.find(r=>r.id==='demo-4'))");
  assert.match(f.get("feedback").textContent, /3-digit number/);
  assert.equal(f.run("demoRecords[4].jobs.length"), 0);
});
test("on-screen keypad caps at three digits and check-in saves number, line and vehicle", async () => {
  const f = await client();
  f.run("setLine('orange');current='demo-4';render()");
  const keys = () => f.get("detail").children.find((c) => c.className === "arrivalEditor")
    .children.find((c) => c.className === "keypad").children;
  for (const k of ["4", "0", "7", "9"]) keys().find((b) => b.textContent === k).onclick();
  assert.equal(f.run("draftFor(records.find(r=>r.id==='demo-4')).number"), "407");
  f.run("setVehiclePart(draftFor(records.find(r=>r.id==='demo-4')),'color','Grey');setVehiclePart(draftFor(records.find(r=>r.id==='demo-4')),'type','SUV')");
  assert.equal(f.run("draftFor(records.find(r=>r.id==='demo-4')).vehicle"), "Grey SUV");
  f.get("search").value = "Elena";
  await f.run("action('checkin',records.find(r=>r.id==='demo-4'))");
  assert.equal(f.run("JSON.stringify(demoRecords[4].arrival)"), JSON.stringify({ number: "407", line: "orange", vehicle: "Grey SUV" }));
  assert.equal(f.get("search").value, "");
  f.run("switchView('packing')");
  assert.match(f.get("queue").textContent, /#407 · Orange line · Grey SUV/);
  assert.equal(f.get("lineToggle").hidden, true);
});
test("line choice persists per iPad and a reused check-in reports the saved details", async () => {
  const f = await client();
  f.run("setLine('blue');arrivalDrafts.set('demo-0',{number:'222',vehicle:'Tan van',line:null});current='demo-0';render()");
  await f.run("action('checkin',records.find(r=>r.id==='demo-0'))");
  assert.equal(f.run("demoRecords[0].arrival.line"), "blue");
  const again = await f.run("api('requestAction',{id:'demo-0',action:'checkin',copies:1,arrival:{number:'333',line:'orange',vehicle:''}})");
  assert.equal(again.reused, true);
  assert.equal(again.arrival.number, "222");
});
test("background refresh does not grey out buttons and stale reads are discarded", async () => {
  const f = await client();
  f.run("busy=false");
  const before = f.run("readSeq");
  const slow = f.run("quietRefresh()");
  assert.equal(f.run("busy"), false);
  await f.run("refresh()");
  await slow;
  assert.ok(f.run("readSeq") >= before + 2);
});
test("correcting car details for a reprint sends the corrected arrival", async () => {
  const f = await client();
  f.run("setLine('blue');arrivalDrafts.set('demo-1',{number:'500',vehicle:'',line:null});current='demo-1';render()");
  await f.run("action('checkin',records.find(r=>r.id==='demo-1'))");
  f.run("current='demo-1';render()");
  f.run("const d=draftFor(records.find(r=>r.id==='demo-1'));d.number='505';d.line='orange'");
  f.get("reason").value = "Wrong number typed";
  await f.run("action('reprint',records.find(r=>r.id==='demo-1'))");
  assert.equal(f.run("demoRecords[1].arrival.number"), "505");
  assert.equal(f.run("demoRecords[1].arrival.line"), "orange");
});

test("version line shows when screen and server match, and warns when they differ", async () => {
  const f = await client();
  await new Promise((r) => setTimeout(r, 20));
  assert.match(f.get("buildInfo").textContent, /screen and server match/);
  f.run("renderBuild(null)");
  assert.match(f.get("buildInfo").textContent, /Version mismatch/);
  assert.match(f.get("buildInfo").textContent, /New version of both deployments/);
});

test("walk-up form adds a Pre-Packed Pickup with line, number and household size", async () => {
  const f = await client();
  f.run("setLine('blue')");
  f.get("search").value = "Zed Newcomer";
  f.get("search").oninput();
  assert.match(f.get("list").textContent, /Add “Zed Newcomer” as a Pre-Packed Pickup/);
  f.run("startWalkIn(document.getElementById('search').value)");
  assert.equal(f.run("walkInDraft.name"), "Zed Newcomer");
  f.run("walkInDraft.size=5;draftFor({id:WALKIN}).number='777';renderDetail()");
  assert.match(f.get("detail").textContent, /PRE-PACKED PICKUP/);
  await f.run("submitWalkIn()");
  const added = f.run("JSON.stringify(demoRecords.find(r=>r.walkIn))");
  const r = JSON.parse(added);
  assert.equal(r.name, "Zed Newcomer");
  assert.equal(r.householdSize, 5);
  assert.equal(r.arrival.number, "777");
  assert.equal(r.arrival.line, "blue");
  assert.equal(r.jobs.length, 1);
  f.run("switchView('packing')");
  assert.match(f.get("queue").textContent, /#777 · Blue line · PRE-PACKED/);
});
test("walk-up needs a name and number; phone-like search fills phone", async () => {
  const f = await client();
  f.run("setLine('orange');startWalkIn('(303) 555-0199')");
  assert.equal(f.run("walkInDraft.phone"), "(303) 555-0199");
  await f.run("submitWalkIn()");
  assert.match(f.get("feedback").textContent, /name/);
  f.run("walkInDraft.name='Pat Lee'");
  await f.run("submitWalkIn()");
  assert.match(f.get("feedback").textContent, /3-digit/);
  assert.equal(f.run("demoRecords.filter(r=>r.walkIn).length"), 0);
});
