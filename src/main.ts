import { Notice, Plugin, TFile, debounce, normalizePath } from "obsidian";
import {
  buildCreditNote, buildStatusNote, parseCredit, summarize, todayIso, toCsv, toMarkdown, validateRequirement,
  type Credit, type CreditInput, type Rejected, type Requirement, type Summary,
} from "./core.ts";
import { checkLicense, type LicenseResult } from "./license.ts";
import { CESettingTab, DashboardView, LogCreditModal, VIEW_TYPE } from "./ui.ts";

interface Settings {
  requirements: Requirement[];
  folder: string;
  licenseKey: string;
  activeId: string;
}

const DEFAULTS: Settings = { requirements: [], folder: "CE Credits", licenseKey: "", activeId: "" };
const safeLabel = (s: string) => s.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);

export default class CEPlugin extends Plugin {
  settings: Settings = DEFAULTS;
  license: LicenseResult | null = null;
  private statusBusy = false;

  get pro() {
    return this.license?.ok === true;
  }

  async onload() {
    this.settings = { ...DEFAULTS, ...((await this.loadData()) as Partial<Settings> | null) };
    await this.refreshLicense();

    const refresh = debounce(() => { this.renderViews(); void this.writeStatusNotes(); }, 400, true);
    this.registerView(VIEW_TYPE, (leaf) => new DashboardView(leaf, this));
    this.addRibbonIcon("graduation-cap", "Open credit dashboard", () => void this.openDashboard());
    this.addCommand({ id: "open-dashboard", name: "Open dashboard", callback: () => void this.openDashboard() });
    this.addCommand({ id: "log-credit", name: "Log a credit", callback: () => this.openLogModal() });
    this.addCommand({ id: "export-csv", name: "Export audit as CSV", callback: () => void this.exportAudit("csv") });
    this.addCommand({ id: "export-markdown", name: "Export audit as Markdown", callback: () => void this.exportAudit("md") });
    this.addSettingTab(new CESettingTab(this.app, this));

    this.registerEvent(this.app.metadataCache.on("changed", refresh));
    this.registerEvent(this.app.metadataCache.on("resolved", refresh));
    this.registerEvent(this.app.vault.on("delete", refresh));
    this.registerEvent(this.app.vault.on("rename", refresh));
    this.app.workspace.onLayoutReady(() => void this.writeStatusNotes());
  }

  async refreshLicense() {
    this.license = this.settings.licenseKey ? await checkLicense(this.settings.licenseKey, Date.now()) : null;
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.renderViews();
    void this.writeStatusNotes();
  }

  async activate(key: string): Promise<LicenseResult> {
    const r = await checkLicense(key, Date.now());
    if (r.ok) {
      this.settings.licenseKey = key.trim().replace(/\s+/g, "");
      this.license = r;
      await this.saveSettings();
    }
    return r;
  }

  async removeLicense() {
    this.settings.licenseKey = "";
    this.license = null;
    await this.saveSettings();
  }

  // Free keeps the first requirement; Pro unlocks the rest. Nothing is deleted when Pro lapses.
  requirements(): Requirement[] {
    return this.pro ? this.settings.requirements : this.settings.requirements.slice(0, 1);
  }

  active(): Requirement | undefined {
    const list = this.requirements();
    return list.find((r) => r.id === this.settings.activeId) ?? list[0];
  }

  private renderViews() {
    for (const l of this.app.workspace.getLeavesOfType(VIEW_TYPE)) if (l.view instanceof DashboardView) l.view.render();
  }

  collect(): { credits: Credit[]; rejected: Rejected[] } {
    const credits: Credit[] = [];
    const rejected: Rejected[] = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      const p = parseCredit(f.path, this.app.metadataCache.getFileCache(f)?.frontmatter);
      if (!p) continue;
      if ("credit" in p) credits.push(p.credit);
      else rejected.push(p.rejected);
    }
    return { credits, rejected };
  }

  summary(req = this.active()): Summary | null {
    if (!req || validateRequirement(req)) return null;
    const { credits, rejected } = this.collect();
    return summarize(req, credits, rejected, todayIso(new Date()));
  }

  async openDashboard() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    void workspace.revealLeaf(leaf);
  }

  openLogModal() {
    if (!this.summary()) return void new Notice("Set up a requirement first in this plugin's settings.");
    new LogCreditModal(this.app, this).open();
  }

  private folder() {
    return normalizePath(this.settings.folder || DEFAULTS.folder);
  }

  private async ensureFolder(path: string) {
    let cur = "";
    for (const part of path.split("/")) {
      cur = cur ? `${cur}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(cur)) await this.app.vault.createFolder(cur);
    }
  }

  async createCredit(input: CreditInput): Promise<TFile> {
    const { fileName, content } = buildCreditNote(input);
    const folder = this.folder();
    await this.ensureFolder(folder);
    let path = normalizePath(`${folder}/${fileName}`);
    for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = normalizePath(`${folder}/${fileName.replace(/\.md$/, ` (${n}).md`)}`);
    const file = await this.app.vault.create(path, content);
    new Notice(`Logged ${input.hours} hour${input.hours === 1 ? "" : "s"}.`);
    return file;
  }

  async exportAudit(kind: "csv" | "md") {
    const s = this.summary();
    if (!s) return void new Notice("Set up a requirement first in this plugin's settings.");
    const opts = { certificates: this.pro };
    const body = kind === "csv" ? toCsv(s, opts) : toMarkdown(s, opts);
    const label = safeLabel(s.requirement.name);
    const folder = this.folder();
    await this.ensureFolder(folder);
    const path = normalizePath(`${folder}/Audit ${label} ${s.today}.${kind}`);
    const existing = this.app.vault.getAbstractFileByPath(path);
    const file = existing instanceof TFile ? (await this.app.vault.process(existing, () => body), existing) : await this.app.vault.create(path, body);
    new Notice(`Saved ${file.path}`);
    if (kind === "md") await this.app.workspace.getLeaf(false).openFile(file);
  }

  // Pro: one properties-only note per requirement. Writes only when the content changed, so it cannot loop on its own edits.
  async writeStatusNotes() {
    if (!this.pro || this.statusBusy) return;
    this.statusBusy = true;
    try {
      const folder = this.folder();
      const used = new Set<string>();
      for (const req of this.requirements()) {
        const s = this.summary(req);
        if (!s) continue;
        const body = buildStatusNote(s);
        await this.ensureFolder(folder);
        const path = normalizePath(`${folder}/Status ${safeLabel(req.name)}.md`);
        if (used.has(path)) continue;
        used.add(path);
        const f = this.app.vault.getAbstractFileByPath(path);
        if (f instanceof TFile) {
          if ((await this.app.vault.read(f)) !== body) await this.app.vault.process(f, () => body);
        } else {
          await this.app.vault.create(path, body);
        }
      }
    } catch (e) {
      new Notice(`CE Credit Tracker: could not update the status notes (${e instanceof Error ? e.message : String(e)}).`);
    } finally {
      this.statusBusy = false;
    }
  }
}
