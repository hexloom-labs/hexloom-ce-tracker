import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { build } from "esbuild";

await build({
  entryPoints: ["src/main.ts"], bundle: true, format: "cjs", platform: "node", outfile: ".test-build/plugin.cjs",
  alias: { obsidian: "./test/obsidian-mock.mjs" }, logLevel: "silent",
});
const CEPlugin = createRequire(import.meta.url)("../.test-build/plugin.cjs").default;
const { TFile, Notice, Setting } = globalThis.__obsidianMock;

const REQ = {
  id: "main", name: "My renewal", requiredHours: 40, cycleStart: "2000-01-01", cycleEnd: "2099-12-31",
  categories: [{ name: "Ethics", minHours: 2 }],
};

function makeApp(notes) {
  const store = new Map(notes.map((n) => [n.path, Object.assign(new TFile(n.path), { fm: n.fm })]));
  const folders = new Set();
  const opened = [];
  return {
    opened, leaves: [], folders, store,
    vault: {
      getMarkdownFiles: () => [...store.values()].filter((f) => f.path.endsWith(".md")),
      getAbstractFileByPath: (p) => store.get(p) ?? (folders.has(p) ? { path: p } : null),
      createFolder: async (p) => { folders.add(p); },
      create: async (p, body) => { const f = Object.assign(new TFile(p), { body }); store.set(p, f); return f; },
      process: async (f, fn) => { f.body = fn(f.body); return f.body; },
      read: async (f) => f.body,
      on: (name) => ({ name }),
    },
    metadataCache: { getFileCache: (f) => (f.fm ? { frontmatter: f.fm } : null), on: (name) => ({ name }) },
    workspace: {
      getLeavesOfType: () => [],
      getLeaf: () => ({ openFile: async (f) => { opened.push(f.path); } }),
      openLinkText: async (p) => { opened.push(p); },
      revealLeaf() {},
      onLayoutReady: (fn) => fn(),
    },
  };
}

async function load(notes, data) {
  const app = makeApp(notes);
  const p = new CEPlugin(app);
  p.data = data;
  await p.onload();
  return { app, p };
}
const credit = (path, hours, extra = {}) => ({ path, fm: { "ce-date": "2026-03-01", "ce-hours": hours, ...extra } });
const cmd = (p, id) => p.commands.find((c) => c.id === id);
const openView = (p, app) => {
  const view = p.views["hexloom-ce-dashboard"]({ app });
  view.plugin = p;
  view.render();
  return view;
};

test("onload registers view, ribbon, four commands, settings tab and vault events", async () => {
  const { p } = await load([], null);
  assert.ok(p.views["hexloom-ce-dashboard"]);
  assert.equal(p.ribbons.length, 1);
  assert.deepEqual(p.commands.map((c) => c.id).sort(), ["export-csv", "export-markdown", "log-credit", "open-dashboard"]);
  assert.equal(p.tabs.length, 1);
  assert.deepEqual(p.events.map((e) => e.name).sort(), ["changed", "delete", "rename", "resolved"]);
});

test("no requirement: dashboard shows setup, commands refuse politely", async () => {
  const { p, app } = await load([credit("a.md", 1)], null);
  assert.equal(p.summary(), null);
  assert.match(openView(p, app).contentEl.text(), /Set up your first requirement/);
  Notice.log.length = 0;
  cmd(p, "log-credit").callback();
  await cmd(p, "export-csv").callback();
  assert.equal(Notice.log.length, 2);
  assert.equal(app.store.size, 1);
});

test("dashboard renders progress, categories, credits, problems; buttons work", async () => {
  const { p, app } = await load(
    [
      credit("CE Credits/ethics.md", 2, { "ce-category": "Ethics", "ce-provider": "Acme" }),
      credit("CE Credits/class.md", 1.5),
      credit("old.md", 5, { "ce-date": "1999-01-01" }),
      { path: "bad.md", fm: { "ce-hours": "lots", "ce-date": "2026-03-01" } },
      { path: "plain.md", fm: { title: "not a credit" } },
    ],
    { requirements: [REQ] },
  );
  const view = openView(p, app);
  const t = view.contentEl.text();
  for (const needle of ["My renewal", "3.5 of 40 hours (8%)", "Hours left 36.5", "Status On track", "Ethics", "Met", "Credits this cycle (2)", "Acme", "1 credit note falls outside this cycle", "1 note has a problem", "bad", "ce-hours is not a number above 0"]) {
    assert.ok(t.includes(needle), `${needle}\n---\n${t}`);
  }
  const bar = view.contentEl.all((e) => e.attr.role === "progressbar")[0];
  assert.equal(bar.attr["aria-valuenow"], "3.5");
  assert.equal(bar.children[0].props["--hx-ce-pct"], "8%");
  const buttons = view.contentEl.all((e) => e.tag === "button");
  buttons.find((b) => b.textContent === "ethics").click();
  assert.deepEqual(app.opened, ["CE Credits/ethics.md"]);
  buttons.find((b) => b.textContent === "Export CSV").click();
  await new Promise((r) => setTimeout(r, 20));
  assert.ok([...app.store.keys()].some((k) => k.endsWith(".csv")));
});

test("export writes CSV into the folder, overwrites on repeat, opens Markdown", async () => {
  const { p, app } = await load([credit("a.md", 2, { "ce-category": "Ethics", "ce-provider": "Acme" })], { requirements: [REQ], folder: "Audits" });
  await p.exportAudit("csv");
  const csvPath = [...app.store.keys()].find((k) => k.startsWith("Audits/Audit My renewal ") && k.endsWith(".csv"));
  assert.ok(csvPath, [...app.store.keys()].join());
  assert.equal(app.store.get(csvPath).body, "Date,Hours,Category,Provider,Note\r\n2026-03-01,2,Ethics,Acme,a.md\r\n");
  const n = app.store.size;
  await p.exportAudit("csv");
  assert.equal(app.store.size, n);
  await p.exportAudit("md");
  const mdPath = [...app.store.keys()].find((k) => k.endsWith(".md") && k.startsWith("Audits/"));
  assert.match(app.store.get(mdPath).body, /\| Hours earned \| 2 \|/);
  assert.deepEqual(app.opened, [mdPath]);
  assert.ok(app.folders.has("Audits"));
});

test("nested export folder creates each segment", async () => {
  const { p, app } = await load([], { requirements: [REQ], folder: "Pro/CE" });
  await p.exportAudit("csv");
  assert.ok(app.folders.has("Pro") && app.folders.has("Pro/CE"));
});

test("createCredit writes a note and avoids name collisions", async () => {
  const { p, app } = await load([], { requirements: [REQ] });
  const input = { date: "2026-04-02", hours: 1, category: "Ethics", provider: "Acme", title: "Intro", certificate: "" };
  const a = await p.createCredit(input);
  const b = await p.createCredit(input);
  assert.equal(a.path, "CE Credits/2026-04-02 Intro.md");
  assert.equal(b.path, "CE Credits/2026-04-02 Intro (2).md");
  assert.match(app.store.get(a.path).body, /ce-hours: 1\n/);
});

test("log modal validates, then creates the note and closes", async () => {
  const { p, app } = await load([], { requirements: [REQ] });
  cmd(p, "log-credit").callback();
  const s = Setting.all.slice(-7);
  const byName = (n) => s.find((x) => x.name === n);
  assert.equal(byName("Category").comps[0].options.join(), ",Ethics");
  const logBtn = s.at(-1).comps[0];
  await logBtn.click();
  assert.equal(app.store.size, 0, "no hours: nothing created");
  byName("Hours").comps[0].handler("1,5");
  byName("Course or session").comps[0].handler("Webinar");
  byName("Category").comps[0].handler("Ethics");
  await logBtn.click();
  const created = [...app.store.keys()];
  assert.equal(created.length, 1);
  assert.match(app.store.get(created[0]).body, /ce-hours: 1\.5\nce-category: "Ethics"/);
});

test("settings tab: edits autosave only when valid; example loads", async () => {
  const { p } = await load([], null);
  const tab = p.tabs[0];
  Setting.all.length = 0;
  tab.display();
  const byName = (n) => Setting.all.find((s) => s.name === n);
  byName("Name").comps[0].handler("CPA renewal");
  byName("Hours required").comps[0].handler("120");
  assert.equal(p.saved.length, 0, "invalid draft is never saved");
  assert.match(tab.status.textContent, /Not saved yet: Cycle start/);
  byName("Cycle start").comps[0].handler("2026-01-01");
  byName("Cycle end").comps[0].handler("2028-12-31");
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(tab.status.textContent, "Saved.");
  assert.deepEqual(p.saved.at(-1).requirements[0], { id: "main", name: "CPA renewal", requiredHours: 120, cycleStart: "2026-01-01", cycleEnd: "2028-12-31", categories: [] });
  byName("Hours required").comps[0].handler("");
  assert.match(tab.status.textContent, /Required hours/);
  assert.equal(p.settings.requirements[0].requiredHours, 120, "last valid value is kept");

  Setting.all.length = 0;
  tab.display();
  Setting.all.find((s) => s.name === "Example").comps[0].click();
  await new Promise((r) => setTimeout(r, 10));
  assert.match(p.settings.requirements[0].name, /^Example/);
  assert.equal(p.settings.requirements[0].categories[0].name, "Ethics");
});

// ---- Pro ----
import crypto from "node:crypto";
import fs from "node:fs";
const PEM = new URL("../../../../secrets/obsidian-ce-license-private.pem", import.meta.url);
const proTest = fs.existsSync(PEM) ? test : test.skip;
const mint = (over = {}) => {
  const payload = { v: 1, p: "pro", e: "ann@example.com", x: Math.floor(Date.now() / 1000) + 30 * 86400, s: "cs_test_1", ...over };
  const head = `HXCE1.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  return `${head}.${crypto.sign(null, Buffer.from(head), crypto.createPrivateKey(fs.readFileSync(PEM))).toString("base64url")}`;
};
const REQ2 = { id: "r-2", name: "Nurse licence", requiredHours: 30, cycleStart: "2000-01-01", cycleEnd: "2099-12-31", categories: [{ name: "Pharmacology", minHours: 3 }] };
const cert = { "ce-certificate": "[[cert.pdf]]" };
const wait = () => new Promise((r) => setTimeout(r, 30));

test("free: first requirement only, certificate column absent, no status notes, nothing saved as Pro", async () => {
  const { p, app } = await load([credit("a.md", 2, cert)], { requirements: [REQ, REQ2] });
  assert.equal(p.pro, false);
  assert.deepEqual(p.requirements().map((r) => r.id), ["main"]);
  await p.exportAudit("csv");
  const csv = [...app.store.values()].find((f) => f.path.endsWith(".csv")).body;
  assert.ok(!csv.includes("Certificate") && !csv.includes("cert.pdf"));
  await p.writeStatusNotes();
  assert.ok(![...app.store.keys()].some((k) => k.includes("Status ")));
  const tab = p.tabs[0];
  Setting.all.length = 0;
  tab.display();
  assert.ok(tab.containerEl.text().includes("1 more requirement is saved but paused"), tab.containerEl.text());
  Notice.log.length = 0;
  Setting.all.find((x) => x.comps.some((c) => c.text === "Add requirement (Pro)")).comps.at(-1).click();
  assert.match(Notice.log[0], /Pro feature/);
});

test("bad key is refused and not stored; expired key at load leaves free mode with its reason", async () => {
  const { p } = await load([], { requirements: [REQ] });
  const r = await p.activate("HXCE1.abc.def");
  assert.equal(r.ok, false);
  assert.equal(p.settings.licenseKey, "");
  assert.equal(p.saved.length, 0);
  if (!fs.existsSync(PEM)) return;
  const exp = mint({ x: Math.floor(Date.now() / 1000) - 86400 });
  const q = await load([], { requirements: [REQ, REQ2], licenseKey: exp });
  assert.equal(q.p.pro, false);
  assert.match(q.p.license.reason, /expired/);
  assert.equal(q.p.requirements().length, 1);
});

proTest("pro: key activates and persists, exports list certificates, status note is written once and is not a credit", async () => {
  const { p, app } = await load([credit("a.md", 2, cert)], { requirements: [REQ] });
  const r = await p.activate(mint());
  assert.equal(r.ok, true);
  assert.equal(p.saved.at(-1).licenseKey.startsWith("HXCE1."), true);
  await p.exportAudit("csv");
  const csv = [...app.store.values()].find((f) => f.path.endsWith(".csv")).body;
  assert.match(csv, /Certificate/);
  assert.match(csv, /\[\[cert\.pdf\]\]/);
  await wait();
  const note = app.store.get("CE Credits/Status My renewal.md");
  assert.ok(note, [...app.store.keys()].join());
  for (const k of ["ce-status: ", "ce-deadline: 2099-12-31", "ce-days-left: ", "ce-hours-left: 38", "ce-hours-earned: 2", "ce-categories-open: 1"]) assert.ok(note.body.includes(k), k + "\n" + note.body);
  let writes = 0;
  const orig = app.vault.process;
  app.vault.process = async (...a) => { writes++; return orig(...a); };
  await p.writeStatusNotes();
  assert.equal(writes, 0, "unchanged content is not rewritten");
  assert.ok(!note.fm, "status note has no credit properties");
  assert.ok(p.collect().credits.every((c) => c.path === "a.md"));
  const reload = await load([], { requirements: [REQ], licenseKey: p.settings.licenseKey });
  assert.equal(reload.p.pro, true, "key survives a restart");
  assert.match(Notice.log.at(-1) ?? "", /./);
});

proTest("pro: several requirements, dashboard picker, assigned credits, log modal assigns the requirement", async () => {
  const { p, app } = await load(
    [credit("a.md", 2), credit("n.md", 4, { "ce-requirement": "Nurse licence", "ce-category": "Pharmacology" })],
    { requirements: [REQ, REQ2], licenseKey: mint() },
  );
  assert.equal(p.pro, true);
  const view = openView(p, app);
  const sel = view.contentEl.all((e) => e.tag === "select")[0];
  assert.ok(sel, "picker shows with two requirements");
  assert.equal(sel.children.length, 2);
  sel.value = "r-2";
  sel.listeners.change[0]();
  await wait();
  assert.equal(p.settings.activeId, "r-2");
  const s = p.summary();
  assert.equal(s.requirement.name, "Nurse licence");
  assert.equal(s.totalHours, 6, "unassigned credit counts for every requirement, assigned one for its own");

  Setting.all.length = 0;
  cmd(p, "log-credit").callback();
  const last = (n) => Setting.all.filter((x) => x.name === n).at(-1);
  assert.equal(last("Category").comps[0].options.join(), ",Pharmacology");
  last("Requirement").comps[0].handler("main");
  assert.equal(last("Category").comps[0].options.join(), ",Ethics", "categories follow the chosen requirement");
  last("Hours").comps[0].handler("1");
  last("Course or session").comps[0].handler("Webinar");
  await Setting.all.at(-1).comps[0].click();
  const made = [...app.store.values()].find((f) => f.path.endsWith("Webinar.md"));
  assert.match(made.body, /ce-requirement: "My renewal"/);
});
