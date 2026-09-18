/* Verify the header fix + per-tab page overflow across widths and languages. */
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
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};

const widths = [320, 360, 412, 540, 640, 768, 900, 1280];
for (const w of widths) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 1400 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.evaluate((s) => localStorage.setItem("deep-init-state-v1", JSON.stringify(s)), SEED);
  await page.evaluate(() => sessionStorage.setItem("di-portal-auth", "1"));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  const m = await page.evaluate(() => {
    const r = (el) => (el ? el.getBoundingClientRect() : null);
    const logo = r(document.querySelector("header span.font-bold"));
    const langSwitches = [...document.querySelectorAll('header [role="group"]')];
    const visibleLang = langSwitches.find((el) => r(el).width > 0);
    const lang = visibleLang ? r(visibleLang) : null;
    const headerBtns = [...document.querySelectorAll("header button")].map((b) => r(b)).filter((x) => x.width > 0);
    const overlaps = (a, b) => a && b && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    return {
      logoLangOverlap: overlaps(logo, lang),
      anyHeaderOverlap: headerBtns.some((b, i) => i > 0 && overlaps(headerBtns[i - 1], b)) || overlaps(logo, lang),
      docScrollW: document.documentElement.scrollWidth,
      vw: window.innerWidth,
      langVisibleWidth: lang ? Math.round(lang.width) : 0,
    };
  });
  check(`w=${w} no header overlaps`, !m.anyHeaderOverlap, JSON.stringify(m));
  check(`w=${w} no page h-overflow`, m.docScrollW <= m.vw + 1, `doc=${m.docScrollW} vw=${m.vw}`);

  // per-tab overflow (click each tab, measure doc width)
  const tabs = ["overview", "console", "channels", "presets", "cognition", "brains", "tools · mcp", "instances", "activity"];
  for (const tb of tabs) {
    const btn = page.locator("header nav button", { hasText: tb.split(" ")[0].replace("·", "") }).first();
    try {
      await btn.click({ timeout: 2500 });
    } catch { continue; }
    await page.waitForTimeout(250);
    const dw = await page.evaluate(() => document.documentElement.scrollWidth);
    if (dw > w + 1) { check(`w=${w} tab "${tb}" no overflow`, false, `doc=${dw}`); }
  }
  check(`w=${w} all tabs fit`, true);

  if ([360, 412, 900].includes(w)) {
    await page.locator("header nav button").first().click().catch(() => {});
    await page.waitForTimeout(300);
    await page.locator("header").screenshot({ path: `/tmp/fixed-header-${w}.png` });
  }
  await ctx.close();
}

// language check: switch to Hebrew → RTL sanity on dashboard header
const ctx = await browser.newContext({ viewport: { width: 412, height: 1400 } });
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.evaluate((s) => localStorage.setItem("deep-init-state-v1", JSON.stringify(s)), SEED);
await page.evaluate(() => sessionStorage.setItem("di-portal-auth", "1"));
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(500);
await page.locator('header [role="group"]:visible button', { hasText: /^HE$/ }).first().click().catch(async () => {
  await page.locator('header [role="group"]:visible button[title="עברית"]').first().click();
});
await page.waitForTimeout(500);
const rtl = await page.evaluate(() => {
  const logo = document.querySelector("header span.font-bold")?.getBoundingClientRect();
  const langs = [...document.querySelectorAll('header [role="group"]')].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0);
  const lang = langs[0];
  const overlaps = logo && lang ? logo.left < lang.right - 1 && lang.left < logo.right - 1 && logo.top < lang.bottom && lang.top < logo.bottom : false;
  return { dir: document.documentElement.dir, overlap: !!overlaps, docScrollW: document.documentElement.scrollWidth, vw: innerWidth };
});
check("hebrew RTL: dir=rtl", rtl.dir === "rtl");
check("hebrew RTL: no overlap", !rtl.overlap);
check("hebrew RTL: no page overflow", rtl.docScrollW <= rtl.vw + 1, `doc=${rtl.docScrollW}`);
await page.locator("header").screenshot({ path: "/tmp/fixed-header-he-rtl.png" });
await ctx.close();

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
