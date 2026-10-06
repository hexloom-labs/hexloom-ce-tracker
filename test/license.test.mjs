import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { checkLicense, maskEmail, PUBLIC_KEY } from "../src/license.ts";

const b64u = (b) => Buffer.from(b).toString("base64url");
const NOW = Date.UTC(2026, 9, 6);
const DAY = 86400;

function mint(privateKey, over = {}, tamper) {
  const payload = { v: 1, p: "pro", e: "ann@example.com", x: NOW / 1000 + 100 * DAY, s: "cs_test_1", ...over };
  const head = `HXCE1.${b64u(JSON.stringify(payload))}`;
  const sig = b64u(crypto.sign(null, Buffer.from(head), privateKey));
  return tamper ? tamper(head, sig) : `${head}.${sig}`;
}

const pair = crypto.generateKeyPairSync("ed25519");
const pub = b64u(pair.publicKey.export({ type: "spki", format: "der" }).subarray(-32));

test("valid key: ok, email and expiry date returned, whitespace and line breaks tolerated", async () => {
  const k = mint(pair.privateKey);
  const r = await checkLicense(`  ${k.slice(0, 40)}\n${k.slice(40)} `, NOW, pub);
  assert.deepEqual(r, { ok: true, email: "ann@example.com", expires: "2027-01-14" });
});

test("expired key is rejected with its date", async () => {
  const r = await checkLicense(mint(pair.privateKey, { x: NOW / 1000 - DAY }), NOW, pub);
  assert.equal(r.ok, false);
  assert.match(r.reason, /expired on 2026-10-05/);
});

test("tampered payload, wrong key, truncated, garbage and wrong product all fail closed", async () => {
  const good = mint(pair.privateKey);
  const [h, body, sig] = good.split(".");
  const forged = b64u(JSON.stringify({ v: 1, p: "pro", e: "evil@example.com", x: NOW / 1000 + 9999 * DAY, s: "x" }));
  const other = crypto.generateKeyPairSync("ed25519");
  const cases = [
    `${h}.${forged}.${sig}`,
    mint(other.privateKey),
    good.slice(0, -4),
    "",
    "not a key",
    "HXCE1.a.b",
    `HXCE2.${body}.${sig}`,
    mint(pair.privateKey, { p: "free" }),
    mint(pair.privateKey, { v: 2 }),
    mint(pair.privateKey, { x: "soon" }),
  ];
  for (const c of cases) assert.equal((await checkLicense(c, NOW, pub)).ok, false, c.slice(0, 50));
});

test("the shipped public key matches the real signing key (skipped when the private key is not on this machine)", async (t) => {
  const f = new URL("../../../../secrets/obsidian-ce-license-private.pem", import.meta.url);
  if (!fs.existsSync(f)) return t.skip("private key not present");
  const k = mint(crypto.createPrivateKey(fs.readFileSync(f)));
  assert.equal((await checkLicense(k, NOW, PUBLIC_KEY)).ok, true);
});

test("maskEmail hides the local part", () => {
  assert.equal(maskEmail("ann@example.com"), "a***@example.com");
  assert.equal(maskEmail("nonsense"), "");
});
