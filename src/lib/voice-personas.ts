/* ============================================================
 * Voice Persona Passport — the single source of truth for how
 * the agent SOUNDS, shared by every surface:
 *
 *   • web console picker (VoiceControls popover)
 *   • Telegram voice notes (VoiceOut delivery)
 *   • /api/voice/tts (web playback)
 *   • /api/agent/config (portal → gateway persona sync)
 *   • /voice + /voices inline picker in Telegram
 *
 * A persona is an identity (name + character), not just a voice id:
 * `localeVoiceFor()` keeps the persona's gender/energy but adapts
 * the locale to the language the agent is actually about to speak
 * (Cyrillic → Russian voice, Hebrew → Hebrew voice), so a chat in
 * Russian doesn't get mangled by an English-only neural voice.
 * ============================================================ */

export interface VoicePersona {
  /** stable id used in pickers, callbacks and the registry */
  voice: string;
  /** display name — matches the web console picker exactly */
  name: string;
  /** character line shown under the name in both pickers */
  persona: string;
  /** persona gender drives the locale adaptation */
  gender: "f" | "m";
  /** Telegram inline-keyboard emoji (web popover uses name only) */
  emoji: string;
}

/** The exact same presets the web console picker offers (store.ts re-exports this). */
export const VOICE_PERSONAS: VoicePersona[] = [
  { voice: "en-US-AvaNeural", name: "Nova — calm chief-of-staff", persona: "warm, unhurried, executive", gender: "f", emoji: "🌟" },
  { voice: "en-US-GuyNeural", name: "Atlas — technical operator", persona: "precise, dry, to the point", gender: "m", emoji: "🛠" },
  { voice: "en-US-AriaNeural", name: "Aria — bright & quick", persona: "energetic, upbeat", gender: "f", emoji: "⚡" },
  { voice: "en-GB-SoniaNeural", name: "Sonia — warm British assistant", persona: "polite, friendly", gender: "f", emoji: "🫖" },
  { voice: "en-US-EricNeural", name: "Eric — nordic calm", persona: "low, steady, reassuring", gender: "m", emoji: "🧊" },
  { voice: "en-US-MichelleNeural", name: "Michelle — no-nonsense exec", persona: "direct, confident", gender: "f", emoji: "💼" },
];

const BY_VOICE = new Map(VOICE_PERSONAS.map((p) => [p.voice, p]));

export function isKnownPersonaVoice(voiceId: string | null | undefined): boolean {
  return Boolean(voiceId && BY_VOICE.has(voiceId));
}

export function personaByVoice(voiceId: string | null | undefined): VoicePersona | undefined {
  return voiceId ? BY_VOICE.get(voiceId) : undefined;
}

export function personaLabel(voiceId: string | null | undefined): string {
  const p = personaByVoice(voiceId);
  return p ? `${p.emoji} ${p.name}` : "Default voice";
}

/* ---------------- locale adaptation ---------------- */

/** Fallback voice per gender when the persona's own locale can't speak
 *  the detected language (all verified live against the Edge TTS service). */
const LOCALE_VOICES: Record<string, { f: string; m: string }> = {
  en: { f: "en-US-AvaNeural", m: "en-US-GuyNeural" },
  ru: { f: "ru-RU-SvetlanaNeural", m: "ru-RU-DmitryNeural" },
  he: { f: "he-IL-HilaNeural", m: "he-IL-AvriNeural" },
};

const CYRILLIC_RE = /[\u0400-\u04FF]/;
const HEBREW_RE = /[\u0590-\u05FF]/;

/** Script detection on the text that is about to be spoken. */
export function detectSpeechLang(text: string): "ru" | "he" | "en" {
  if (CYRILLIC_RE.test(text)) return "ru";
  if (HEBREW_RE.test(text)) return "he";
  return "en";
}

/**
 * Resolve the concrete neural voice for a persona + text pair:
 * the persona's gender/style is preserved, the locale follows the
 * text (an English persona still speaks Russian with a Russian voice).
 * Without a known persona it falls back to a locale-appropriate default.
 */
export function localeVoiceFor(voiceId: string | null | undefined, text: string): string {
  const lang = detectSpeechLang(text);
  const persona = personaByVoice(voiceId);
  const table = LOCALE_VOICES[lang] ?? LOCALE_VOICES.en;
  if (!persona) return table.f;
  if (persona.voice.startsWith(`${lang}-`)) return persona.voice; // persona natively speaks it
  return table[persona.gender];
}

/* ---------------- synthesis tier plan (testable, pure) ---------------- */

export type VoiceTierPlan = {
  /** edge voice to request (always defined) */
  edgeVoice: string;
  /** true → Edge tier goes FIRST (persona pinned), z-ai is the fallback */
  personaPinned: boolean;
};

/**
 * Which synthesis order and voice to use for a given persona selection:
 *  • known persona  → Edge FIRST with that persona (deterministic sound —
 *    the z-ai tier cannot reproduce these voices and would drown the pick
 *    in its fixed default), z-ai only as reliability fallback
 *  • no persona     → legacy chain (z-ai first, Edge default second)
 */
export function personaVoicePlan(voiceId: string | null | undefined, text: string): VoiceTierPlan {
  if (isKnownPersonaVoice(voiceId)) {
    return { edgeVoice: localeVoiceFor(voiceId, text), personaPinned: true };
  }
  return { edgeVoice: localeVoiceFor(null, text), personaPinned: false };
}
