/* Attachment pipeline tests — run with: npx tsx scripts/test-attachments.ts
 * Long code walls must become files (Telegram sendDocument / web download),
 * with the chat keeping a short note + snippet. Short blocks stay inline.
 */
import {
  extractFileAttachments,
  extForLang,
  suggestFilename,
  markdownToTelegramHTML,
  splitTelegramHtml,
  CODE_FILE_MAX_CHARS,
  CODE_FILE_MAX_LINES,
} from "../src/lib/telegram-format";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

const longPy = Array.from({ length: 40 }, (_, i) => `line_${i} = ${i}`).join("\n");
const shortJs = "const a = 1;\nconsole.log(a);";

function makeLongJs() {
  // >1200 chars but only ~8 lines (char-threshold path)
  return Array.from(
    { length: 8 },
    (_, i) => `const value${i} = "${"x".repeat(180)}"; // padding ${i}`
  ).join("\n");
}

function main() {
  /* 1. short block stays inline */
  const r1 = extractFileAttachments(`Here is a small helper:\n\`\`\`js\n${shortJs}\n\`\`\`\ndone.`);
  check("short block: no files", r1.files.length === 0);
  check("short block: md untouched", r1.md.includes("const a = 1;"));

  /* 2. long block (line threshold) becomes a file */
  const r2 = extractFileAttachments(`Big script:\n\`\`\`python\n${longPy}\n\`\`\`\nThat's it.`);
  check("long block: one file", r2.files.length === 1, JSON.stringify(r2.files.map((f) => f.filename)));
  check("long block: .py extension", r2.files[0]?.filename.endsWith(".py"), r2.files[0]?.filename);
  check("long block: full content preserved", r2.files[0]?.content === longPy);
  check("long block: line count", r2.files[0]?.lines === 40);
  check("long block: md no longer has the wall", !r2.md.includes("line_39"));
  check("long block: note with filename", r2.md.includes("**snippet-1.py**"));
  check("long block: note mentions attachment", r2.md.includes("attached as file"));
  const snippetFences = r2.md.match(/```/g) || [];
  check("long block: snippet fence balanced", snippetFences.length % 2 === 0, r2.md);
  const snippetLines = (r2.md.match(/```python\n([\s\S]*?)```/) || [])[1]?.trim().split("\n").length ?? 0;
  check("long block: snippet is short (<= 7 lines)", snippetLines <= 7, `got ${snippetLines}`);

  /* 3. char-threshold path (few long lines) */
  const r3 = extractFileAttachments(`\`\`\`js\n${makeLongJs()}\n\`\`\``);
  check("char-threshold: extracted", r3.files.length === 1, `chars=${makeLongJs().length} vs max=${CODE_FILE_MAX_CHARS}`);
  check("char-threshold: lines under limit", (r3.files[0]?.lines ?? 0) <= CODE_FILE_MAX_LINES + 1);

  /* 4. filename suggestion */
  check("ext map: python", extForLang("python") === "py");
  check("ext map: typescript", extForLang("typescript") === "ts");
  check("ext map: unknown → txt", extForLang("raku") === "txt");
  check("name: comment wins", suggestFilename("js", "// utils/helpers.js\nexport {}", 0) === "helpers.js");
  check("name: hash comment wins", suggestFilename("bash", "# deploy.sh\nset -e", 0) === "deploy.sh");
  check("name: fallback indexed", suggestFilename("", "plain", 3) === "snippet-4.txt");

  /* 5. mixed blocks: only long ones extracted, short preserved, order kept */
  const r5 = extractFileAttachments(
    `start\n\`\`\`js\n${shortJs}\n\`\`\`\nmid\n\`\`\`python\n${longPy}\n\`\`\`\nend`
  );
  check("mixed: one file", r5.files.length === 1);
  check("mixed: short block kept", r5.md.includes("const a = 1;"));
  check("mixed: text order preserved", r5.md.indexOf("start") < r5.md.indexOf("mid") && r5.md.indexOf("mid") < r5.md.indexOf("end"));
  check("mixed: file is the python one", r5.files[0]?.filename.endsWith(".py"));

  /* 6. rewritten md survives the real Telegram formatting pipeline */
  const html = markdownToTelegramHTML(r2.md);
  const chunks = splitTelegramHtml(html);
  check("pipeline: html produced", html.includes("<pre><code") && html.includes("<b>snippet-1.py</b>"), html.slice(0, 120));
  check("pipeline: chunks within limit", chunks.every((c) => c.length <= 3900));

  /* 7. big real-world reply: 3 long blocks → 3 files */
  const big = [
    "Here is everything you asked for:",
    "```ts\n" + Array.from({ length: 60 }, (_, i) => `const t${i} = ${i};`).join("\n") + "\n```",
    "and the styles:",
    "```css\n" + Array.from({ length: 50 }, (_, i) => `.c${i} { color: red; }`).join("\n") + "\n```",
    "and a small one:",
    "```json\n{\"ok\": true}\n```",
    "```python\n" + Array.from({ length: 45 }, (_, i) => `x${i} = ${i}`).join("\n") + "\n```",
  ].join("\n");
  const r7 = extractFileAttachments(big);
  check("big reply: 3 files", r7.files.length === 3, JSON.stringify(r7.files.map((f) => f.filename)));
  check("big reply: indexed filenames unique", new Set(r7.files.map((f) => f.filename)).size === 3);
  check("big reply: small json stays inline", r7.md.includes('{"ok": true}'));
  check("big reply: no long walls remain", !r7.md.includes("const t59") && !r7.md.includes(".c49") && !r7.md.includes("x44"));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main();
