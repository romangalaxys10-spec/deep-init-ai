# Deep-init AI

> Your computer just hired a full-time agent. A 24×7 personal autonomous assistant you talk to on Telegram.

**Deep-init AI** is a personal autonomous agent platform: run a friendly in-browser wizard, pair a Telegram bot, connect any AI provider (with automatic multi-provider fallback), and your agent goes live — reachable from Telegram around the clock, with a full mission-control web console.

Made using **GLM 5.3 FLASH** · By **Roman** | [www.rommark.dev](https://www.rommark.dev)

---

## What it does

- **Friendly 5-step wizard** — identity → Telegram → AI brains → directives → initialize. Credentials are auto-generated along the way.
- **Telegram, actually wired** — pair the **built-in bot** (`@init_smart_bot`) with zero setup, or bring your **own @BotFather bot** (token verified live against Telegram, webhook auto-registered on public origins). Send your **Channel Pairing Token** (`DIP-XXXX-XXXX`) to the bot → it replies `Paired ✓` → from then on it answers every message through your agent's real brain chain.
- **Any AI provider + automatic fallback** — OpenAI-compatible and Anthropic-native endpoints (OpenAI, Anthropic, OpenRouter, Groq, DeepSeek, Mistral, Gemini, Ollama, anything). Chain is tried top-down; failures, timeouts and rate-limits fall through mid-task. A demo brain catches the last resort so the agent never goes mute.
- **Access whitelist** — mint per-person pairing tokens for friends/teammates and choose per user whether they **share** the agent's memory & context or get an **isolated** private thread.
- **Web portal logins** — the wizard generates a portal username + access token (`di_…`); the console is locked behind them on every visit.
- **Mission-control dashboard** — live loop feed, agent console, gateway status (bound chats, recent replies, resync, poll bridge), provider health checks, tools/MCP registry, virtual instances (SSH + pair-tunnel), full activity log.
- **Virtual instances & pair tunnel** — register SSH machines (linux/mac/VPS) and run the generated tunnel script (bash / PowerShell / WSL) so the agent can operate on your machines when its cloud env isn't enough.
- **Self-skilling** — the agent ships with `zcode-smart-skill v2` (GVS5H build protocol) armed and writes its own new skills when a task needs one.

## Architecture

```
Browser (Next.js 16, React 19, Tailwind 4, shadcn/ui, zustand+persist)
  ├─ wizard / dashboard / console — BYOK config lives in localStorage
  ├─ /api/chat              → provider fallback chain (server proxy)
  ├─ /api/pair/telegram     → token verify (getMe) + agent registration + webhook/poll decision
  ├─ /api/telegram/webhook  → Telegram push  → gateway handler
  ├─ /api/telegram/poll     → browser-driven getUpdates bridge (localhost / webhook-less)
  ├─ /api/telegram/status   → bound chats, bound tokens, recent replies
  ├─ /api/instances/*       → SSH virtual instances
  ├─ /api/tunnel/*          → pair-tunnel registration, check-in, commands, scripts
  └─ /api/voice/tts         → neural voice
```

**Gateway registry** (`src/lib/agent-registry.ts`) keeps per-agent runtime config (bot token, system prompt, provider chain, whitelist, bound chats, threads):

- **dev** — JSON file under `.gateway/` so state is shared across Next.js worker processes
- **production** — in-memory per warm instance; the dashboard auto-resyncs the config, healing cold starts. Registry TTL is 24 h of inactivity.

**Pairing flow** — `findByPairingToken` matches an incoming `DIP-…` message against owner + whitelist tokens of every agent on that bot, binds the chat (`owner` / `shared` / `isolated` mode), then serves every further message from the matched thread with a per-user context line injected into the system prompt.

## Quickstart

```bash
npm install
npm run dev        # http://localhost:3000
```

1. Click **Initialize your agent**, fill in your name + agent name.
2. Choose **Built-in bot** or paste your own @BotFather token.
3. Add AI providers (or skip — the demo brain carries it).
4. Answer the directives questions, review your **access credentials**, hit `sudo init --agent`.
5. Send your Channel Pairing Token to the bot in Telegram → start chatting.

### Environment

| Variable | Required | Purpose |
|---|---|---|
| `BUILTIN_TELEGRAM_BOT_TOKEN` | no* | Token of the shared built-in bot (`@init_smart_bot`). A default is compiled in for convenience — override with your own for any serious deployment. |
| `DATABASE_URL` | no | Scaffold default; the app is client-storage-first and doesn't need a DB. |

\* The bundled built-in token is public by design (it is the product's shared bot) — anyone can pair to it with their own unguessable `DIP-…` token. For private deployments, create your own bot and set the env var.

### Localhost vs production gateways

| Origin | Update transport | Notes |
|---|---|---|
| localhost | **poll bridge** (browser pings `/api/telegram/poll` every 4 s while the portal is open) | Telegram can't reach localhost; webhook is cleared so `getUpdates` works. Toggle "Run poll bridge" in Channels. |
| public (Vercel etc.) | **webhook** (`/api/telegram/webhook?t=…`) | Registered automatically at pair time; true 24/7 push. |

If the bot ever goes quiet after a server restart, hit **Resync gateway** in the Channels tab.

## Deploy

```bash
npm i -g vercel
vercel link
vercel env add BUILTIN_TELEGRAM_BOT_TOKEN production   # optional
vercel --prod
```

## Security notes

- BYOK: provider API keys live only in your browser's `localStorage` — they reach the server only in-flight to proxy a request.
- The web console is gated by your wizard-generated username + token (session-scoped).
- Pairing tokens are 8 chars from an unambiguous 23-char alphabet (~1.8 × 10¹¹ keyspace), single-purpose and revocable from the whitelist panel.

## Tech

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui · zustand · z-ai-web-dev-sdk (demo brain) · Telegram Bot API

---

Made using **GLM 5.3 FLASH** · By **Roman** | [www.rommark.dev](https://www.rommark.dev)
