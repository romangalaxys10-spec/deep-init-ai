/* Targeted re-capture of the console-chat hero shot:
 * wizard fast-path → toggle hermes → console → math exchange → screenshot. */
import { chromium } from "playwright";
import { mkdirSync } from "fs";

const BASE = process.env.BASE_URL || "https://deep-init-ai.vercel.app";
mkdirSync("docs/screenshots", { recursive: true });

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(45000);

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  await page.locator("text=Initialize your agent").first().click();
  await page.waitForTimeout(1200);
  await page.locator("#displayName").fill("Roman");
  await page.locator("#agentName").fill("Init");
  await page.locator('button:has-text("Next: connect telegram")').click();
  await page.waitForTimeout(1000);
  await page.locator('button:has-text("Next: connect AI brains")').first().click();
  await page.waitForTimeout(1000);
  await page
    .locator('button:has-text("Next: shape its behavior"), button:has-text("Skip — use demo brain")')
    .first()
    .click();
  await page.waitForTimeout(1000);
  await page.locator('button:has-text("Research & briefings")').first().click();
  await page.waitForTimeout(400);
  await page.locator('button:has-text("Review & initialize")').click();
  await page.waitForTimeout(1200);
  await page.locator('button:has-text("sudo init --agent")').click();
  await page.waitForSelector('button:has-text("cognition")', { timeout: 45000 });
  await page.waitForTimeout(2000);

  // toggle hermes ON (cognition badge in header shows active brain)
  await page.locator('button:has-text("cognition")').first().click();
  await page.waitForTimeout(1000);
  const switches = page.locator('[role="switch"]');
  if ((await switches.count()) > 0) {
    await switches.nth(0).click();
    await page.waitForTimeout(1400);
  }

  // console: ask the reflex brain a real question
  await page.locator('button:has-text("console")').first().click();
  await page.waitForTimeout(1200);
  const input = page.locator('textarea, input[placeholder*="message" i]').last();
  await input.fill("what is 17.5% of 2_384 * 12?");
  await input.press("Enter");
  await page.waitForTimeout(15000);

  await page.screenshot({
    path: "docs/screenshots/10-console-chat.png",
    animations: "disabled",
  });
  console.log("shot 10-console-chat (math exchange)");
  await browser.close();
}

main().catch((e) => {
  console.error("recapture crashed:", e);
  process.exit(1);
});
