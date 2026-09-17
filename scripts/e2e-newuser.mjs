/* Portal login "new user / token" E2E — drives the lock screen modes:
 *   1. seeded locked dashboard → login screen (returning mode default)
 *   2. switch to "New user / token" tab → pick username → generate
 *   3. credentials minted (rotation: old token dead, new token in store)
 *   4. Enter console → dashboard
 *   5. Lock → sign in with OLD token fails → with NEW token works
 *   6. invalid username (2 chars) rejected; Hebrew tab translated + RTL
 * Run: node scripts/e2e-newuser.mjs   (BASE_URL defaults to dev :3000)
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:3000";
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

const OLD_TOKEN = "di_old000000000000000000aa";
const SEED = {
  state: {
    view: "dashboard",
    agentActive: true,
    profile: {
      displayName: "roman",
      agentName: "Init",
      timezone: "UTC",
      portalUser: "roman",
      portalToken: OLD_TOKEN,
    },
  },
  version: 0,
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

// seed a locked dashboard state, then load
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.evaluate((seed) => localStorage.setItem("deep-init-state-v1", JSON.stringify(seed)), SEED);
await page.reload({ waitUntil: "networkidle" });

// ── 1. lock screen in returning mode ─────────────────────────────────────
await page.waitForSelector("text=Welcome back — sign in to the console", { timeout: 15000 });
ok("lock screen renders in returning mode", true);

const tabReturn = page.getByRole("tab", { name: /returning user/i });
const tabNew = page.getByRole("tab", { name: /new user \/ token/i });
ok("mode selector shows both options", (await tabReturn.count()) === 1 && (await tabNew.count()) === 1);
ok("returning tab selected by default", (await tabReturn.getAttribute("aria-selected")) === "true");

// ── 2. switch to new-user mode ───────────────────────────────────────────
await tabNew.click();
await page.waitForSelector("text=New here — generate a user & token", { timeout: 5000 });
ok("new-mode title swaps in", true);
ok("new tab marked selected", (await tabNew.getAttribute("aria-selected")) === "true");

const userInput = page.locator("#new-portal-user");
const prefill = await userInput.inputValue();
ok("username prefilled with suggested slug", prefill === "roman", `got "${prefill}"`);

// ── 3. invalid username rejected ─────────────────────────────────────────
await userInput.fill("ab");
await page.getByRole("button", { name: /generate user & token/i }).click();
await page.waitForSelector("text=3–24 characters", { timeout: 5000 });
ok("2-char username rejected with validation hint", true);

// ── 4. generate new credentials ──────────────────────────────────────────
await userInput.fill("roman2");
await page.getByRole("button", { name: /generate user & token/i }).click();
await page.waitForSelector("text=credentials ready — save them now", { timeout: 5000 });
ok("credentials-ready panel appears", true);

const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("deep-init-state-v1") || "{}")?.state?.profile);
ok("store rotated username to roman2", stored?.portalUser === "roman2", `got ${stored?.portalUser}`);
ok("store rotated token (old dead)", stored?.portalToken && stored.portalToken !== OLD_TOKEN && stored.portalToken.startsWith("di_"), `got ${stored?.portalToken?.slice(0, 6)}…`);

const copyFields = await page.locator("button:has-text('copy'), [class*=copy]").count();
ok("copy fields rendered for the new pair", copyFields >= 2 || (await page.locator("text=di_").count()) >= 1);

// ── 5. Enter console → dashboard ─────────────────────────────────────────
await page.getByRole("button", { name: /enter console/i }).click();
await page.waitForSelector("text=overview", { timeout: 15000 });
ok("Enter console opens the dashboard", true);
const sessionAuth = await page.evaluate(() => sessionStorage.getItem("di-portal-auth"));
ok("session auth flag set", sessionAuth === "1");

// ── 6. Lock → old token fails, new token works ───────────────────────────
await page.locator("button[aria-label='Log out of the portal']").click();
await page.waitForSelector("text=Welcome back — sign in to the console", { timeout: 10000 });
ok("Lock returns to the login screen", true);

await page.locator("#portal-user").fill("roman2");
await page.locator("#portal-token").fill(OLD_TOKEN);
await page.getByRole("button", { name: /unlock console/i }).click();
await page.waitForSelector("text=must match", { timeout: 10000 });
ok("OLD token rejected after rotation", true);

await page.locator("#portal-token").fill(stored.portalToken);
await page.getByRole("button", { name: /unlock console/i }).click();
await page.waitForSelector("text=overview", { timeout: 15000 });
ok("NEW username+token unlock the console", true);

// ── 7. Hebrew: translated tab + RTL ──────────────────────────────────────
await page.locator("button[aria-label='Log out of the portal']").click();
await page.waitForSelector("text=Welcome back — sign in to the console", { timeout: 10000 });
await page.getByRole("button", { name: /עברית/ }).click();
await page.waitForTimeout(400);
const heTab = page.getByRole("tab", { name: /משתמש חדש/ });
ok("Hebrew tab label rendered", (await heTab.count()) === 1);
await heTab.click();
await page.waitForSelector("text=צרו משתמש וטוקן", { timeout: 5000 });
const dir = await page.evaluate(() => document.documentElement.dir);
ok("Hebrew mode flips document to RTL", dir === "rtl", `dir=${dir}`);

// screenshot proof (returning to EN for a clean shot)
await page.getByRole("button", { name: /English/ }).click();
await page.waitForTimeout(300);
await page.getByRole("tab", { name: /new user \/ token/i }).click();
await page.locator("#new-portal-user").fill("roman2");
await page.getByRole("button", { name: /generate user & token/i }).click();
await page.waitForSelector("text=credentials ready — save them now", { timeout: 5000 });
await page.screenshot({ path: "download/newuser-mode-proof.png", fullPage: true });
console.log("  📸 download/newuser-mode-proof.png");

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
