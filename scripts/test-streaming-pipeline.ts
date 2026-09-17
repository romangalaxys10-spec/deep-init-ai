/* Test runAgentChainStreaming + the telegram finalize path (no real Telegram send). */
import { runAgentChainStreaming } from "../src/lib/brain";
import { markdownToTelegramHTML, splitTelegramHtml, plainPreview } from "../src/lib/telegram-format";

async function main() {
  let deltas = 0;
  let lastLen = 0;
  let grew = true;
  const started = Date.now();

  const result = await runAgentChainStreaming({
    providers: [],
    allowDemoBrain: true,
    messages: [
      { role: "user", content: "Reply with three detailed paragraphs (at least 400 words total) explaining what a personal AI agent is, and include a ```js fenced code block with console.log('hi')." },
    ],
    onEvent: (ev) => {
      if (ev.type === "delta") {
        deltas++;
        if (ev.text.length < lastLen) grew = false; // accumulated text must never shrink
        lastLen = ev.text.length;
      }
    },
  });

  console.log(`stream: ok=${result.ok} via=${result.via} deltas=${deltas} len=${lastLen} monotonic=${grew} ${Date.now() - started}ms`);
  if (!result.ok || deltas < 2 || !grew) {
    console.error("FAIL: expected ok + >=2 monotonic deltas");
    process.exit(1);
  }

  const content = result.content || "";
  const html = markdownToTelegramHTML(content);
  const chunks = splitTelegramHtml(html);
  console.log(`finalize: html=${html.length}B chunks=${chunks.length} max=${Math.max(...chunks.map((c) => c.length))}B`);
  if (chunks.some((c) => c.length > 3900)) {
    console.error("FAIL: chunk over limit");
    process.exit(1);
  }
  const preview = plainPreview(content);
  console.log(`preview: ${preview.slice(0, 60).replace(/\n/g, " ")}…`);
  console.log("PASS");
}

main().catch((e) => {
  console.error("ERROR", e);
  process.exit(1);
});
