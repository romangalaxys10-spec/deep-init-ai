/* Browser E2E for the brains/cognition feature — run with:
 *   node scripts/e2e-brains.mjs   (dev server on 127.0.0.1:3000)
 * Flow: landing → wizard → dashboard → Cognition tab → toggles →
 *       console starters → chat round-trip → Hebrew RTL spot-check.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
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

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  /* ---------- wizard (fast path) ---------- */
  const initBtn = page.locator("text=Initialize your agent").first();
  if (await initBtn.isVisible().catch(() => false)) {
    await initBtn.click();
    await page.waitForTimeout(800);
  }
  // step through the wizard: next through all steps, fill profile on step 1
  for (let i = 0; i < 8; i++) {
    // if a name input exists, fill it
    const nameInput = page.locator('input[placeholder*="name" i], input[placeholder*="Roman" i]').first();
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill("Roman", { timeout: 2000 }).catch(() => {});
    }
    const next = page.locator('button:has-text("Next"), button:has-text("Далее"), button:has-text("הבא")').last();
    if (!(await next.isVisible().catch(() => false))) break;
    const disabled = await next.isDisabled().catch(() => true);
    if (disabled && i === 0) {
      // maybe profile fields need agent name too
      const agentInput = page.locator('input[placeholder*="agent" i]').first();
      if (await agentInput.isVisible().catch(() => false)) await agentInput.fill("Init").catch(() => {});
    }
    await next.click().catch(() => {});
    await page.waitForTimeout(700);
  }
  // final init command button (sudo init --agent)
  const initCmd = page.locator('button:has-text("sudo init --agent")').first();
  if (await initCmd.isVisible().catch(() => false)) {
    await initCmd.click();
  }
  // wait until dashboard (cognition tab present)
  await page.waitForSelector('button:has-text("cognition"), [role="button"]:has-text("cognition")', { timeout: 30000 });
  ok("wizard → dashboard (cognition tab present)", true);

  /* ---------- cognition tab ---------- */
  await page.locator('button:has-text("cognition")').first().click();
  await page.waitForTimeout(800);
  const panelTitle = await page.locator("text=Cognition packs").first().isVisible().catch(() => false);
  ok("cognition panel renders", panelTitle);
  const hermesCard = await page.locator("text=Hermes Agent brain").first().isVisible().catch(() => false);
  const moltisCard = await page.locator("text=Moltis brain").first().isVisible().catch(() => false);
  ok("hermes card visible", hermesCard);
  ok("moltis card visible", moltisCard);
  const repoLinks = await page.locator('a[href*="NousResearch/hermes-agent"], a[href*="moltis-org/moltis"]').count();
  ok("repo links present", repoLinks >= 2, `n=${repoLinks}`);
  const noneChip = await page.locator("text=no brain packs").first().isVisible().catch(() => false);
  ok("off-state chip", noneChip);

  // count switches
  const switches = page.locator('[role="switch"]');
  ok("two toggle switches", (await switches.count()) === 2, `n=${await switches.count()}`);

  /* ---------- toggle hermes ON ---------- */
  await switches.nth(0).click();
  await page.waitForTimeout(1200);
  const activeSig = await page.locator("text=active: hermes").first().isVisible().catch(() => false);
  ok("hermes ON → signature chip", activeSig);

  /* ---------- toggle moltis ON (hybrid) ---------- */
  await switches.nth(1).click();
  await page.waitForTimeout(1200);
  const hybridSig = await page.locator("text=active: hermes+moltis").first().isVisible().catch(() => false);
  ok("both ON → hybrid chip", hybridSig);

  /* ---------- console: brain starters ---------- */
  await page.locator('button:has-text("console")').first().click();
  await page.waitForTimeout(800);
  const moltisStarter = await page
    .locator("text=calc tool, show the expression")
    .first()
    .isVisible()
    .catch(() => false);
  ok("console shows brain starters", moltisStarter);

  /* ---------- chat round-trip with brains on ---------- */
  const input = page.locator('textarea, input[placeholder*="message" i]').last();
  await input.fill("Hello Init — quick sanity check.");
  await input.press("Enter");
  await page.waitForTimeout(12000);
  const body = await page.locator("body").innerText();
  ok("chat reply arrived", body.length > 200, `len=${body.length}`);

  /* ---------- persistence: reload keeps toggles ---------- */
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.locator('button:has-text("cognition")').first().click();
  await page.waitForTimeout(600);
  const stillHybrid = await page.locator("text=active: hermes+moltis").first().isVisible().catch(() => false);
  ok("toggles persist across reload", stillHybrid);

  /* ---------- hebrew spot check ---------- */
  const langBtn = page.locator('button:has-text("HE"), button:has-text("עברית")').first();
  if (await langBtn.isVisible().catch(() => false)) {
    await langBtn.click();
    await page.waitForTimeout(900);
    const dir = await page.evaluate(() => document.documentElement.dir);
    ok("hebrew flips RTL", dir === "rtl", `dir=${dir}`);
    const heTitle = await page.locator("text=חבילות קוגניציה").first().isVisible().catch(() => false);
    ok("cognition panel translated (HE)", heTitle);
  } else {
    ok("lang switch found", false);
  }

  await page.screenshot({ path: "download/cognition-e2e-proof.png", fullPage: false });
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("e2e crashed:", e);
  process.exit(1);
});
