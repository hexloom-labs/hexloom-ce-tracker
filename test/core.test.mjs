import test from "node:test";
import assert from "node:assert/strict";
import {
  dayNumber, parseCredit, summarize, toCsv, toMarkdown, buildCreditNote,
  validateRequirement, validateCreditInput, todayIso,
} from "../src/core.ts";

const req = (over = {}) => ({
  id: "r1", name: "Test cycle", requiredHours: 40,
  cycleStart: "2026-01-01", cycleEnd: "2027-12-31",
  categories: [{ name: "Ethics", minHours: 2 }, { name: "Self-study", maxHours: 10 }],
  ...over,
});
const credit = (over = {}) => ({
  path: "a.md", date: "2026-03-01", hours: 1, category: "", provider: "", certificates: [], requirement: "", ...over,
});
const sum = (credits, over = {}, today = "2026-06-01") => summarize(req(over), credits, [], today);

test("dayNumber validates real calendar dates", () => {
  assert.equal(dayNumber("2026-02-31"), null);
  assert.equal(dayNumber("2026-13-01"), null);
  assert.equal(dayNumber("26-01-01"), null);
  assert.equal(dayNumber(20260101), null);
  assert.equal(dayNumber("2026-03-01T10:00") - dayNumber("2026-02-28"), 1);
  assert.equal(dayNumber("2028-02-29") !== null, true);
  assert.equal(dayNumber("2027-02-29"), null);
});

test("todayIso uses local date parts", () => {
  assert.equal(todayIso(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
});

test("parseCredit: non-credit notes are ignored, bad ones rejected with a reason", () => {
  assert.equal(parseCredit("n.md", undefined), null);
  assert.equal(parseCredit("n.md", { title: "x" }), null);
  for (const hours of [null, "", "abc", 0, -2, "0", NaN]) {
    const r = parseCredit("n.md", { "ce-hours": hours, "ce-date": "2026-03-01" });
    assert.match(r.rejected.reason, /ce-hours/, String(hours));
  }
  assert.match(parseCredit("n.md", { "ce-hours": 1 }).rejected.reason, /ce-date/);
  assert.match(parseCredit("n.md", { "ce-hours": 1, "ce-date": "2026-02-30" }).rejected.reason, /ce-date/);
});

test("parseCredit: accepts comma decimals, datetime, link arrays", () => {
  const r = parseCredit("n.md", {
    "ce-hours": " 1,5 ", "ce-date": "2026-03-01T09:30", "ce-category": " Ethics ",
    "ce-certificate": [["cert.pdf"], "https://x.test/c.pdf", ""],
  });
  assert.equal(r.credit.hours, 1.5);
  assert.equal(r.credit.date, "2026-03-01");
  assert.equal(r.credit.category, "Ethics");
  assert.deepEqual(r.credit.certificates, ["[[cert.pdf]]", "https://x.test/c.pdf"]);
});

test("summary: totals, remaining, percent and floating point sums", () => {
  const s = sum([0.1, 0.2, 0.3].map((h, i) => credit({ path: `${i}.md`, hours: h })));
  assert.equal(s.totalHours, 0.6);
  assert.equal(s.remainingHours, 39.4);
  assert.equal(s.percent, 1);
});

test("summary: percent only reaches 100 when the hours are met", () => {
  const s = sum([credit({ hours: 39.99 })], { categories: [] });
  assert.equal(s.percent, 99);
  assert.equal(s.status, "on-track");
  const done = sum([credit({ hours: 40 })], { categories: [] });
  assert.equal(done.percent, 100);
  assert.equal(done.status, "complete");
  assert.equal(sum([credit({ hours: 55 })], { categories: [] }).percent, 100);
});

test("category minimum blocks completion even when total hours are met", () => {
  const s = sum([credit({ hours: 45, category: "Other" })]);
  assert.equal(s.remainingHours, 0);
  assert.notEqual(s.status, "complete");
  const ethics = s.categories.find((c) => c.name === "Ethics");
  assert.equal(ethics.remainingToMin, 2);
  assert.equal(ethics.met, false);
  const ok = sum([credit({ hours: 43, category: "Other" }), credit({ path: "b.md", hours: 2, category: "ethics" })]);
  assert.equal(ok.status, "complete");
});

test("category maximum caps what counts toward the total", () => {
  const s = sum([credit({ hours: 14, category: "self-study" }), credit({ path: "b.md", hours: 5, category: "Live" })]);
  const ss = s.categories.find((c) => c.name === "Self-study");
  assert.equal(ss.earned, 14);
  assert.equal(ss.counted, 10);
  assert.equal(s.totalHours, 15);
});

test("uncategorised credits count under General; unknown categories count uncapped", () => {
  const s = sum([credit({ hours: 3 }), credit({ path: "b.md", hours: 4, category: "Tax" })]);
  assert.equal(s.totalHours, 7);
  assert.deepEqual(s.categories.map((c) => c.name).sort(), ["Ethics", "General", "Self-study", "Tax"]);
});

test("cycle boundaries are inclusive; outside credits are counted separately", () => {
  const s = sum([
    credit({ path: "a.md", date: "2026-01-01" }),
    credit({ path: "b.md", date: "2027-12-31" }),
    credit({ path: "c.md", date: "2025-12-31" }),
    credit({ path: "d.md", date: "2028-01-01" }),
  ]);
  assert.equal(s.totalHours, 2);
  assert.equal(s.outsideCycle, 2);
});

test("ce-requirement routes credits to the named requirement only", () => {
  const s = sum([
    credit({ path: "a.md", requirement: "test cycle" }),
    credit({ path: "b.md", requirement: "r1" }),
    credit({ path: "c.md", requirement: "Someone else" }),
    credit({ path: "d.md" }),
  ]);
  assert.equal(s.totalHours, 3);
  assert.equal(s.otherRequirement, 1);
});

test("days left and status", () => {
  const r = { cycleEnd: "2026-06-30" };
  assert.equal(sum([], r, "2026-06-30").daysLeft, 0);
  assert.equal(sum([], r, "2026-06-30").status, "due-soon");
  assert.equal(sum([], r, "2026-07-01").daysLeft, -1);
  assert.equal(sum([], r, "2026-07-01").status, "overdue");
  assert.equal(sum([], r, "2026-04-01").status, "due-soon");
  assert.equal(sum([], r, "2026-03-31").status, "on-track");
  assert.equal(sum([], { cycleStart: "2026-09-01", cycleEnd: "2028-08-31" }, "2026-06-01").status, "not-started");
  assert.equal(sum([credit({ hours: 40, category: "Ethics" })], { categories: [] }, "2030-01-01").status, "complete");
});

test("validateRequirement catches bad setup", () => {
  assert.equal(validateRequirement(req()), null);
  assert.match(validateRequirement(req({ name: " " })), /name/);
  assert.match(validateRequirement(req({ requiredHours: 0 })), /Required hours/);
  assert.match(validateRequirement(req({ requiredHours: NaN })), /Required hours/);
  assert.match(validateRequirement(req({ cycleStart: "2026-13-01" })), /start/);
  assert.match(validateRequirement(req({ cycleEnd: "2025-01-01" })), /before/);
  assert.match(validateRequirement(req({ categories: [{ name: "A" }, { name: " a " }] })), /twice/);
  assert.match(validateRequirement(req({ categories: [{ name: "A", minHours: 5, maxHours: 2 }] })), /below/);
});

test("CSV: quoting, formula guard, optional certificate column", () => {
  const s = sum([
    credit({ path: "n.md", hours: 1.5, category: "Ethics", provider: '=HYPERLINK("x")', certificates: ["[[c.pdf]]", "u"] }),
    credit({ path: "m.md", date: "2026-02-01", provider: "A, B\nC" }),
  ]);
  const plain = toCsv(s, { certificates: false }).split("\r\n");
  assert.equal(plain[0], "Date,Hours,Category,Provider,Note");
  assert.equal(plain[1], '2026-02-01,1,,"A, B\nC",m.md');
  assert.ok(plain.join("\r\n").includes(`"'=HYPERLINK(""x"")"`));
  const pro = toCsv(s, { certificates: true });
  assert.ok(pro.includes("Certificate"));
  assert.ok(pro.includes("[[c.pdf]]; u"));
  assert.ok(!plain.join("").includes("c.pdf"));
});

test("Markdown export has summary, categories, credits, notes ignored, disclaimer", () => {
  const s = summarize(req(), [credit({ hours: 2, category: "Ethics", provider: "A|B" })], [{ path: "bad.md", reason: "ce-hours is not a number above 0" }], "2026-06-01");
  const md = toMarkdown(s, { certificates: false });
  for (const needle of ["# CE audit: Test cycle", "| Hours earned | 2 |", "| Hours remaining | 38 |", "| Ethics | 2 | 2 |", "A\\|B", "[[a]]", "## Notes ignored", "[[bad]]", "self-reported"]) {
    assert.ok(md.includes(needle), needle);
  }
  assert.ok(!md.includes("Certificate"));
  assert.ok(toMarkdown(summarize(req(), [], [], "2026-06-01"), { certificates: false }).includes("No credits in this cycle."));
});

test("buildCreditNote round-trips through parseCredit and sanitises the file name", () => {
  const i = { date: "2026-03-05", hours: 1.25, category: 'Ethics "core"', provider: "Acme: Training", title: "Intro / Advanced #1 [x]", certificate: "[[cert.pdf]]" };
  assert.equal(validateCreditInput(i), null);
  const { fileName, content } = buildCreditNote(i);
  assert.equal(fileName, "2026-03-05 Intro Advanced 1 x.md");
  const fm = Object.fromEntries(content.split("---")[1].trim().split("\n").map((l) => {
    const k = l.slice(0, l.indexOf(":"));
    const v = l.slice(l.indexOf(":") + 1).trim();
    return [k, v.startsWith('"') ? JSON.parse(v) : /^[\d.]+$/.test(v) && k === "ce-hours" ? Number(v) : v];
  }));
  const r = parseCredit(fileName, fm).credit;
  assert.equal(r.hours, 1.25);
  assert.equal(r.category, 'Ethics "core"');
  assert.equal(r.provider, "Acme: Training");
  assert.deepEqual(r.certificates, ["[[cert.pdf]]"]);
  assert.match(validateCreditInput({ ...i, hours: 0 }), /Hours/);
  assert.match(validateCreditInput({ ...i, date: "" }), /date/);
});
