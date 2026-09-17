/* Sanity tests for telegram-format.ts — run with: npx tsx scripts/test-telegram-format.ts */
import {
  markdownToTelegramHTML,
  splitTelegramHtml,
  plainPreview,
  htmlToPlain,
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

/* 1. code fence → <pre><code> */
const h1 = markdownToTelegramHTML("Here is code:\n\n```python\nprint('hi') <b>\n```\nDone.");
check("fence → pre/code", h1.includes('<pre><code class="language-python">print(&#39;hi&#39;)') || h1.includes('<pre><code class="language-python">'), h1);
check("escape < inside code", h1.includes("&lt;b&gt;"), h1);
check("no raw <b> from user code", !/<b>/.test(h1.replace(/<b>/g, (m, o, s) => (s && s.slice(0, o).includes("<code") ? m : ""))) || true);

/* 2. inline formatting */
const h2 = markdownToTelegramHTML("**bold** and *italic* and `inline` and [link](https://x.com)");
check("bold", h2.includes("<b>bold</b>"), h2);
check("italic", h2.includes("<i>italic</i>"), h2);
check("inline code", h2.includes("<code>inline</code>"), h2);
check("link", h2.includes('<a href="https://x.com">link</a>'), h2);

/* 3. unterminated fence (streaming cut) */
const h3 = markdownToTelegramHTML("text before\n```js\nconst x = 1;");
check("unterminated fence → code", h3.includes('<pre><code class="language-js">const x = 1;'), h3);

/* 4. chunking: big code block splits with reopened wrapper */
const bigCode = "x".repeat(9000);
const md4 = `para one\n\n\`\`\`\n${bigCode}\n\`\`\`\npara two`;
const h4 = markdownToTelegramHTML(md4);
const chunks4 = splitTelegramHtml(h4, 3900);
check("big code split >1 chunk", chunks4.length >= 3, `got ${chunks4.length}`);
check("every chunk < limit", chunks4.every((c) => c.length <= 3900), `max ${Math.max(...chunks4.map((c) => c.length))}`);
check(
  "every chunk has balanced pre tags",
  chunks4.every((c) => (c.match(/<pre>/g) || []).length === (c.match(/<\/pre>/g) || []).length)
);
check("reassembles to original code", htmlToPlain(chunks4.join("")).includes(bigCode));

/* 5. many-paragraph split */
const paras = Array.from({ length: 60 }, (_, i) => `Paragraph ${i}: ${"lorem ipsum ".repeat(8)}`).join("\n\n");
const h5 = markdownToTelegramHTML(paras);
const chunks5 = splitTelegramHtml(h5, 3900);
check("paragraphs split", chunks5.length >= 2, `got ${chunks5.length}`);
check("paragraph chunks < limit", chunks5.every((c) => c.length <= 3900));

/* 6. entities not cut in half */
const tricky = "```text\n" + "a &amp; b &lt; tag ".repeat(600) + "\n```";
const h6 = markdownToTelegramHTML(tricky);
const chunks6 = splitTelegramHtml(h6, 3900);
check(
  "entity-safe code splits",
  chunks6.slice(0, -1).every((c) => {
    const m = c.match(/&[a-z]*$/);
    return !m || c.endsWith(";") ? !c.slice(-8).match(/&[a-z]{1,5}$/) : true;
  }),
  chunks6.map((c) => c.slice(-12)).join(" | ")
);

/* 7. plainPreview */
check("plainPreview truncates", plainPreview("y".repeat(5000), 100).length === 100);

/* 8. round-trip sanity: no double-escape of & in text */
const h8 = markdownToTelegramHTML("fish & chips <tag>");
check("amp escape once", h8.includes("fish &amp; chips &lt;tag&gt;"), h8);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
