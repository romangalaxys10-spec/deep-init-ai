/* Debug probe for the voice loop — dumps console + state + DOM. */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "https://deep-init-ai.vercel.app";

const INIT_SCRIPT = `
class FakeSR {
  constructor() {
    this.continuous = false; this.interimResults = false; this.lang = "en-US";
    this.onresult = null; this.onend = null; this.onerror = null;
  }
  start() {
    window.__srStarts = (window.__srStarts || 0) + 1;
    const self = this;
    setTimeout(() => {
      try {
        self.onresult && self.onresult({
          resultIndex: 0,
          results: [ { 0: { transcript: "what is 2 plus 2" }, isFinal: true, length: 1 } ],
        });
        window.__srFired = (window.__srFired || 0) + 1;
      } catch (e) { window.__srErr = String(e); }
      setTimeout(() => { try { self.onend && self.onend(); } catch (e) {} }, 120);
    }, 450);
  }
  stop() {}
  abort() {}
}
window.SpeechRecognition = FakeSR;
window.webkitSpeechRecognition = FakeSR;
`;

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(INIT_SCRIPT);
const page = await ctx.newPage();
page.setDefaultTimeout(45000);
page.on("console", (m) => {
  const t = m.type();
  if (t === "error" || t === "warning") console.log("[console]", t, m.text().slice(0, 300));
});
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 400)));

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
await page.locator('button:has-text("Next: shape its behavior"), button:has-text("Skip — use demo brain")').first().click();
await page.waitForTimeout(800);
await page.locator('button:has-text("Research & briefings")').first().click();
await page.waitForTimeout(300);
await page.locator('button:has-text("Review & initialize")').click();
await page.waitForTimeout(1000);
await page.locator('button:has-text("sudo init --agent")').click();
await page.waitForSelector('button:has-text("cognition")', { timeout: 45000 });
await page.locator('button:has-text("console")').first().click();
await page.waitForTimeout(900);

await page.locator('button[aria-label="Toggle voice mode"]').first().click();
await page.waitForTimeout(800);
console.log("after toggle:", await page.evaluate(() => ({ srStarts: window.__srStarts })));

await page.waitForTimeout(4000);
console.log("4s later:", await page.evaluate(() => ({ srStarts: window.__srStarts, srFired: window.__srFired, srErr: window.__srErr })));
const body = await page.locator("body").innerText();
console.log("has user msg:", body.includes("what is 2 plus 2"));
console.log("has thinking bar:", body.includes("thinking…"));
console.log("body snippet:", body.slice(0, 400).replace(/\n+/g, " | "));
await browser.close();
