/* Capture beautiful README screenshots from the LIVE production app.
 *   BASE_URL=https://deep-init-ai.vercel.app node scripts/readme-screens.mjs
 * Output: docs/screenshots/*.png  (1440x900 @2x, animations disabled)
 */
import { chromium } from "playwright";
import { mkdirSync } from "fs";

const BASE = process.env.BASE_URL || "https://deep-init-ai.vercel.app";
const OUT = "docs/screenshots";
mkdirSync(OUT, { recursive: true });

const shot = async (page, name, opts = {}) => {
  await maskSecrets(page);
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled", ...opts });
};

/** Replace live credentials with masked glyphs so screenshots are safe for a public README. */
async function maskSecrets(page) {
  try {
    await page.evaluate(() => {
      const walk = (el) => {
        for (const node of el.childNodes) {
          if (node.nodeType === Node.TEXT_NODE) {
            const t = node.textContent || "";
            let out = t.replace(/di_[a-zA-Z0-9]{6,}/g, "di_••••••••••••••••");
            out = out.replace(/DIP-[A-Z0-9]{4,5}-[A-Z0-9]{4,5}/g, "DIP-••••-••••");
            if (out !== t) node.textContent = out;
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            const tag = node.tagName;
            if (tag !== "SCRIPT" && tag !== "STYLE") walk(node);
          }
        }
      };
      walk(document.body);
    });
  } catch {
    /* masking is best-effort */
  }
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(45000);

  /* ---------- 01 landing hero ---------- */
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await shot(page, "01-landing");
  console.log("shot 01-landing");
  await shot(page, "01b-landing-full", { fullPage: true });
  console.log("shot 01b-landing-full");

  /* ---------- wizard ---------- */
  await page.locator("text=Initialize your agent").first().click();
  await page.waitForTimeout(1600);
  await page.locator("#displayName").fill("Roman");
  await page.locator("#agentName").fill("Init");
  await page.waitForTimeout(400);
  await shot(page, "02-wizard-identity");
  console.log("shot 02-wizard-identity");

  await page.locator('button:has-text("Next: connect telegram")').click();
  await page.waitForTimeout(1400);
  await shot(page, "03-wizard-telegram");
  console.log("shot 03-wizard-telegram");

  await page.locator('button:has-text("Next: connect AI brains")').first().click();
  await page.waitForTimeout(1400);
  await shot(page, "04-wizard-brains");
  console.log("shot 04-wizard-brains");

  const provNext = page
    .locator('button:has-text("Next: shape its behavior"), button:has-text("Skip — use demo brain")')
    .first();
  await provNext.click();
  await page.waitForTimeout(1400);
  await page.locator('button:has-text("Research & briefings")').first().click();
  await page.waitForTimeout(500);
  await shot(page, "05-wizard-directives");
  console.log("shot 05-wizard-directives");

  await page.locator('button:has-text("Review & initialize")').click();
  await page.waitForTimeout(1600);
  await shot(page, "06-wizard-credentials");
  console.log("shot 06-wizard-credentials");

  /* ---------- initialize → dashboard ---------- */
  await page.locator('button:has-text("sudo init --agent")').click();
  await page.waitForSelector('button:has-text("cognition")', { timeout: 45000 });
  await page.waitForTimeout(2500);
  await shot(page, "07-dashboard-overview");
  console.log("shot 07-dashboard-overview");

  /* ---------- cognition: toggle hermes ON ---------- */
  await page.locator('button:has-text("cognition")').first().click();
  await page.waitForTimeout(1200);
  const switches = page.locator('[role="switch"]');
  if ((await switches.count()) > 0) {
    await switches.nth(0).click();
    await page.waitForTimeout(1500);
  }
  await shot(page, "08-cognition-hermes");
  console.log("shot 08-cognition-hermes");

  /* ---------- console: brain starters + chat round-trip ---------- */
  await page.locator('button:has-text("console")').first().click();
  await page.waitForTimeout(1200);
  await shot(page, "09-console");
  console.log("shot 09-console");
  try {
    const input = page.locator('textarea, input[placeholder*="message" i]').last();
    await input.fill("Give me a 2-line briefing about Mars exploration, then show a tiny js snippet.");
    await input.press("Enter");
    await page.waitForTimeout(16000);
    await shot(page, "10-console-chat");
    console.log("shot 10-console-chat");
  } catch (e) {
    console.log("chat shot skipped:", e.message);
  }

  /* ---------- channels ---------- */
  try {
    await page.locator('button:has-text("channels")').first().click();
    await page.waitForTimeout(1500);
    await shot(page, "11-channels");
    console.log("shot 11-channels");
  } catch (e) {
    console.log("channels shot skipped:", e.message);
  }

  /* ---------- hebrew RTL proof ---------- */
  try {
    const langBtn = page.locator('button:has-text("HE"), button:has-text("עברית")').first();
    if (await langBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await langBtn.click();
      await page.waitForTimeout(1200);
      await shot(page, "12-hebrew-rtl");
      console.log("shot 12-hebrew-rtl");
    }
  } catch (e) {
    console.log("hebrew shot skipped:", e.message);
  }

  await browser.close();
  console.log("DONE");
}

main().catch((e) => {
  console.error("screens crashed:", e);
  process.exit(1);
});
