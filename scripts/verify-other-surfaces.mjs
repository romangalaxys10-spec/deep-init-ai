import { chromium } from "playwright";
const browser = await chromium.launch();
let pass = 0, fail = 0;
const check = (n, c, e = "") => { c ? pass++ : fail++; console.log(`${c ? "  ok" : "FAIL"}  ${n}${e ? " — " + e : ""}`); };
for (const w of [320, 360, 412, 768, 1280]) {
  // landing
  let ctx = await browser.newContext({ viewport: { width: w, height: 1200 } });
  let page = await ctx.newPage();
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.removeItem("deep-init-state-v1"));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  let m = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, vw: innerWidth,
    header: document.querySelector("header")?.getBoundingClientRect() }));
  check(`landing w=${w} fits`, m.doc <= m.vw + 1, `doc=${m.doc}`);
  if (w === 360) await page.locator("header").screenshot({ path: "/tmp/landing-360.png" });
  await ctx.close();
  // portal (locked dashboard)
  ctx = await browser.newContext({ viewport: { width: w, height: 1200 } });
  page = await ctx.newPage();
  await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
  await page.evaluate((s) => localStorage.setItem("deep-init-state-v1", JSON.stringify(s)), { state: { view: "dashboard", agentActive: true, profile: { displayName: "roman", agentName: "Init", timezone: "UTC", portalUser: "roman", portalToken: "di_seed0000000000000000" } }, version: 0 });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  m = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, vw: innerWidth }));
  check(`portal w=${w} fits`, m.doc <= m.vw + 1, `doc=${m.doc}`);
  if (w === 360) await page.locator("body > div > div").first().screenshot({ path: "/tmp/portal-360.png" }).catch(() => {});
  await ctx.close();
}
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
