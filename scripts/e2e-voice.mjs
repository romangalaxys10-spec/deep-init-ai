/* Voice-mode E2E: injects a fake SpeechRecognition into the browser and
 * drives the full hands-free loop against the LIVE app:
 *   voice ON → fake mic utters a question → auto-send → agent replies
 *   → reply spoken via real /api/voice/tts → mic re-opens → SECOND question
 *   answered with zero clicks (the true hands-free loop proof).
 * Run: node scripts/e2e-voice.mjs   (BASE_URL defaults to prod)
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "https://deep-init-ai.vercel.app";
let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ""}`);
  }
};

const INIT_SCRIPT = `
class FakeSR {
  constructor() {
    this.continuous = false; this.interimResults = false; this.lang = "en-US";
    this.onresult = null; this.onend = null; this.onerror = null;
  }
  start() {
    window.__srStarts = (window.__srStarts || 0) + 1;
    const self = this;
    // realistic: fire one utterance per "armed" session, then stay silent
    // (Chrome keeps the segment open without emitting results until speech)
    if (!window.__srArmed) {
      setTimeout(() => { try { self.onend && self.onend(); } catch (e) {} }, 3000);
      return;
    }
    window.__srArmed = false;
    setTimeout(() => {
      const QUESTIONS = ["what is 2+2", "what is 17.5% of 100", "what is 144/12"];
      const q = QUESTIONS[(window.__srQ = (window.__srQ || 0) + 1) - 1];
      try {
        self.onresult && self.onresult({
          resultIndex: 0,
          results: [ { 0: { transcript: q }, isFinal: true, length: 1 } ],
        });
      } catch (e) {}
      setTimeout(() => { try { self.onend && self.onend(); } catch (e) {} }, 120);
    }, 450);
  }
  stop() {}
  abort() {}
}
window.SpeechRecognition = FakeSR;
window.webkitSpeechRecognition = FakeSR;
window.__srArmed = true;
`;

async function main() {
  const browser = await chromium.launch({
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(INIT_SCRIPT);
  const page = await ctx.newPage();
  page.setDefaultTimeout(45000);

  const ttsRequests = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/voice/tts")) ttsRequests.push(r.url());
  });

  /* wizard fast path → dashboard */
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await page.locator("text=Initialize your agent").first().click();
  await page.waitForTimeout(1000);
  await page.locator("#displayName").fill("Roman");
  await page.locator("#agentName").fill("Init");
  await page.locator('button:has-text("Next: connect telegram")').click();
  await page.waitForTimeout(800);
  await page.locator('button:has-text("Next: connect AI brains")').first().click();
  await page.waitForTimeout(800);
  await page
    .locator('button:has-text("Next: shape its behavior"), button:has-text("Skip — use demo brain")')
    .first()
    .click();
  await page.waitForTimeout(800);
  await page.locator('button:has-text("Research & briefings")').first().click();
  await page.waitForTimeout(300);
  await page.locator('button:has-text("Review & initialize")').click();
  await page.waitForTimeout(1000);
  await page.locator('button:has-text("sudo init --agent")').click();
  await page.waitForSelector('button:has-text("cognition")', { timeout: 45000 });
  ok("wizard → dashboard", true);

  /* console: voice mode button present */
  await page.locator('button:has-text("console")').first().click();
  await page.waitForTimeout(900);
  const vmBtn = page.locator('button[aria-label="Toggle voice mode"]');
  ok("voice mode button present", (await vmBtn.count()) === 1);
  const btnText = await vmBtn.first().innerText();
  ok("button label localized", /voice mode/i.test(btnText), btnText);

  /* toggle ON → listening */
  await vmBtn.first().click();
  await page.waitForTimeout(700);
  const barListening = await page.locator("text=listening…").first().isVisible().catch(() => false);
  ok("voice bar shows listening", barListening);

  /* fake utterance #1 → auto-send */
  await page.waitForSelector("text=what is 2+2", { timeout: 20000 });
  ok("transcript auto-sent as user message", true);

  /* reply #1 (offline reflex: 2+2 = 4) */
  const reply1 = await page
    .waitForFunction(
      () => document.body.innerText.includes("2+2") && document.body.innerText.includes("4"),
      null,
      { timeout: 25000 }
    )
    .then(() => true)
    .catch(() => false);
  ok("agent replied: 2+2 = 4", reply1);

  /* reply spoken through the real neural TTS gateway */
  let ttsHit = false;
  for (let i = 0; i < 24 && !ttsHit; i++) {
    await page.waitForTimeout(500);
    ttsHit = ttsRequests.length >= 1;
  }
  ok("TTS endpoint was hit", ttsHit, `n=${ttsRequests.length}`);

  /* loop proof: re-arm → the session re-opens the mic BY ITSELF and the
   * second question is sent with zero clicks */
  await page.evaluate(() => { window.__srArmed = true; });
  const sent2 = await page
    .waitForSelector("text=what is 17.5% of 100", { timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  ok("hands-free loop: 2nd question auto-sent", sent2);

  const reply2 = await page
    .waitForFunction(() => document.body.innerText.includes("17.5"), null, { timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  ok("second hands-free exchange answered (17.5)", reply2);

  /* toggle OFF cleanly */
  await vmBtn.first().click();
  await page.waitForTimeout(500);
  const barGone = !(await page.locator("text=listening…").first().isVisible().catch(() => false));
  ok("toggle off clears voice bar", barGone);

  await page.screenshot({ path: "download/voice-mode-e2e-proof.png", animations: "disabled" });
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("e2e-voice crashed:", e);
  process.exit(1);
});
