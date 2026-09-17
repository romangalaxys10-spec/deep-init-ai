/* ---------- Token generators (shared client / server) ---------- */

/** Unambiguous charset: no 0/O/1/I/L. */
const TOKEN_CHARSET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function randChars(n: number): string {
  let out = "";
  const buf = new Uint32Array(n);
  crypto.getRandomValues(buf);
  for (let i = 0; i < n; i++) out += TOKEN_CHARSET[buf[i] % TOKEN_CHARSET.length];
  return out;
}

/** Channel Pairing Token — e.g. DIP-7K2M-9QX4 */
export function genPairingToken(): string {
  return `DIP-${randChars(4)}-${randChars(4)}`;
}

export function isValidPairingToken(s: string): boolean {
  return /^DIP-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/.test(s.toUpperCase());
}

/** Web portal access token — e.g. di_9f3ac2... (24 hex chars) */
export function genPortalToken(): string {
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  return "di_" + Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Portal username slug from a display name — e.g. "Alex R." -> "alex-r" */
export function slugifyUser(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  return slug || "operator";
}
