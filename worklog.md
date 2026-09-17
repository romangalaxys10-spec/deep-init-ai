# Deep-init AI — Worklog

---
Task ID: 1
Agent: main (Super Z)
Task: Build and deploy "Deep-init AI" — a 24/7 personal autonomous assistant platform (Hermes/OpenClaw/Instinct-style) with WhatsApp/Telegram pairing, multi-provider AI fallback, onboarding wizard, then (round 2) natural voice, Virtual Instance SSH pairing, a pair-tunnel plugin, and zcode-smart-skill integration.

Work Log:
- Initialized fullstack scaffold (Next.js 16 + React 19 + Tailwind 4 + shadcn/ui + zustand).
- Architecture decision: client-side persistence via zustand/localStorage (Vercel-serverless-safe, BYOK product design); all API routes stateless.
- Dark terminal theme (globals.css): emerald-on-black oklch palette, grid bg, scanline/glow/blink effects, Geist mono accents.
- Store (src/lib/store.ts): profile, channels, providers (priority = fallback order), tools, questionnaire, messages, activity, instances, tunnels, voice, skills; buildSystemPrompt() composes persona/autonomy/schedule/instances/skills/GVS5H build protocol.
- API routes:
  - /api/chat — multi-provider fallback engine: OpenAI-compatible + Anthropic-native shapes, 45s timeouts per brain, returns fallbackChain; optional demo brain via z-ai-web-dev-sdk.
  - /api/pair/telegram — REAL bot token verification against api.telegram.org/getMe (verified live: fake token → "Unauthorized" surfaced in UI).
  - /api/pair/whatsapp — pairing code gateway flow (DI-XXXX-XXXX codes).
  - /api/tools/test — server-side endpoint probe (CORS-free, latency).
  - /api/voice/tts — Microsoft Edge neural TTS via msedge-tts (real MP3, 24kHz); verified 200/28.8KB sandbox + 19.4KB on Vercel.
  - /api/instances/test|exec — REAL SSH via ssh2 (uname/whoami/uptime probe + arbitrary exec, password or PEM key).
  - /api/tunnel/register|checkin|command|result|status|history|script — pair-tunnel relay: in-memory queue (src/lib/relay.ts), generated bash + PowerShell agent scripts embedding machine token.
- UI components (src/components/deepinit/): landing (boot-log hero, capability matrix, 4-step how-it-works), wizard (5 steps: identity → messengers → providers+fallback chain → questionnaire → review), boot sequence, dashboard (overview/live loop/skill registry, console, channels, brains, tools·mcp, instances, activity), agent console (provider fallback + per-message "speak" + mic dictation + voice personas), instances panel (SSH CRUD/test/exec terminal + tunnel pairing + script dialog).
- zcode-smart-skill (github.com/romangalaxys10-spec/zcode-smart-skill): cloned, distilled GVS5H v2 protocol into system prompt + skill registry entry.
- Fixed during verification: JSX `///` labels → braced strings; setState-in-effect lint (useSyncExternalStore mount guard, tick-based BootLog); msedge-tts named export; ssh2/msedge-tts serverExternalPackages for Vercel bundling.
- Vercel deploy: linked project "deep-init-ai", token auth OK, first build failed on ssh2 bundling → fixed via next.config serverExternalPackages → deployed.
- Production verified: site 200 + renders; wizard flow works live (WhatsApp code DI-GGTB-BUL8 generated); /api/voice/tts returns MP3 on prod; tunnel register OK on prod.
- Sandbox proof of tunnel: ran generated pair script for real → machine showed ONLINE with hostname/uptime/sysinfo → queued `echo/ls/whoami` → machine executed → results returned through /api/tunnel/result.

Stage Summary:
- Live URL: https://deep-init-ai.vercel.app
- Tech: Next.js 16 App Router, TypeScript, Tailwind 4, shadcn/ui, zustand+persist, msedge-tts, ssh2, z-ai-web-dev-sdk (demo brain), in-memory tunnel relay.
- Verified features: provider fallback chain (real OpenAI 403 surfaced), real Telegram bot verify, edge-tts voice MP3s, SSH probe/exec error paths, full tunnel pair→command→result loop, wizard E2E (sandbox + prod), dashboard tabs E2E.
- Constraints/notes: tunnel relay is per-node memory (swap relay.ts for Redis/Postgres in prod); demo brain only active where .z-ai-config exists (sandbox), Vercel users use their own providers; SSH/tunnel credentials stay in the browser, commands execute on user machines by design.
- Artifacts: screenshots at /home/z/my-project/download/deep-init-dashboard.png, deep-init-console.png.
