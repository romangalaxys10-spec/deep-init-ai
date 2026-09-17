/* One-off research reader — OpenClaw tools + Hermes telegram docs */
import ZAI from "z-ai-web-dev-sdk";

async function read(zai: Awaited<ReturnType<typeof ZAI.create>>, url: string) {
  try {
    const r = await zai.functions.invoke("page_reader", { url });
    const d = (r as { data?: { html?: string; title?: string } }).data;
    const text = (d?.html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n+/g, "\n")
      .trim();
    console.log(`\n===== ${url} (${d?.title}) =====\n${text.slice(0, 4200)}`);
  } catch (e) {
    console.log(`\n===== ${url} FAILED: ${e instanceof Error ? e.message : e}`);
  }
}

async function main() {
  const zai = await ZAI.create();
  await read(zai, "https://yu-wenhao.com/blog/openclaw-setup-guide-26-tools-53-skills-explained");
  await read(zai, "https://hermes-agent.nousresearch.com/docs/telegram");
  await read(zai, "https://docs.openclaw.ai/tools");
}
void main();
