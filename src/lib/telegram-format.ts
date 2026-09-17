/* ============================================================
 * Telegram outbound formatting — Hermes/OpenClaw grade.
 *
 * 1. markdown-ish replies → Telegram HTML (parse_mode:"HTML")
 *    • fenced ```code``` → <pre><code class="language-x">
 *    • inline `code` → <code>
 *    • **bold** → <b>, *italic* → <i>, [text](url) → <a>
 * 2. fence-aware chunking at the 4096 hard limit — code blocks are
 *    never silently mangled when a message is split (the classic
 *    "formatting lost on chunked messages" bug is fixed here).
 * ============================================================ */

export const TG_HARD_LIMIT = 4096;
/** safety margin under the hard limit (markdown entities expand a little) */
export const TG_CHUNK_LIMIT = 3900;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatInline(text: string): string {
  // escape first, then lay markdown tokens over the escaped string
  let s = escapeHtml(text);
  // links before bold, so brackets survive
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  // inline code
  s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  // bold
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
  // italic — single asterisks at word boundaries
  s = s.replace(/(^|[\s(>])\*([^*\n]+)\*(?=[\s).,!?:;<]|$)/g, "$1<i>$2</i>");
  return s;
}

/**
 * Convert a markdown-ish reply into Telegram-safe HTML.
 * Handles unterminated fences too (streaming cut mid-code-block).
 */
export function markdownToTelegramHTML(md: string): string {
  const parts: { code: boolean; lang: string; text: string }[] = [];
  const fenceRe = /```([A-Za-z0-9_+#.\-]*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(md))) {
    if (m.index > last) parts.push({ code: false, lang: "", text: md.slice(last, m.index) });
    parts.push({ code: true, lang: m[1] || "", text: m[2] });
    last = m.index + m[0].length;
  }
  if (last < md.length) {
    const rest = md.slice(last);
    const fenceCount = (rest.match(/```/g) || []).length;
    if (fenceCount % 2 === 1) {
      // odd number of remaining fences → the stream was cut inside code
      const idx = rest.lastIndexOf("```");
      if (idx > 0) parts.push({ code: false, lang: "", text: rest.slice(0, idx) });
      const after = rest.slice(idx + 3);
      const langMatch = /^([A-Za-z0-9_+#.\-]*)\n?/.exec(after);
      const lang = langMatch ? langMatch[1] : "";
      const code = langMatch ? after.slice(langMatch[0].length) : after;
      parts.push({ code: true, lang, text: code });
    } else {
      parts.push({ code: false, lang: "", text: rest });
    }
  }

  return parts
    .map((p) => {
      if (p.code) {
        const cls = p.lang ? ` class="language-${p.lang}"` : "";
        return `<pre><code${cls}>${escapeHtml(p.text.replace(/\n$/, ""))}</code></pre>`;
      }
      return formatInline(p.text);
    })
    .join("");
}

/** Strip tags back to plain text (used when Telegram rejects the HTML). */
export function htmlToPlain(h: string): string {
  return h
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

/* ============================================================
 * Long-code → file attachments ("no walls of code in chat").
 * Blocks over the size/line threshold are pulled out of the
 * message and delivered as real documents (Telegram sendDocument /
 * web download button); the chat keeps a short note + snippet.
 * ============================================================ */

export const CODE_FILE_MAX_CHARS = 1200;
export const CODE_FILE_MAX_LINES = 25;
export const SNIPPET_LINES = 6;

const LANG_EXT: Record<string, string> = {
  js: "js", javascript: "js", mjs: "mjs", cjs: "cjs",
  ts: "ts", typescript: "ts", tsx: "tsx", jsx: "jsx",
  py: "py", python: "py", rb: "rb", ruby: "rb", php: "php",
  html: "html", css: "css", scss: "scss", json: "json",
  yaml: "yaml", yml: "yml", toml: "toml", xml: "xml", md: "md", markdown: "md",
  sh: "sh", bash: "sh", shell: "sh", zsh: "sh", powershell: "ps1", ps1: "ps1",
  sql: "sql", go: "go", golang: "go", rust: "rs", rs: "rs",
  java: "java", kotlin: "kt", kt: "kt", swift: "swift", dart: "dart",
  c: "c", cpp: "cpp", "c++": "cpp", csharp: "cs", "cs": "cs", "c#": "cs",
  txt: "txt", text: "txt", ini: "ini", env: "env", diff: "diff", dockerfile: "Dockerfile",
};

export function extForLang(lang: string): string {
  return LANG_EXT[lang.trim().toLowerCase()] || "txt";
}

/** Pick a friendly filename: `// notes.md`-style first-line comment wins, else snippet-N.ext */
export function suggestFilename(lang: string, code: string, index: number): string {
  const first = (code.split("\n", 1)[0] || "").trim();
  const comment = /^.{0,4}(?:\/\/|#|\/\*|<!--|;)\s*([\w.\-\/]+\.[A-Za-z0-9]{1,8})\s*(?:\*\/|-->)?$/.exec(
    first
  );
  if (comment) {
    const base = comment[1].split("/").pop() || comment[1];
    if (base.length <= 64) return base;
  }
  return `snippet-${index + 1}.${extForLang(lang)}`;
}

export interface CodeFile {
  filename: string;
  lang: string;
  content: string;
  lines: number;
  bytes: number;
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * Pull oversized code blocks out of a markdown reply.
 * Returns the rewritten markdown (each block replaced by a note + short
 * snippet) plus the files to attach. Short blocks pass through untouched.
 */
export function extractFileAttachments(
  md: string,
  opts?: { maxChars?: number; maxLines?: number }
): { md: string; files: CodeFile[] } {
  const maxChars = opts?.maxChars ?? CODE_FILE_MAX_CHARS;
  const maxLines = opts?.maxLines ?? CODE_FILE_MAX_LINES;

  const files: CodeFile[] = [];
  const re = /```([A-Za-z0-9_+#.\-]*)\n?([\s\S]*?)```/g;
  const out: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) {
    out.push(md.slice(last, m.index));
    last = m.index + m[0].length;
    const lang = m[1] || "";
    const code = m[2].replace(/\n$/, "");
    const lines = code.split("\n").length;
    if (code.length <= maxChars && lines <= maxLines) {
      out.push(m[0]); // short block — keep inline
      continue;
    }
    const filename = suggestFilename(lang, code, files.length);
    files.push({ filename, lang, content: code, lines, bytes: Buffer.byteLength(code, "utf8") });
    const snippet = code.split("\n").slice(0, SNIPPET_LINES).join("\n");
    out.push(
      `📎 **${filename}** — ${lines} lines · ${kb(files[files.length - 1].bytes)} (attached as file)\n\`\`\`${lang}\n${snippet}\n…\n\`\`\``
    );
  }
  out.push(md.slice(last));
  return { md: out.join(""), files };
}

/** Raw-markdown preview used while streaming (plain text mode — never a parse error). */
export function plainPreview(md: string, max = 3600): string {
  const t = md.trim();
  return t.length <= max ? t : t.slice(0, max - 1) + "…";
}

/** Don't cut an HTML entity (&amp; &lt; &gt;) in half when slicing code. */
function safeCodeTo(inner: string, from: number, to: number): number {
  if (to >= inner.length) return to;
  const seg = inner.slice(from, to);
  const amp = seg.lastIndexOf("&");
  const semi = seg.lastIndexOf(";");
  if (amp > semi) return from + amp; // incomplete entity at the tail
  return to;
}

function splitPlainLines(text: string, limit: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (line.length > limit) {
      if (cur.trim()) out.push(cur);
      cur = "";
      for (let i = 0; i < line.length; i += limit) out.push(line.slice(i, i + limit));
      continue;
    }
    if ((cur ? cur.length + 1 : 0) + line.length > limit) {
      if (cur.trim()) out.push(cur);
      cur = line;
    } else {
      cur = cur ? cur + "\n" + line : line;
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/**
 * Split a Telegram-HTML document into chunks under `limit` without ever
 * breaking a <pre><code> block invisibly: oversized code blocks are
 * hard-split and the <pre> wrapper is re-opened on the next chunk.
 */
export function splitTelegramHtml(html: string, limit = TG_CHUNK_LIMIT): string[] {
  if (html.length <= limit) return [html];

  const segs: { pre: boolean; text: string }[] = [];
  const preRe = /<pre><code[^>]*>[\s\S]*?<\/code><\/pre>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = preRe.exec(html))) {
    if (m.index > last) segs.push({ pre: false, text: html.slice(last, m.index) });
    segs.push({ pre: true, text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < html.length) segs.push({ pre: false, text: html.slice(last) });

  const chunks: string[] = [];
  let cur = "";
  const flush = () => {
    if (cur.trim()) chunks.push(cur.trim());
    cur = "";
  };

  for (const seg of segs) {
    if (!seg.pre) {
      if (cur.length + seg.text.length <= limit) {
        cur += seg.text;
      } else {
        flush();
        chunks.push(...splitPlainLines(seg.text, limit));
      }
      continue;
    }
    // code block segment
    if (cur.length + seg.text.length <= limit) {
      cur += seg.text;
      continue;
    }
    flush();
    const openMatch = /<pre><code[^>]*>/.exec(seg.text);
    const open = openMatch ? openMatch[0] : "<pre><code>";
    const close = "</code></pre>";
    const inner = seg.text.slice(open.length, seg.text.length - close.length);
    const budget = Math.max(200, limit - open.length - close.length);
    let i = 0;
    while (i < inner.length) {
      const raw = Math.min(inner.length, i + budget);
      const to = safeCodeTo(inner, i, raw);
      chunks.push(open + inner.slice(i, to) + close);
      i = to;
    }
  }
  flush();
  return chunks.length ? chunks : [html];
}
