/* Measure min-content width of each panel in the overview to find the blowout source. */
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
const res = await page.evaluate(() => {
  const out = [];
  // every element: compute min-content by measuring with width:min-content
  document.querySelectorAll("main div, main span, main p, main button").forEach((el) => {
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;visibility:hidden;width:min-content;height:auto;";
    const clone = el.cloneNode(true);
    clone.style.cssText = "width:min-content;";
    probe.appendChild(clone);
    document.body.appendChild(probe);
    const mc = clone.scrollWidth;
    probe.remove();
    if (mc > 420) out.push({ tag: el.tagName, cls: String(el.className).slice(0, 70), minContent: mc, text: (el.textContent || "").slice(0, 70).replace(/\s+/g, " ") });
  });
  out.sort((a, b) => b.minContent - a.minContent);
  return out.slice(0, 12);
});
console.log(JSON.stringify(res, null, 1));
await browser.close();
