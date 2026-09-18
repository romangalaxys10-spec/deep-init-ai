/* Leaf-level culprit finder: elements whose scrollWidth > 700 with no equally-wide child. */
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
const leaves = await page.evaluate(() => {
  const all = [...document.querySelectorAll("*")].filter((el) => el.scrollWidth > 700);
  const childWide = new Set();
  all.forEach((el) => [...el.children].forEach((c) => childWide.add(c)));
  const roots = all.filter((el) => !childWide.has(el));
  return roots.map((el) => ({
    tag: el.tagName,
    cls: String(el.className).slice(0, 90),
    sw: el.scrollWidth,
    text: (el.textContent || "").slice(0, 90).replace(/\s+/g, " "),
  }));
});
console.log(JSON.stringify(leaves, null, 1));
await browser.close();
