import { App, ItemView, Modal, Notice, PluginSettingTab, Setting, WorkspaceLeaf } from "obsidian";
import type CEPlugin from "./main.ts";
import {
  EXAMPLE_REQUIREMENT, STATUS_LABEL, duplicateName, todayIso, validateCreditInput, validateRequirement,
  type CreditInput, type Requirement, type Summary,
} from "./core.ts";
import { maskEmail } from "./license.ts";

export const PRO_URL = "https://hexloomlabs.com/obsidian-ce/";

export const VIEW_TYPE = "hexloom-ce-dashboard";
const MAX_LISTED = 20;

export interface DashboardActions {
  log(): void;
  exportCsv(): void;
  exportMarkdown(): void;
  open(path: string): void;
  choices: { id: string; name: string }[];
  activeId: string;
  pick(id: string): void;
  pro: boolean;
}

const noteName = (p: string) => p.replace(/^.*\//, "").replace(/\.md$/, "");

export function renderDashboard(root: HTMLElement, s: Summary | null, a: DashboardActions): void {
  root.empty();
  root.addClass("hx-ce");
  if (!s) {
    root.createEl("h2", { text: "Set up your first requirement" });
    root.createEl("p", {
      cls: "hx-ce-muted",
      text: "Open this plugin's settings and enter the hours and cycle dates your licensing board gives you. Nothing is preloaded: you enter your own numbers.",
    });
    return;
  }
  const r = s.requirement;
  if (a.choices.length > 1) {
    const sel = root.createEl("select", { cls: "dropdown", attr: { "aria-label": "Requirement" } });
    for (const c of a.choices) sel.createEl("option", { text: c.name, attr: { value: c.id } });
    sel.value = a.activeId;
    sel.addEventListener("change", () => a.pick(sel.value));
  }
  root.createEl("h2", { text: r.name });
  root.createEl("p", { cls: "hx-ce-muted", text: `Cycle ${r.cycleStart} to ${r.cycleEnd}` });

  const bar = root.createDiv({
    cls: ["hx-ce-bar", `hx-ce-${s.status}`],
    attr: {
      role: "progressbar",
      "aria-label": `${s.totalHours} of ${r.requiredHours} hours`,
      "aria-valuemin": "0",
      "aria-valuemax": String(r.requiredHours),
      "aria-valuenow": String(Math.min(s.totalHours, r.requiredHours)),
    },
  });
  bar.createDiv({ cls: "hx-ce-fill" }).setCssProps({ "--hx-ce-pct": `${s.percent}%` });
  root.createDiv({ cls: "hx-ce-hours", text: `${s.totalHours} of ${r.requiredHours} hours (${s.percent}%)` });

  const stats = root.createDiv({ cls: "hx-ce-stats" });
  const tile = (label: string, value: string, sub = "") => {
    const t = stats.createDiv({ cls: "hx-ce-tile" });
    t.createDiv({ cls: "hx-ce-tile-label", text: label });
    t.createDiv({ cls: "hx-ce-tile-value", text: value });
    if (sub) t.createDiv({ cls: "hx-ce-muted", text: sub });
  };
  const open = s.categories.some((c) => !c.met);
  tile("Hours left", String(s.remainingHours), s.remainingHours === 0 && open ? "Total met, a category minimum is still open" : "");
  tile("Days left", String(Math.max(0, s.daysLeft)), s.daysLeft < 0 ? `Cycle ended ${-s.daysLeft} day${s.daysLeft === -1 ? "" : "s"} ago` : "");
  tile("Status", STATUS_LABEL[s.status]);

  if (s.categories.length) {
    root.createEl("h3", { text: "Categories" });
    const wrap = root.createDiv({ cls: "hx-ce-scroll" });
    const table = wrap.createEl("table", { cls: "hx-ce-table" });
    const head = table.createEl("thead").createEl("tr");
    for (const h of ["Category", "Earned", "Rule", "Status"]) head.createEl("th", { text: h });
    const body = table.createEl("tbody");
    for (const c of s.categories) {
      const tr = body.createEl("tr");
      tr.createEl("td", { text: c.name });
      tr.createEl("td", { text: c.counted < c.earned ? `${c.earned} (counts ${c.counted})` : String(c.earned) });
      const rule = [c.minHours ? `min ${c.minHours}` : "", c.maxHours !== undefined ? `max ${c.maxHours}` : ""].filter(Boolean).join(", ");
      tr.createEl("td", { text: rule || "No rule" });
      tr.createEl("td", { text: c.minHours ? (c.met ? "Met" : `${c.remainingToMin} short`) : "" });
    }
  }

  root.createEl("h3", { text: `Credits this cycle (${s.credits.length})` });
  if (!s.credits.length) {
    root.createEl("p", { cls: "hx-ce-muted", text: "No credits logged for this cycle yet. Use the button below to log one, or add the properties to a note you already have." });
  } else {
    const list = root.createEl("ul", { cls: "hx-ce-list" });
    for (const c of [...s.credits].reverse().slice(0, MAX_LISTED)) {
      const li = list.createEl("li");
      li.createSpan({ cls: "hx-ce-date", text: c.date });
      li.createSpan({ cls: "hx-ce-h", text: `${c.hours} h` });
      const meta = [c.category, c.provider].filter(Boolean).join(" · ");
      if (meta) li.createSpan({ cls: "hx-ce-muted", text: meta });
      const b = li.createEl("button", { cls: "hx-ce-linkbtn", text: noteName(c.path) });
      b.addEventListener("click", () => a.open(c.path));
    }
    if (s.credits.length > MAX_LISTED) root.createEl("p", { cls: "hx-ce-muted", text: `${s.credits.length - MAX_LISTED} older credits are in the exports.` });
  }

  const skipped = [
    s.outsideCycle ? `${s.outsideCycle} credit note${s.outsideCycle === 1 ? " falls" : "s fall"} outside this cycle.` : "",
    s.otherRequirement ? `${s.otherRequirement} note${s.otherRequirement === 1 ? " is" : "s are"} assigned to another requirement.` : "",
  ].filter(Boolean);
  if (skipped.length) root.createEl("p", { cls: "hx-ce-muted", text: skipped.join(" ") });

  if (s.rejected.length) {
    const warn = root.createDiv({ cls: "hx-ce-warn", attr: { role: "alert" } });
    warn.createEl("strong", { text: `${s.rejected.length} note${s.rejected.length === 1 ? " has" : "s have"} a problem and ${s.rejected.length === 1 ? "is" : "are"} not counted:` });
    const ul = warn.createEl("ul");
    for (const x of s.rejected.slice(0, 10)) {
      const li = ul.createEl("li");
      const b = li.createEl("button", { cls: "hx-ce-linkbtn", text: noteName(x.path) });
      b.addEventListener("click", () => a.open(x.path));
      li.createSpan({ text: `: ${x.reason}` });
    }
  }

  const actions = root.createDiv({ cls: "hx-ce-actions" });
  actions.createEl("button", { cls: "mod-cta", text: "Log a credit" }).addEventListener("click", () => a.log());
  actions.createEl("button", { text: "Export CSV" }).addEventListener("click", () => a.exportCsv());
  actions.createEl("button", { text: "Export Markdown" }).addEventListener("click", () => a.exportMarkdown());
  root.createEl("p", {
    cls: ["hx-ce-muted", "hx-ce-foot"],
    text: "A note counts when it has the properties ce-date and ce-hours. Optional: ce-category, ce-provider, ce-certificate, ce-requirement. A note without ce-requirement counts toward every requirement. Hours are self-reported; check your board's own rules.",
  });
  if (!a.pro) root.createEl("p", { cls: ["hx-ce-muted", "hx-ce-foot"], text: "Pro adds more than one requirement, certificates in the exports and deadline reminders as note properties. See this plugin's settings." });
}

export class DashboardView extends ItemView {
  plugin: CEPlugin;
  constructor(leaf: WorkspaceLeaf, plugin: CEPlugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "Credit dashboard"; }
  getIcon() { return "graduation-cap"; }
  async onOpen() { this.render(); }
  render() {
    renderDashboard(this.contentEl, this.plugin.summary(), {
      log: () => this.plugin.openLogModal(),
      exportCsv: () => void this.plugin.exportAudit("csv"),
      exportMarkdown: () => void this.plugin.exportAudit("md"),
      open: (p) => void this.app.workspace.openLinkText(p, "", false),
      choices: this.plugin.requirements().map((r) => ({ id: r.id, name: r.name })),
      activeId: this.plugin.active()?.id ?? "",
      pick: (id) => {
        this.plugin.settings.activeId = id;
        void this.plugin.saveSettings();
      },
      pro: this.plugin.pro,
    });
  }
}

export class LogCreditModal extends Modal {
  plugin: CEPlugin;
  v = { date: todayIso(new Date()), hours: "", category: "", provider: "", title: "", certificate: "", requirement: "" };
  constructor(app: App, plugin: CEPlugin) {
    super(app);
    this.plugin = plugin;
    this.v.requirement = plugin.active()?.id ?? "";
  }
  onOpen() {
    const { contentEl, v } = this;
    contentEl.empty();
    this.titleEl.setText("Log a credit");
    const list = this.plugin.requirements();
    const picked = list.find((r) => r.id === v.requirement) ?? list[0];
    const cats = picked?.categories ?? [];

    if (list.length > 1) {
      new Setting(contentEl).setName("Requirement").addDropdown((d) => {
        for (const r of list) d.addOption(r.id, r.name);
        d.setValue(picked.id);
        d.onChange((x) => {
          v.requirement = x;
          v.category = "";
          this.onOpen();
        });
      });
    }

    new Setting(contentEl).setName("Date").addText((t) => {
      t.inputEl.type = "date";
      t.setValue(v.date).onChange((x) => (v.date = x));
    });
    new Setting(contentEl).setName("Hours").setDesc("Use decimals for part hours, for example 1.5.").addText((t) => {
      t.inputEl.inputMode = "decimal";
      t.setValue(v.hours).onChange((x) => (v.hours = x));
    });
    if (cats.length) {
      new Setting(contentEl).setName("Category").addDropdown((d) => {
        d.addOption("", "None");
        for (const c of cats) d.addOption(c.name, c.name);
        d.setValue(v.category);
        d.onChange((x) => (v.category = x));
      });
    } else {
      new Setting(contentEl).setName("Category").addText((t) => t.setValue(v.category).onChange((x) => (v.category = x)));
    }
    new Setting(contentEl).setName("Course or session").addText((t) => t.setValue(v.title).onChange((x) => (v.title = x)));
    new Setting(contentEl).setName("Provider").addText((t) => t.setValue(v.provider).onChange((x) => (v.provider = x)));
    new Setting(contentEl)
      .setName("Certificate")
      .setDesc("A link or a file in your vault, for example [[certificate.pdf]].")
      .addText((t) => t.setValue(v.certificate).onChange((x) => (v.certificate = x)));

    const err = contentEl.createDiv({ cls: "hx-ce-error", attr: { role: "alert" } });
    new Setting(contentEl)
      .addButton((b) =>
        b.setButtonText("Log credit").setCta().onClick(async () => {
          const input: CreditInput = {
            date: v.date,
            hours: Number(v.hours.trim().replace(",", ".")),
            category: v.category.trim(),
            provider: v.provider.trim(),
            title: v.title.trim(),
            certificate: v.certificate.trim(),
            ...(list.length > 1 && picked ? { requirement: picked.name } : {}),
          };
          const bad = validateCreditInput(input);
          if (bad) return err.setText(bad);
          try {
            await this.plugin.createCredit(input);
            this.close();
          } catch (e) {
            err.setText(`Could not create the note: ${e instanceof Error ? e.message : String(e)}`);
          }
        }),
      )
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
  }
  onClose() { this.contentEl.empty(); }
}

const blank = (id = "main"): Requirement => ({ id, name: "", requiredHours: 0, cycleStart: "", cycleEnd: "", categories: [] });
const num = (s: string): number | undefined => {
  const t = s.trim().replace(",", ".");
  return t === "" ? undefined : Number(t);
};

export class CESettingTab extends PluginSettingTab {
  plugin: CEPlugin;
  draft: Requirement = blank();
  index = 0;
  status!: HTMLElement;
  constructor(app: App, plugin: CEPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const list = this.plugin.settings.requirements;
    const at = list.findIndex((r) => r.id === this.plugin.active()?.id);
    this.index = Math.max(0, at);
    this.draft = structuredClone(list[this.index] ?? blank());
    this.render();
  }
  private async changed() {
    const list = this.plugin.settings.requirements;
    const bad = validateRequirement(this.draft) ?? (duplicateName(list, this.draft, this.index) ? "Another requirement already uses this name." : null);
    this.status.setText(bad ? `Not saved yet: ${bad}` : "Saved.");
    this.status.toggleClass("hx-ce-error", !!bad);
    if (bad) return;
    list[this.index] = structuredClone(this.draft);
    this.plugin.settings.activeId = this.draft.id;
    await this.plugin.saveSettings();
  }
  private newRequirement() {
    if (!this.plugin.pro) return void new Notice("Pro feature: more than one requirement. Details are lower on this page.");
    this.index = this.plugin.settings.requirements.length;
    this.draft = blank(`r-${Date.now().toString(36)}`);
    this.render();
  }
  private async removeRequirement() {
    this.plugin.settings.requirements.splice(this.index, 1);
    this.index = 0;
    this.draft = structuredClone(this.plugin.settings.requirements[0] ?? blank());
    this.plugin.settings.activeId = this.draft.id;
    await this.plugin.saveSettings();
    this.render();
  }
  private render() {
    const { containerEl } = this;
    const d = this.draft;
    const saved = this.plugin.requirements();
    containerEl.empty();

    const unsaved = this.index >= this.plugin.settings.requirements.length && this.index > 0;
    new Setting(containerEl)
      .setName("Requirement")
      .setDesc("Pro lets you track several licences or people, each with its own cycle.")
      .addDropdown((dd) => {
        saved.forEach((r, i) => { dd.addOption(String(i), r.name); });
        if (unsaved || !saved.length) dd.addOption(String(this.index), "New requirement (not saved yet)");
        dd.setValue(String(this.index));
        dd.onChange((x) => {
          this.index = Number(x);
          const chosen = this.plugin.settings.requirements[this.index];
          if (chosen) {
            this.draft = structuredClone(chosen);
            this.plugin.settings.activeId = chosen.id;
            void this.plugin.saveSettings();
          }
          this.render();
        });
      })
      .addButton((b) => b.setButtonText(this.plugin.pro ? "Add requirement" : "Add requirement (Pro)").onClick(() => this.newRequirement()));
    new Setting(containerEl)
      .setName("Example")
      .setDesc("Fills in a made-up example so you can see how it works. Replace every number with the one your licensing board gives you.")
      .addButton((b) =>
        b.setButtonText("Load example").onClick(() => {
          this.draft = { ...structuredClone(EXAMPLE_REQUIREMENT), id: d.id };
          this.render();
          void this.changed();
        }),
      );
    new Setting(containerEl).setName("Name").setDesc("For example, your license and renewal period.").addText((t) => t.setValue(d.name).onChange((x) => { d.name = x; void this.changed(); }));
    new Setting(containerEl).setName("Hours required").addText((t) => {
      t.inputEl.inputMode = "decimal";
      t.setValue(d.requiredHours ? String(d.requiredHours) : "").onChange((x) => { d.requiredHours = num(x) ?? 0; void this.changed(); });
    });
    new Setting(containerEl).setName("Cycle start").addText((t) => {
      t.inputEl.type = "date";
      t.setValue(d.cycleStart).onChange((x) => { d.cycleStart = x; void this.changed(); });
    });
    new Setting(containerEl).setName("Cycle end").setDesc("The last day credits count.").addText((t) => {
      t.inputEl.type = "date";
      t.setValue(d.cycleEnd).onChange((x) => { d.cycleEnd = x; void this.changed(); });
    });

    new Setting(containerEl).setName("Categories").setHeading();
    new Setting(containerEl).setDesc("Optional. A minimum is hours you must earn in that category (for example ethics). A maximum is the most hours that category can contribute to the total. Leave blank for no rule.");
    d.categories.forEach((c, i) => {
      new Setting(containerEl)
        .addText((t) => t.setPlaceholder("Name").setValue(c.name).onChange((x) => { c.name = x; void this.changed(); }))
        .addText((t) => {
          t.inputEl.inputMode = "decimal";
          t.setPlaceholder("Min").setValue(c.minHours === undefined ? "" : String(c.minHours)).onChange((x) => { c.minHours = num(x); void this.changed(); });
        })
        .addText((t) => {
          t.inputEl.inputMode = "decimal";
          t.setPlaceholder("Max").setValue(c.maxHours === undefined ? "" : String(c.maxHours)).onChange((x) => { c.maxHours = num(x); void this.changed(); });
        })
        .addExtraButton((b) => b.setIcon("trash").setTooltip("Remove category").onClick(() => { d.categories.splice(i, 1); this.render(); void this.changed(); }));
    });
    new Setting(containerEl).addButton((b) => b.setButtonText("Add category").onClick(() => { d.categories.push({ name: "" }); this.render(); void this.changed(); }));

    this.status = containerEl.createDiv({ cls: "hx-ce-muted", attr: { role: "status" } });

    if (this.plugin.settings.requirements.length > 1 && this.plugin.pro) {
      new Setting(containerEl).addButton((b) => b.setButtonText("Remove this requirement").setWarning().onClick(() => void this.removeRequirement()));
    }
    const hidden = this.plugin.settings.requirements.length - saved.length;
    if (hidden > 0) {
      containerEl.createDiv({ cls: "hx-ce-muted", text: `${hidden} more requirement${hidden === 1 ? " is" : "s are"} saved but paused until Pro is active again. Nothing was deleted.` });
    }

    new Setting(containerEl).setName("Notes").setHeading();
    new Setting(containerEl)
      .setName("Folder for new credit notes")
      .setDesc("Used when logging a credit, by the exports and by the status notes that come with a paid key. Any note with the credit properties counts, wherever it lives.")
      .addText((t) => t.setValue(this.plugin.settings.folder).onChange(async (x) => {
        this.plugin.settings.folder = x.trim() || "CE Credits";
        await this.plugin.saveSettings();
      }));

    this.renderPro(containerEl);
  }
  private renderPro(el: HTMLElement) {
    const lic = this.plugin.license;
    new Setting(el).setName("Pro").setHeading();
    const stateLine = el.createDiv({ cls: "hx-ce-muted", attr: { role: "status" } });
    stateLine.setText(
      lic?.ok
        ? `Pro is active until ${lic.expires}, licensed to ${maskEmail(lic.email)}.`
        : lic
          ? lic.reason
          : "Pro adds more than one requirement, certificates listed in the exports, and deadline reminders written as note properties. $29 for one year, one payment, no auto-renewal. The free features keep working either way.",
    );
    if (lic && !lic.ok) stateLine.addClass("hx-ce-error");
    let key = "";
    new Setting(el)
      .setName("License key")
      .setDesc("Paste the key from your receipt page or email. It is checked on this device; the plugin sends nothing anywhere.")
      .addText((t) => t.setPlaceholder("HXCE1").onChange((x) => (key = x)))
      .addButton((b) =>
        b.setButtonText("Activate").setCta().onClick(async () => {
          const r = await this.plugin.activate(key);
          if (r.ok) return this.render();
          stateLine.setText(r.reason);
          stateLine.addClass("hx-ce-error");
        }),
      );
    new Setting(el)
      .setName(lic?.ok ? "Renew or manage" : "Get Pro")
      .setDesc("Opens hexloomlabs.com in your browser. Lost your key? Enter your purchase email there and it is sent again.")
      .addButton((b) => b.setButtonText("Open page").onClick(() => window.open(PRO_URL)));
    if (this.plugin.settings.licenseKey) {
      new Setting(el).addButton((b) => b.setButtonText("Remove key from this vault").onClick(async () => { await this.plugin.removeLicense(); this.render(); }));
    }
  }
}
