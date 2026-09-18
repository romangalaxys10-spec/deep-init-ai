/* ============================================================
 * voice-ledger — per-chat memory of voice notes ALREADY delivered
 *
 * When the tts tool delivers audio directly through the gateway (the
 * deterministic VoiceOut v2 architecture), the reply text must NOT be
 * spoken AGAIN by the voice mirror — that is how the user heard the
 * answer twice (and in the broken flow: the internal file path read
 * aloud). The tool layer notes a delivery here; the gateway consumes
 * the note right before deciding whether to mirror-speak the reply.
 *
 * Module-scoped, TTL'd, zero imports — safe in serverless: the tool
 * execution and the reply delivery happen inside the SAME request.
 * ============================================================ */

const TTL_MS = 90_000;
const MAX_ENTRIES = 512;

const ledger = new Map<string, number>();

function sweep(now: number) {
  for (const [k, at] of ledger) {
    if (now - at > TTL_MS) ledger.delete(k);
  }
}

/** Record that a voice note was delivered for this chat during the current turn. */
export function noteVoiceDelivered(key: string): void {
  if (!key) return;
  const now = Date.now();
  if (ledger.size >= MAX_ENTRIES) sweep(now);
  if (ledger.size >= MAX_ENTRIES) {
    const oldest = ledger.keys().next().value;
    if (oldest !== undefined) ledger.delete(oldest);
  }
  ledger.set(key, now);
}

/** Consume the delivery note — true exactly once per note (the mirror then stays silent). */
export function consumeVoiceDelivered(key: string): boolean {
  if (!key) return false;
  const now = Date.now();
  sweep(now);
  const at = ledger.get(key);
  if (at === undefined) return false;
  ledger.delete(key);
  return true;
}

/** Test helper — clear all state. */
export function resetVoiceLedger(): void {
  ledger.clear();
}
