import { verifyAsync } from "@noble/ed25519";

// Raw Ed25519 public key. Keys are signed by Hexloom Labs; nothing here talks to a server.
export const PUBLIC_KEY = "4mWka_1KaEtI6fCpo1pWusiBq9fhojSTFjPDc4nAIuU";

export type LicenseResult =
  | { ok: true; email: string; expires: string }
  | { ok: false; reason: string };

const enc = new TextEncoder();

function b64u(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export async function checkLicense(raw: string, nowMs: number, publicKey = PUBLIC_KEY): Promise<LicenseResult> {
  const key = raw.trim().replace(/\s+/g, "");
  const parts = key.split(".");
  if (parts.length !== 3 || parts[0] !== "HXCE1") return { ok: false, reason: "That does not look like a CE Credit Tracker Pro key." };
  const sig = b64u(parts[2]);
  const pub = b64u(publicKey);
  const body = b64u(parts[1]);
  if (!sig || sig.length !== 64 || !pub || !body) return { ok: false, reason: "That key is damaged. Copy it again in full." };
  let valid = false;
  try {
    valid = await verifyAsync(sig, enc.encode(`${parts[0]}.${parts[1]}`), pub);
  } catch {
    return { ok: false, reason: "This device cannot check keys (no WebCrypto)." };
  }
  if (!valid) return { ok: false, reason: "That key is not valid." };
  let p: { v?: unknown; p?: unknown; e?: unknown; x?: unknown };
  try {
    p = JSON.parse(new TextDecoder().decode(body)) as typeof p;
  } catch {
    return { ok: false, reason: "That key is damaged." };
  }
  if (p.v !== 1 || p.p !== "pro" || typeof p.x !== "number" || typeof p.e !== "string") return { ok: false, reason: "That key is not valid." };
  const expires = new Date(p.x * 1000).toISOString().slice(0, 10);
  if (p.x * 1000 <= nowMs) return { ok: false, reason: `That key expired on ${expires}. Buy a new one to renew.` };
  return { ok: true, email: p.e, expires };
}

export function maskEmail(e: string): string {
  const [u, d] = e.split("@");
  return d ? `${u.slice(0, 1)}***@${d}` : "";
}
