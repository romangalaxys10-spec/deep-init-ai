import { existsSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * Serverless-safe accessor for z-ai-web-dev-sdk.
 *
 * The SDK discovers its `.z-ai-config` by scanning `process.cwd()`,
 * `$HOME` and `/etc` — none of which exist (or are writable) on Vercel
 * lambdas, so every demo-brain call fails with "Configuration file not
 * found". Smart workaround: when ZAI_API_KEY / ZAI_BASE_URL env vars are
 * present, materialize the config into the writable `/tmp` dir and point
 * `$HOME` there before the first `create()`. Locally (no env vars) the
 * SDK's normal file discovery keeps working untouched.
 */
export async function getZAI() {
  const apiKey = process.env.ZAI_API_KEY || "";
  const baseUrl = process.env.ZAI_BASE_URL || "";
  if (apiKey && baseUrl) {
    try {
      const dir = "/tmp";
      process.env.HOME = dir; // os.homedir() reads $HOME → SDK scans /tmp/.z-ai-config
      const p = join(dir, ".z-ai-config");
      if (!existsSync(p)) {
        writeFileSync(
          p,
          JSON.stringify({ baseUrl, apiKey, chatId: "", userId: "", token: "" })
        );
      }
    } catch {
      /* read-only fs or blocked write — fall through to SDK default discovery */
    }
  }
  const ZAI = (await import("z-ai-web-dev-sdk")).default;
  return ZAI.create();
}
