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

import { detectLang } from "./lang-detect";

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

/** Native Edge voice per language, split by persona gender — the persona's
 *  character (gender/energy) is preserved while the locale follows the
 *  language actually being spoken. All voices are standard Azure/Edge
 *  Neural voices (the same family the English personas come from). */
const LOCALE_VOICES: Record<string, { f: string; m: string }> = {
  en: { f: "en-US-AvaNeural", m: "en-US-GuyNeural" },
  ru: { f: "ru-RU-SvetlanaNeural", m: "ru-RU-DmitryNeural" },
  he: { f: "he-IL-HilaNeural", m: "he-IL-AvriNeural" },
  uk: { f: "uk-UA-PolinaNeural", m: "uk-UA-OstapNeural" },
  es: { f: "es-ES-ElviraNeural", m: "es-ES-AlvaroNeural" },
  pt: { f: "pt-BR-FranciscaNeural", m: "pt-BR-AntonioNeural" },
  fr: { f: "fr-FR-DeniseNeural", m: "fr-FR-HenriNeural" },
  de: { f: "de-DE-KatjaNeural", m: "de-DE-ConradNeural" },
  it: { f: "it-IT-ElsaNeural", m: "it-IT-DiegoNeural" },
  tr: { f: "tr-TR-EmelNeural", m: "tr-TR-AhmetNeural" },
  ar: { f: "ar-SA-ZariyahNeural", m: "ar-SA-HamedNeural" },
  fa: { f: "fa-IR-DilaraNeural", m: "fa-IR-FaridNeural" },
  ka: { f: "ka-GE-EkaNeural", m: "ka-GE-GiorgiNeural" },
  pl: { f: "pl-PL-ZofiaNeural", m: "pl-PL-MarekNeural" },
  nl: { f: "nl-NL-ColetteNeural", m: "nl-NL-MaartenNeural" },
  zh: { f: "zh-CN-XiaoxiaoNeural", m: "zh-CN-YunxiNeural" },
  ja: { f: "ja-JP-NanamiNeural", m: "ja-JP-KeitaNeural" },
  ko: { f: "ko-KR-SunHiNeural", m: "ko-KR-InJoonNeural" },
  hi: { f: "hi-IN-SwaraNeural", m: "hi-IN-MadhurNeural" },
  th: { f: "th-TH-PremwadeeNeural", m: "th-TH-NiwatNeural" },
  vi: { f: "vi-VN-HoaiMyNeural", m: "vi-VN-NamMinhNeural" },
  // id-ID-ArifNeural (the only id-ID male) currently fails synthesis on the
  // Edge tier ("no turn.end", verified against a GadisNeural control) — the
  // female voice beats an English fallback mangling Indonesian.
  id: { f: "id-ID-GadisNeural", m: "id-ID-GadisNeural" },
};

/**
 * Script/stop-word detection on the text that is about to be spoken.
 * Delegates to the shared Language Mirror detector so the voice always
 * matches the language the user actually heard / asked in.
 */
export function detectSpeechLang(text: string): string {
  return detectLang(text);
}

/**
 * Resolve the Edge voice for a given persona + text pair (the Edge tier
 * is now ALWAYS the primary synthesis path — the voice is deterministic
 * instead of the z-ai fixed default that drowned every unpicked chat):
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
  /** edge voice to request (always defined — Edge is the primary tier) */
  edgeVoice: string;
  /** true → the voice comes from an explicit persona pick (deterministic
   *  sound); false → locale-appropriate default, still Edge-first */
  personaPinned: boolean;
};

/**
 * Which Edge voice to use for a given persona selection:
 *  • known persona  → that persona's voice, locale-adapted to the text
 *    (deterministic sound — the z-ai tier cannot reproduce these voices
 *    and previously drowned every pick in its fixed default)
 *  • no persona     → locale-appropriate default voice
 * The z-ai cloud tier is a reliability-only fallback in voice-out.ts.
 */
export function personaVoicePlan(voiceId: string | null | undefined, text: string): VoiceTierPlan {
  if (isKnownPersonaVoice(voiceId)) {
    return { edgeVoice: localeVoiceFor(voiceId, text), personaPinned: true };
  }
  return { edgeVoice: localeVoiceFor(null, text), personaPinned: false };
}
