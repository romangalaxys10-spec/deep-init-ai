/* Render the README hero banner: docs/banner.png (1600x400 @2x → optimized). */
import { chromium } from "playwright";

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:1600px; height:400px; overflow:hidden; position:relative;
         font-family:'DejaVu Sans',ui-sans-serif,system-ui,sans-serif; }
  .bg { position:absolute; inset:0;
        background:
          radial-gradient(circle at 88% 18%, rgba(240,90,41,.10), transparent 42%),
          radial-gradient(circle at 8% 90%, rgba(240,90,41,.07), transparent 40%),
          radial-gradient(rgba(30,26,22,.10) 1.1px, transparent 1.1px),
          linear-gradient(135deg,#FCF8F1 0%,#FAF4EA 55%,#FDF9F3 100%);
        background-size:auto,auto,26px 26px,auto; }
  .wrap { position:absolute; inset:0; display:flex; align-items:center;
          justify-content:space-between; padding:0 72px; }
  .left { max-width:900px; }
  .kicker { font-family:'DejaVu Sans Mono',monospace; font-size:15px; letter-spacing:.42em;
            color:#F0592A; font-weight:700; margin-bottom:18px; }
  h1 { font-size:64px; line-height:1.06; color:#1E1A16; font-weight:800; letter-spacing:-1.5px; }
  h1 .orange { color:#F0592A; }
  .sub { margin-top:20px; font-family:'DejaVu Sans Mono',monospace; font-size:17px; color:#6B6257; }
  .sub b { color:#1E1A16; }
  .prompt { margin-top:26px; display:inline-flex; align-items:center; gap:12px;
            background:#1E1A16; border-radius:14px; padding:14px 22px;
            font-family:'DejaVu Sans Mono',monospace; font-size:18px; color:#F5EFE6; }
  .ps { color:#7EC46B; }
  .cursor { display:inline-block; width:10px; height:22px; background:#F0592A; border-radius:2px; }
  .card { width:440px; background:#FFFFFF; border:1px solid rgba(30,26,22,.10);
          border-radius:18px; box-shadow:0 24px 60px rgba(30,26,22,.12), 0 2px 8px rgba(30,26,22,.06);
          overflow:hidden; }
  .bar { display:flex; gap:8px; padding:14px 18px; border-bottom:1px solid rgba(30,26,22,.08); }
  .dot { width:11px; height:11px; border-radius:50%; }
  .bar-title { margin-left:8px; font-family:'DejaVu Sans Mono',monospace; font-size:12px;
               letter-spacing:.22em; color:#6B6257; }
  .body { padding:18px 20px; font-family:'DejaVu Sans Mono',monospace; font-size:13.5px;
          line-height:1.9; color:#3A342C; }
  .ln b { color:#F0592A; font-weight:700; }
  .kv { display:flex; justify-content:space-between; border-top:1px solid rgba(30,26,22,.08);
        margin-top:10px; padding-top:12px; }
  .kv div span { display:block; font-size:11px; letter-spacing:.14em; color:#8A8073; }
  .kv div em { font-style:normal; font-size:13px; color:#F0592A; font-weight:700; }
</style></head>
<body>
  <div class="bg"></div>
  <div class="wrap">
    <div class="left">
      <div class="kicker">/// AUTONOMOUS PERSONAL AGENT</div>
      <h1>Your computer just<br/>hired a <span class="orange">full-time agent.</span></h1>
      <div class="sub"><b>deep-init_</b> · Telegram-native · 24×7 loop · BYOK brains · self-skilling</div>
      <div class="prompt"><span class="ps">$</span> sudo init --agent <span class="cursor"></span></div>
    </div>
    <div class="card">
      <div class="bar">
        <span class="dot" style="background:#F0592A"></span>
        <span class="dot" style="background:#F2B33D"></span>
        <span class="dot" style="background:#57B87B"></span>
        <span class="bar-title">BOOT SEQUENCE</span>
      </div>
      <div class="body">
        <div class="ln"><b>&gt;</b> deep-init v1.0.0 — agent kernel loading…</div>
        <div class="ln"><b>&gt;</b> mounting capabilities: web, fs, code, vision</div>
        <div class="ln"><b>&gt;</b> scanning MCP registry ······ 42 servers found</div>
        <div class="ln"><b>&gt;</b> linking messengers: telegram ✓ own-bot ✓</div>
        <div class="ln"><b>&gt;</b> provider fallback: primary → backup → demo</div>
        <div class="kv">
          <div><span>KERNEL</span><em>active</em></div>
          <div><span>FALLBACK</span><em>armed</em></div>
          <div><span>MEMORY</span><em>persistent</em></div>
        </div>
      </div>
    </div>
  </div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 400 }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: "networkidle" });
await page.waitForTimeout(300);
await page.screenshot({ path: "docs/banner.png" });
await browser.close();
console.log("banner rendered");
