/* Reproduce the "messed up upper UI menu" — dashboard header at mobile widths.
 * Captures header screenshots at several viewports + measures overlaps. */
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3000";
const SEED = {
  state: {
    view: "dashboard",
    agentActive: true,
    profile: { displayName: "roman", agentName: "Init", timezone: "UTC", portalUser: "roman", portalToken: "di_seed0000000000000000" },
  },
  version: 0,
};

const browser = await chromium.launch();
const widths = [360, 412, 540, 640, 900];

for (const w of widths) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 1400 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.evaluate((s) => localStorage.setItem("deep-init-state-v1", JSON.stringify(s)), SEED);
  await page.evaluate(() => sessionStorage.setItem("di-portal-auth", "1"));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const header = page.locator("header").first();
  await header.screenshot({ path: `/tmp/header-${w}.png` });
  // measure: does the LangSwitch overlap the Logo? do pills overlap each other?
  const m = await page.evaluate(() => {
    const r = (el) => (el ? el.getBoundingClientRect() : null);
    const logo = r(document.querySelector("header span.font-bold"));
    const lang = r(document.querySelector('header [role="group"]'));
    const lock = [...document.querySelectorAll("header button")].find((b) => /lock/i.test(b.textContent || ""));
    const reset = [...document.querySelectorAll("header button")].find((b) => /reset/i.test(b.textContent || ""));
    const pills = [...(document.querySelectorAll('header [role="group"] button') || [])].map(r);
    const overlaps = (a, b) => a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    return {
      vw: window.innerWidth,
      logo: logo && { l: Math.round(logo.left), r: Math.round(logo.right) },
      lang: lang && { l: Math.round(lang.left), r: Math.round(lang.right), w: Math.round(lang.width) },
      lockVisible: !!lock && r(lock).width > 0,
      resetVisible: !!reset && r(reset).width > 0,
      lockRight: lock && Math.round(r(lock).right),
      resetRight: reset && Math.round(r(reset).right),
      logoLangOverlap: overlaps(logo, lang),
      logoLockOverlap: overlaps(logo, lock && r(lock)),
      pillOverlaps: pills.some((p, i) => i > 0 && overlaps(pills[i - 1], p)),
      pillLefts: pills.map((p) => Math.round(p.left)),
      docScrollW: document.documentElement.scrollWidth,
    };
  });
  console.log(`w=${w}:`, JSON.stringify(m));
  await ctx.close();
}
await browser.close();
console.log("done");
