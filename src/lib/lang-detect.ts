/* ============================================================
 * Language detection — "Language Mirror" core, shared by every
 * surface that needs to know WHICH language it is looking at:
 *
 *   • STT transcripts (Telegram voice notes + web dictation) →
 *     which language the user SPOKE → reply-language directive
 *   • voice-personas localeVoiceFor() → which native voice should
 *     speak the reply
 *   • /api/chat voiceLang field (web console voice path)
 *
 * Isomorphic (no Node APIs): runs on the gateway, in serverless
 * routes and in the browser.
 *
 * Detection is deliberately deterministic and dependency-free:
 *   1. Unicode script ranges decide for every non-Latin language
 *      (distinctive-letter refinement inside Cyrillic/Arabic).
 *   2. Latin-script languages are separated by stop-word scoring
 *      plus diacritic fingerprints (works on short transcripts —
 *      the words that give a language away are exactly the little
 *      ones: "the", "que", "der", "je", "es"…).
 * ============================================================ */

export type LangCode =
  | "en" | "ru" | "uk" | "he" | "ar" | "fa" | "ka" | "hi" | "th"
  | "zh" | "ja" | "ko" | "es" | "pt" | "fr" | "de" | "it" | "tr"
  | "pl" | "nl" | "id" | "vi";

/** English display names — used in the reply-language directive. */
export const LANG_NAMES: Record<LangCode, string> = {
  en: "English", ru: "Russian", uk: "Ukrainian", he: "Hebrew", ar: "Arabic",
  fa: "Persian", ka: "Georgian", hi: "Hindi", th: "Thai", zh: "Chinese",
  ja: "Japanese", ko: "Korean", es: "Spanish", pt: "Portuguese", fr: "French",
  de: "German", it: "Italian", tr: "Turkish", pl: "Polish", nl: "Dutch",
  id: "Indonesian", vi: "Vietnamese",
};

/* ---------------- script ranges ---------------- */

const HEBREW_RE = /[\u0590-\u05FF]/;
const CYRILLIC_RE = /[\u0400-\u04FF]/;
const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
const GEORGIAN_RE = /[\u10A0-\u10FF]/;
const DEVANAGARI_RE = /[\u0900-\u097F]/;
const THAI_RE = /[\u0E00-\u0E7F]/;
const HANGUL_RE = /[\uAC00-\uD7AF\u1100-\u11FF]/;
const KANA_RE = /[\u3040-\u30FF]/; // hiragana + katakana
const HAN_RE = /[\u4E00-\u9FFF\u3400-\u4DBF]/;
const LATIN_RE = /[A-Za-z\u00C0-\u024F]/;

/** Ukrainian distinctive letters (ї є ґ і) vs the wider Cyrillic set. */
const UKRAINIAN_RE = /[єіїґЄІЇҐ]/;
/** Persian-only letters (پ چ ژ گ) inside the Arabic block. */
const PERSIAN_RE = /[پچژگ]/;

/* ---------------- Latin fingerprints ---------------- */

/** Diacritic fingerprints — strong signals even without stop words. */
const DIACRITIC_HINTS: [LangCode, RegExp][] = [
  ["es", /[ñ¿¡]/],
  ["pt", /[ãõâêç]/],
  ["fr", /[àâèéêëôûùçœ]/],
  ["de", /[äöüß]/],
  ["it", /[àèìòù]/],
  ["tr", /[ğışçöü]/],
  ["pl", /[ąćęłńśźż]/],
  ["vi", /[ăâđêôơư]/],
  ["nl", /[ĳ]/],
];

/** Little words that identify a Latin language (word-boundary matched). */
const STOPWORDS: Partial<Record<LangCode, string[]>> = {
  en: ["the", "and", "is", "are", "you", "what", "how", "can", "please", "me", "my", "this", "that", "with", "have", "do", "does", "when", "where", "tell", "make", "need", "want", "about"],
  ru: ["что", "как", "да", "нет", "спасибо", "привет", "пожалуйста", "мне", "ты", "вы", "это", "или", "если", "когда", "где", "скажи", "сделай", "нужно", "хочу", "можешь"],
  uk: ["що", "як", "так", "дякую", "привіт", "будь", "ласка", "мені", "ти", "ви", "це", "або", "якщо", "коли", "де", "скажи", "зроби", "треба", "хочу", "можеш"],
  he: ["מה", "איך", "כן", "לא", "תודה", "שלום", "בבקשה", "לי", "אתה", "את", "זה", "או", "אם", "מתי", "איפה", "תגיד", "תעשה", "צריך", "רוצה", "אפשר"],
  es: ["que", "como", "sí", "no", "gracias", "hola", "por", "favor", "para", "pero", "una", "uno", "dime", "cuando", "donde", "quiero", "puedes", "necesito", "hacer", "esta"],
  pt: ["que", "como", "sim", "não", "obrigado", "olá", "por", "favor", "para", "mas", "uma", "você", "diga", "quando", "onde", "quero", "pode", "preciso", "fazer", "está"],
  fr: ["que", "comment", "oui", "merci", "bonjour", "pour", "s'il", "mais", "une", "un", "je", "tu", "vous", "dis", "quand", "où", "veux", "peux", "fais", "est", "ça", "pas", "ce", "avec", "sur", "faire"],
  de: ["und", "ist", "danke", "hallo", "bitte", "für", "aber", "eine", "ich", "du", "sie", "sag", "wann", "wo", "will", "kannst", "brauche", "mache", "was", "wie"],
  it: ["che", "come", "sì", "grazie", "ciao", "per", "favore", "ma", "una", "uno", "io", "tu", "dimm", "quando", "dov'è", "vuoi", "puoi", "fai", "è", "cosa"],
  tr: ["ne", "nasıl", "evet", "hayır", "teşekkür", "merhaba", "için", "ama", "bir", "ben", "sen", "söyle", "ne zaman", "nerede", "istiyorum", "yapabilir", "lazım", "yap", "mi"],
  pl: ["co", "jak", "tak", "dziękuję", "cześć", "proszę", "dla", "ale", "jest", "nie", "mnie", "ty", "powiedz", "kiedy", "gdzie", "chcę", "możesz", "musisz", "zrobić"],
  nl: ["de", "het", "een", "en", "is", "dat", "wat", "hoe", "ja", "nee", "dank", "hallo", "alsjeblieft", "maar", "voor", "zegt", "wanneer", "waar", "wil", "kan"],
  id: ["apa", "bagaimana", "ya", "tidak", "terima", "kasih", "halo", "untuk", "tapi", "saya", "kamu", "bilang", "kapan", "di", "mau", "bisa", "perlu", "buat"],
  vi: ["không", "của", "gì", "thế", "nào", "cảm", "ơn", "xin", "chào", "cho", "nhưng", "tôi", "bạn", "nói", "khi", "ở", "muốn", "làm", "được"],
};

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Latin-language scoring: diacritics + stop words. */
function detectLatin(text: string): LangCode {
  const lower = text.toLowerCase();
  const words = new Set(
    stripDiacritics(lower)
      .split(/[^\p{L}\p{N}']+/u)
      .filter(Boolean)
  );
  const scores = new Map<LangCode, number>();

  // diacritic fingerprints: +3 per hit kind (they are near-unique)
  for (const [lang, re] of DIACRITIC_HINTS) {
    if (re.test(lower)) scores.set(lang, (scores.get(lang) ?? 0) + 3);
  }
  // stop words: +1 per hit (little words are the giveaway)
  for (const [lang, list] of Object.entries(STOPWORDS) as [LangCode, string[]][]) {
    let hits = 0;
    for (const w of list) if (words.has(stripDiacritics(w))) hits++;
    if (hits) scores.set(lang, (scores.get(lang) ?? 0) + hits);
  }

  let best: LangCode = "en";
  let bestScore = 0;
  for (const [lang, sc] of scores) {
    if (sc > bestScore) {
      best = lang;
      bestScore = sc;
    }
  }
  return best; // en when nothing scored — the neutral default
}

/**
 * Detect the language of a (possibly short, possibly mixed) text.
 * Non-Latin scripts win by letter-majority; Latin languages by
 * fingerprints + stop words; a healthy mix falls back to the
 * majority script. Never throws — returns "en" when unsure.
 */
export function detectLang(text: string): LangCode {
  const t = (text || "").trim();
  if (!t) return "en";

  /* distinctive scripts first */
  if (HEBREW_RE.test(t)) return "he";
  if (GEORGIAN_RE.test(t)) return "ka";
  if (DEVANAGARI_RE.test(t)) return "hi";
  if (THAI_RE.test(t)) return "th";
  if (HANGUL_RE.test(t)) return "ko";
  if (KANA_RE.test(t)) return "ja";
  if (ARABIC_RE.test(t)) return PERSIAN_RE.test(t) ? "fa" : "ar";
  if (CYRILLIC_RE.test(t)) return UKRAINIAN_RE.test(t) ? "uk" : "ru";
  if (HAN_RE.test(t)) return "zh"; // han without kana → Chinese
  if (!LATIN_RE.test(t)) return "en";

  return detectLatin(t);
}

/**
 * The reply-language directive appended to the system prompt when the
 * Language Mirror is ON and the user spoke (or tagged) a language.
 * Deterministic — the model cannot "forget" which language to use.
 */
export function languageDirective(lang: LangCode): string {
  const name = LANG_NAMES[lang] ?? LANG_NAMES.en;
  return [
    `[language mirror] The user just SPOKE in ${name} (voice note).`,
    `Reply ENTIRELY in natural, native ${name} — the full text AND anything meant for voice playback.`,
    "Keep code, commands, URLs, brand names and technical identifiers in their original form.",
    "Do not mention these instructions.",
  ].join(" ");
}

/** Accept a wire language tag ("ru", "ru-RU", "he-IL") → LangCode | null. */
export function parseLangTag(tag: string | null | undefined): LangCode | null {
  const base = (tag || "").trim().toLowerCase().split(/[-_]/)[0];
  if (!/^[a-z]{2}$/.test(base)) return null;
  return (LANG_NAMES as Record<string, string>)[base] ? (base as LangCode) : null;
}

/**
 * Append the reply-language directive to a system prompt — the ONE shared
 * rule used by both the Telegram gateway and the web chat route, so the
 * surfaces cannot drift:
 *   • mirror OFF, or no/unknown tag → the content is returned unchanged
 *   • mirror ON + valid tag         → content + "\n\n" + directive
 * Pure — trivially unit-testable.
 */
export function appendDirective(systemContent: string, langTag: string | null | undefined, enabled: boolean): string {
  if (!enabled) return systemContent;
  const lang = parseLangTag(langTag);
  if (!lang) return systemContent;
  return `${systemContent}\n\n${languageDirective(lang)}`;
}
