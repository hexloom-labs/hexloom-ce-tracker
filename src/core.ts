// Pure credit math: no Obsidian imports, so it is tested directly in Node.

export const DUE_SOON_DAYS = 90;

export interface CategoryRule {
  name: string;
  minHours?: number;
  maxHours?: number;
}

export interface Requirement {
  id: string;
  name: string;
  requiredHours: number;
  cycleStart: string; // YYYY-MM-DD, inclusive
  cycleEnd: string; // YYYY-MM-DD, inclusive
  categories: CategoryRule[];
}

export interface Credit {
  path: string;
  date: string;
  hours: number;
  category: string;
  provider: string;
  certificates: string[];
  requirement: string;
}

export interface Rejected {
  path: string;
  reason: string;
}

export type Status = "complete" | "overdue" | "not-started" | "due-soon" | "on-track";

export interface CategoryRow {
  name: string;
  earned: number;
  counted: number;
  minHours: number;
  maxHours?: number;
  remainingToMin: number;
  met: boolean;
}

export interface Summary {
  requirement: Requirement;
  today: string;
  totalHours: number;
  remainingHours: number;
  percent: number;
  daysLeft: number;
  status: Status;
  categories: CategoryRow[];
  credits: Credit[];
  outsideCycle: number;
  otherRequirement: number;
  rejected: Rejected[];
}

const norm = (s: string) => s.trim().toLowerCase();
export const round2 = (n: number) => Math.round(n * 100) / 100;

export const EXAMPLE_REQUIREMENT: Omit<Requirement, "id"> = {
  name: "Example: 40 hours in 2 years",
  requiredHours: 40,
  cycleStart: "2026-01-01",
  cycleEnd: "2027-12-31",
  categories: [{ name: "Ethics", minHours: 2 }],
};

export function dayNumber(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s.trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const t = Date.UTC(y, mo - 1, d);
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return t / 86400000;
}

export function todayIso(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function validateRequirement(r: Requirement): string | null {
  if (!r.name.trim()) return "Give the requirement a name.";
  if (!(r.requiredHours > 0) || !Number.isFinite(r.requiredHours)) return "Required hours must be a number above 0.";
  const s = dayNumber(r.cycleStart), e = dayNumber(r.cycleEnd);
  if (s === null) return "Cycle start is not a valid date.";
  if (e === null) return "Cycle end is not a valid date.";
  if (e < s) return "Cycle end is before cycle start.";
  const seen = new Set<string>();
  for (const c of r.categories) {
    const k = norm(c.name);
    if (!k) return "Every category needs a name.";
    if (seen.has(k)) return `Category "${c.name}" appears twice.`;
    seen.add(k);
    if (c.minHours !== undefined && !(c.minHours >= 0)) return `Minimum for "${c.name}" must be 0 or more.`;
    if (c.maxHours !== undefined && !(c.maxHours >= 0)) return `Maximum for "${c.name}" must be 0 or more.`;
    if (c.minHours !== undefined && c.maxHours !== undefined && c.maxHours < c.minHours)
      return `Maximum for "${c.name}" is below its minimum.`;
  }
  return null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}

function certList(v: unknown): string[] {
  if (v == null) return [];
  const items = Array.isArray(v) ? v : [v];
  // Unquoted [[file.pdf]] in YAML arrives as a nested array; restore the link.
  return items
    .map((x) => (Array.isArray(x) ? `[[${str(x[0])}]]` : str(x)))
    .filter((x) => x && x !== "[[]]");
}

export function parseCredit(path: string, fm: Record<string, unknown> | undefined | null): { credit: Credit } | { rejected: Rejected } | null {
  if (!fm || !("ce-hours" in fm)) return null;
  const raw = fm["ce-hours"];
  const hours = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim().replace(",", ".")) : NaN;
  if (!Number.isFinite(hours) || hours <= 0) return { rejected: { path, reason: "ce-hours is not a number above 0" } };
  const date = str(fm["ce-date"]);
  if (dayNumber(date) === null) return { rejected: { path, reason: "ce-date is missing or not a valid YYYY-MM-DD date" } };
  return {
    credit: {
      path,
      date: date.slice(0, 10),
      hours,
      category: str(fm["ce-category"]),
      provider: str(fm["ce-provider"]),
      certificates: certList(fm["ce-certificate"]),
      requirement: str(fm["ce-requirement"]),
    },
  };
}

export function summarize(req: Requirement, credits: Credit[], rejected: Rejected[], today: string): Summary {
  const start = dayNumber(req.cycleStart)!, end = dayNumber(req.cycleEnd)!, now = dayNumber(today)!;
  const reqKeys = [norm(req.name), norm(req.id)];
  let outsideCycle = 0, otherRequirement = 0;
  const counted: Credit[] = [];
  for (const c of credits) {
    if (c.requirement && !reqKeys.includes(norm(c.requirement))) { otherRequirement++; continue; }
    const d = dayNumber(c.date)!;
    if (d < start || d > end) { outsideCycle++; continue; }
    counted.push(c);
  }
  counted.sort((a, b) => a.date.localeCompare(b.date) || a.path.localeCompare(b.path));

  const rows = new Map<string, CategoryRow>();
  for (const r of req.categories) {
    rows.set(norm(r.name), { name: r.name.trim(), earned: 0, counted: 0, minHours: r.minHours ?? 0, maxHours: r.maxHours, remainingToMin: 0, met: true });
  }
  for (const c of counted) {
    const k = norm(c.category) || "general";
    let row = rows.get(k);
    if (!row) {
      row = { name: c.category || "General", earned: 0, counted: 0, minHours: 0, remainingToMin: 0, met: true };
      rows.set(k, row);
    }
    row.earned += c.hours;
  }
  let total = 0;
  for (const row of rows.values()) {
    row.earned = round2(row.earned);
    row.counted = row.maxHours === undefined ? row.earned : Math.min(row.earned, row.maxHours);
    row.remainingToMin = round2(Math.max(0, row.minHours - row.counted));
    row.met = row.remainingToMin === 0;
    total += row.counted;
  }
  total = round2(total);
  const remainingHours = round2(Math.max(0, req.requiredHours - total));
  const categories = [...rows.values()].filter((r) => r.earned > 0 || r.minHours > 0 || r.maxHours !== undefined);
  const complete = remainingHours === 0 && categories.every((r) => r.met);
  const daysLeft = end - now;
  const status: Status = complete ? "complete" : daysLeft < 0 ? "overdue" : now < start ? "not-started" : daysLeft <= DUE_SOON_DAYS ? "due-soon" : "on-track";

  return {
    requirement: req,
    today,
    totalHours: total,
    remainingHours,
    percent: Math.min(100, Math.floor((total / req.requiredHours) * 100)),
    daysLeft,
    status,
    categories,
    credits: counted,
    outsideCycle,
    otherRequirement,
    rejected,
  };
}

// Spreadsheet apps run text that starts with these as a formula.
const csvCell = (v: string) => {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export interface ExportOptions {
  certificates: boolean;
}

export function toCsv(s: Summary, opts: ExportOptions): string {
  const head = ["Date", "Hours", "Category", "Provider", ...(opts.certificates ? ["Certificate"] : []), "Note"];
  const lines = [head.join(",")];
  for (const c of s.credits) {
    const cells = [c.date, String(c.hours), c.category, c.provider, ...(opts.certificates ? [c.certificates.join("; ")] : []), c.path];
    lines.push(cells.map((x, i) => (i === 1 ? x : csvCell(x))).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

const mdCell = (v: string) => v.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

export const STATUS_LABEL: Record<Status, string> = {
  complete: "Complete",
  overdue: "Overdue",
  "not-started": "Cycle not started",
  "due-soon": "Due soon",
  "on-track": "On track",
};

export function toMarkdown(s: Summary, opts: ExportOptions): string {
  const r = s.requirement;
  const out: string[] = [
    `# CE audit: ${r.name}`,
    "",
    `Cycle ${r.cycleStart} to ${r.cycleEnd}. Generated ${s.today}.`,
    "",
    "| | |",
    "|---|---|",
    `| Hours required | ${r.requiredHours} |`,
    `| Hours earned | ${s.totalHours} |`,
    `| Hours remaining | ${s.remainingHours} |`,
    `| Days left | ${s.daysLeft} |`,
    `| Status | ${STATUS_LABEL[s.status]} |`,
    "",
  ];
  if (s.categories.length) {
    out.push("## Categories", "", "| Category | Earned | Minimum | Maximum counted | Met |", "|---|---|---|---|---|");
    for (const c of s.categories)
      out.push(`| ${mdCell(c.name)} | ${c.earned} | ${c.minHours || ""} | ${c.maxHours ?? ""} | ${c.met ? "Yes" : `No, ${c.remainingToMin} short`} |`);
    out.push("");
  }
  out.push("## Credits", "");
  if (!s.credits.length) out.push("No credits in this cycle.");
  else {
    out.push(`| Date | Hours | Category | Provider |${opts.certificates ? " Certificate |" : ""} Note |`);
    out.push(`|---|---|---|---|${opts.certificates ? "---|" : ""}---|`);
    for (const c of s.credits)
      out.push(
        `| ${c.date} | ${c.hours} | ${mdCell(c.category)} | ${mdCell(c.provider)} |${opts.certificates ? ` ${mdCell(c.certificates.join("; "))} |` : ""} [[${c.path.replace(/\.md$/, "")}]] |`,
      );
  }
  if (s.rejected.length) {
    out.push("", "## Notes ignored", "");
    for (const x of s.rejected) out.push(`- [[${x.path.replace(/\.md$/, "")}]]: ${x.reason}`);
  }
  out.push("", "---", "Hours are self-reported from vault notes. Check your licensing board's own rules before you file.", "");
  return out.join("\n");
}

export function duplicateName(list: Requirement[], draft: Requirement, index: number): boolean {
  return list.some((r, i) => i !== index && (norm(r.name) === norm(draft.name) || norm(r.id) === norm(draft.name) || norm(r.name) === norm(draft.id)));
}

// Properties other plugins (Bases, Dataview, Tasks, reminders) can read. Never contains ce-hours, so it is not parsed as a credit.
export function buildStatusNote(s: Summary): string {
  const r = s.requirement;
  return [
    "---",
    `ce-requirement-status: ${JSON.stringify(r.name)}`,
    `ce-status: ${s.status}`,
    `ce-deadline: ${r.cycleEnd}`,
    `ce-days-left: ${s.daysLeft}`,
    `ce-hours-left: ${s.remainingHours}`,
    `ce-hours-earned: ${s.totalHours}`,
    `ce-hours-required: ${r.requiredHours}`,
    `ce-categories-open: ${s.categories.filter((c) => !c.met).length}`,
    `ce-updated: ${s.today}`,
    "---",
    "",
    `# ${r.name}: renewal status`,
    "",
    "CE Credit Tracker Pro rewrites this note when your credits or the date change. Use its properties in Bases, Dataview, Tasks or a reminder plugin. Edits here are overwritten.",
    "",
  ].join("\n");
}

export interface CreditInput {
  date: string;
  hours: number;
  category: string;
  provider: string;
  title: string;
  certificate: string;
  requirement?: string;
}

export function validateCreditInput(i: CreditInput): string | null {
  if (dayNumber(i.date) === null) return "Enter a valid date.";
  if (!Number.isFinite(i.hours) || i.hours <= 0) return "Hours must be a number above 0.";
  return null;
}

const q = (s: string) => JSON.stringify(s);

export function buildCreditNote(i: CreditInput): { fileName: string; content: string } {
  const label = (i.title || i.provider || "CE credit").replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "CE credit";
  const fm = [
    "---",
    `ce-date: ${i.date}`,
    `ce-hours: ${i.hours}`,
    `ce-category: ${q(i.category)}`,
    `ce-provider: ${q(i.provider)}`,
    `ce-certificate: ${q(i.certificate)}`,
    ...(i.requirement ? [`ce-requirement: ${q(i.requirement)}`] : []),
    "---",
    "",
    `# ${i.title || i.provider || "CE credit"}`,
    "",
  ];
  return { fileName: `${i.date} ${label}.md`, content: fm.join("\n") };
}
