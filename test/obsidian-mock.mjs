// Minimal stand-in for the Obsidian API: just what the plugin touches.
export class FakeEl {
  constructor(tag = "div", info = {}) {
    this.tag = tag;
    const cls = info.cls || [];
    if (typeof cls === "string" && cls.includes(" ")) throw new Error("classList.add rejects spaces: " + cls);
    this.cls = new Set([].concat(cls));
    this.textContent = info.text || "";
    this.attr = info.attr || {};
    this.children = [];
    this.listeners = {};
    this.props = {};
    
  }
  setCssProps(p) { Object.assign(this.props, p); }
  createEl(tag, info = {}) { const e = new FakeEl(tag, info); this.children.push(e); return e; }
  createDiv(info) { return this.createEl("div", info); }
  createSpan(info) { return this.createEl("span", info); }
  empty() { this.children = []; this.textContent = ""; }
  addClass(c) { this.cls.add(c); }
  toggleClass(c, on) { on ? this.cls.add(c) : this.cls.delete(c); }
  setText(t) { this.textContent = t; return this; }
  addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  click() { (this.listeners.click || []).forEach((f) => f()); }
  text() { return [this.textContent, ...this.children.map((c) => c.text())].filter(Boolean).join(" "); }
  all(pred, out = []) { if (pred(this)) out.push(this); this.children.forEach((c) => c.all(pred, out)); return out; }
}

export class TFile { constructor(path) { this.path = path; } }
export class Notice { static log = []; constructor(m) { Notice.log.push(m); } }
export const normalizePath = (p) => p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
export const debounce = (fn) => Object.assign((...a) => fn(...a), { cancel() {} });

export class Plugin {
  constructor(app) {
    this.app = app; this.commands = []; this.views = {}; this.ribbons = []; this.tabs = []; this.events = []; this.data = null; this.saved = [];
  }
  async loadData() { return this.data; }
  async saveData(d) { this.saved.push(JSON.parse(JSON.stringify(d))); }
  registerView(t, f) { this.views[t] = f; }
  addRibbonIcon(icon, title, cb) { this.ribbons.push({ icon, title, cb }); }
  addCommand(c) { this.commands.push(c); }
  addSettingTab(t) { this.tabs.push(t); }
  registerEvent(e) { this.events.push(e); }
}
export class ItemView { constructor(leaf) { this.leaf = leaf; this.app = leaf.app; this.contentEl = new FakeEl(); } }
export class Modal {
  constructor(app) { this.app = app; this.contentEl = new FakeEl(); this.titleEl = new FakeEl(); this.closed = false; }
  open() { this.opened = true; this.onOpen(); }
  close() { this.closed = true; this.onClose?.(); }
}
export class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = new FakeEl(); } }

export class Setting {
  static all = [];
  constructor(el) { this.el = el; this.name = ""; this.desc = ""; this.comps = []; Setting.all.push(this); }
  setName(n) { this.name = n; return this; }
  setDesc(d) { this.desc = d; return this; }
  setHeading() { this.heading = true; return this; }
  addText(cb) {
    const c = { inputEl: new FakeEl("input"), value: "", setValue(v) { this.value = v; return this; }, setPlaceholder() { return this; }, onChange(fn) { this.handler = fn; return this; } };
    this.comps.push(c); cb(c); return this;
  }
  addDropdown(cb) {
    const c = { options: [], addOption(v) { this.options.push(v); return this; }, setValue(v) { this.value = v; return this; }, onChange(fn) { this.handler = fn; return this; } };
    this.comps.push(c); cb(c); return this;
  }
  addButton(cb) {
    const c = { setButtonText(t) { this.text = t; return this; }, setCta() { return this; }, setWarning() { return this; }, onClick(fn) { this.click = fn; return this; } };
    this.comps.push(c); cb(c); return this;
  }
  addExtraButton(cb) {
    const c = { setIcon() { return this; }, setTooltip() { return this; }, onClick(fn) { this.click = fn; return this; } };
    this.comps.push(c); cb(c); return this;
  }
}

globalThis.__obsidianMock = { FakeEl, TFile, Notice, Setting };
