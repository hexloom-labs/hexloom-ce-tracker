# CE Credit Tracker

Track continuing education credits toward a license renewal, inside your vault. It works for any recurring credit cycle: CE hours, CPE, CLE, PDH and similar.

You tell it what you need to earn and by when. You log each credit as an ordinary note. A dashboard shows hours earned, hours left, days left and any category minimums you have not met yet, and one command exports an audit-ready CSV or Markdown file.

## What it does not do

- It has **no rules database** and makes **no claim about any board's requirements**. You enter your own numbers. The built-in example is made up; replace every number with the one your licensing board gives you.
- Hours are self-reported from your notes. The plugin does not check that a course is accepted by your board.

## Set up

1. Open **Settings**, then **CE Credit Tracker**.
2. Enter a name, the hours required, and the first and last day of your cycle. Optionally add categories: a **minimum** is hours you must earn in that category (for example ethics), a **maximum** is the most hours that category can contribute to the total.
3. Run **Open dashboard** from the command palette, or click the graduation cap icon in the ribbon.

## Log credits

Run **Log a credit**, or add these properties to any note you already have:

| Property | Required | Example |
|---|---|---|
| `ce-date` | yes | `2026-03-05` |
| `ce-hours` | yes | `1.5` |
| `ce-category` | no | `Ethics` |
| `ce-provider` | no | `Example Training Co.` |
| `ce-certificate` | no | `[[certificate.pdf]]` or a link |
| `ce-requirement` | no | `Nurse licence` (the name of one of your requirements; Pro) |

A note counts when it has `ce-date` and `ce-hours`, wherever it lives in the vault. Credits dated outside your cycle are not counted. A note without `ce-requirement` counts toward every requirement you have. Notes with a bad value (for example `ce-hours: lots`) are listed on the dashboard with the reason, so nothing is dropped silently.

## Export an audit

**Export audit as CSV** and **Export audit as Markdown** write a file into your credit folder (default `CE Credits`) with every counted credit, your totals, and your category status. CSV cells that start with `=`, `+`, `-` or `@` are prefixed so spreadsheet apps do not run them as formulas.

## Pro (optional, paid)

The free plugin is complete for one requirement and stays free. **Pro** is a one-year key, $29 once, no auto-renewal. It adds:

- **More than one requirement**: several licences or several people, each with its own cycle, categories and dashboard.
- **Certificates in the exports**: the audit CSV and Markdown list each credit's `ce-certificate` link.
- **Deadline reminders as note properties**: one status note per requirement (`Status <name>.md` in your credit folder) with `ce-status`, `ce-deadline`, `ce-days-left`, `ce-hours-left`, `ce-hours-earned`, `ce-hours-required` and `ce-categories-open`, kept current so Bases, Dataview, Tasks or a reminder plugin can use them.

Buy it at [hexloomlabs.com/obsidian-ce](https://hexloomlabs.com/obsidian-ce/) (payment is handled by Stripe in your browser, outside Obsidian). You get a key on the receipt page and by email; paste it into **Settings, CE Credit Tracker, Pro**. When a key expires, Pro features pause; nothing is deleted and the free features keep working.

## Privacy and network use

- The plugin makes no network requests. No account. No telemetry. No ads.
- Pro keys are signed and checked on your device. The plugin never contacts a server to activate or verify a key. The Settings button that opens the purchase page opens your browser.
- Your credits stay in your notes. Your requirement settings (and your Pro key, if you add one) are stored in this plugin's `data.json` inside your vault.

## Install

Open **Settings**, then **Community plugins**, search for **CE Credit Tracker** and install it. To install by hand, copy `main.js`, `manifest.json` and `styles.css` from a release into `.obsidian/plugins/hexloom-ce-tracker/`.

## Development

```
npm install
npm test        # credit math and plugin tests against a mocked Obsidian API
npm run build
```

## License

MIT. See `LICENSE`. Made by [Hexloom Labs](https://hexloomlabs.com/obsidian-ce/).
