/* Find which element forces the document to be ~1134px wide on mobile. */
import { chromium } from "playwright";
const SEED = { state: { view: "dashboard", agentActive: true, profile: { displayName: "roman", agentName: "Init", timezone: "UTC", portalUser: "roman", portalToken: "di_seed0000000000000000" } }, version: 0 };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 1400 } });
const page = await ctx.newPage();
await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
await page.evaluate((s) => localStorage.setItem("deep-init-state-v1", JSON.stringify(s)), SEED);
await page.evaluate(() => sessionStorage.setItem("di-portal-auth", "1"));
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(800);
const wide = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll("*").forEach((el) => {
    const w = el.scrollWidth;
    if (w > 500 && el.clientWidth < w) {
      out.push({ tag: el.tagName, cls: String(el.className).slice(0, 80), sw: el.scrollWidth, cw: el.clientWidth, text: (el.textContent || "").slice(0, 60).replace(/\s+/g, " ") });
    }
  });
  return out.slice(0, 20);
});
console.log(JSON.stringify(wide, null, 1));
await browser.close();
