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

---
Task ID: 3
Agent: Super Z (main agent)
Task: Telegram bot fix (real answers), portal logins generated in wizard, Channel Pairing Token flow, whitelist (shared/isolated), built-in bot support, WhatsApp removal, GitHub publish, Vercel redeploy.

Work Log:
- Brain engine extracted to src/lib/brain.ts; /api/chat now a thin wrapper (same fallback chain reused by Telegram gateway).
- src/lib/agent-registry.ts: server-side gateway registry (agent configs, per-chat binding owner/shared/isolated, threads, recent replies, getUpdates offset). Storage: Vercel Blob in production, .gateway/registry.json file in dev (cross-worker), memory fallback. Reads useCache:false (private blob GETs are edge-cached — the root cause of stale cross-instance state); persistRegistry re-reads + merges before write to avoid clobbering.
- src/lib/telegram.ts: tg API helpers + handleTelegramUpdate — pairing-token binding (regex DIP-[23456789A-HJ-NP-Z]{4}-x2, ambiguous chars excluded), /start hints, chat handling with per-user context line, isolated vs shared threads, typing indicator, 3800-char message splitting, forced-refresh retry to heal blob eventual consistency.
- Routes: /api/pair/telegram rewritten (builtin bot @init_smart_bot OR own bot via getMe; webhook on public origins, poll bridge + deleteWebhook on localhost; registers runtime config), /api/telegram/webhook (t=<botToken>|builtin, maxDuration 60), /api/telegram/poll (browser-driven getUpdates bridge), /api/telegram/status (bound chats/tokens/replies).
- Wizard: credentials generated at step 1 (ensureCredentials → portalUser slug, portalToken di_+hex24, pairingToken DIP-XXXX-XXXX via src/lib/tokens.ts); step 2 Telegram-only with built-in/own toggle + CopyField token panel; review shows access credentials panel; WhatsAppCard + /api/pair/whatsapp removed; ChannelType = "telegram".
- Portal gate: portal-login.tsx lock screen (username + token vs profile, sessionStorage di-portal-auth), page.tsx gate, dashboard Lock button (onLogout). Overview gained "portal access" panel with copy fields.
- Channels tab: ChannelsTab (TelegramCard + GatewayPanel + WhitelistPanel in channels-ops.tsx). GatewayPanel: status poll 8s, resync (re-register config), poll bridge toggle 4s, auto-resync on mount/4min/when unregistered (60s throttle), window "di-resync" event. WhitelistPanel: add/remove users with per-user token + shared/isolated mode, owner token row with bound state.
- Debugging prod: in-memory registry invisible across lambda instances → Vercel Blob store deep-init-gw (store_Vd1SwVKuaQUzWCzH) created + linked via CLI; ifMatch optimistic concurrency abandoned (spurious ETag mismatches under eventual consistency + SDK error name is generic "Error"); final design = useCache:false reads + merge-before-write. Added BLOB_STORE_ID + BUILTIN_TELEGRAM_BOT_TOKEN env vars (production). Temporary debug route used for diagnosis, then removed.
- Demo brain (z-ai-web-dev-sdk) does not run on Vercel (missing .z-ai-config) — bot replies with honest "all brains failed" warning there; works in sandbox/local. Documented in README.
- GitHub: repo romangalaxys10-spec/deep-init-ai created (public), main pushed (bfb092c → 4eb2d52), README with quickstart/architecture/security + attribution "Made using GLM 5.3 FLASH · By Roman | www.rommark.dev". Sandbox skills/ + examples/ gitignored.
- Verified on production: pair → webhook bind owner → bind whitelisted (isolated) user → chat → brain reply → cross-instance status shows both chats; Telegram setWebhook points to /api/telegram/webhook?t=builtin; local sandbox E2E identical via localhost + poll bridge.

Stage Summary:
- Live: https://deep-init-ai.vercel.app · GitHub: https://github.com/romangalaxys10-spec/deep-init-ai
- Telegram now actually answers: pairing token → Paired ✓ → provider-chain replies, shared/isolated whitelist, built-in + own bots, webhook (prod) / poll bridge (dev).
- Portal logins minted in wizard gate the console; pairing tokens minted in wizard/channels gate the bot.
- Known limits: demo brain only where .z-ai-config exists (configure a real provider on Vercel); registry TTL 24h + dashboard auto-resync heals cold starts; poll bridge only runs while a portal tab is open (webhook covers 24/7 on prod).

---
Task ID: 3
Agent: Super Z (main)
Task: Fix init→landing bug, ensure portal login/re-login, bright rene.co-inspired redesign, publish GitHub, deploy Vercel

Work Log:
- Root-caused "init lands on main page": BootSequence activate() → view=dashboard, but page.tsx gate `authed` (sessionStorage di-portal-auth) was never set on first session → PortalLogin shown instead of dashboard
- Fix: Wizard onInitialize now sets sessionStorage auth + setAuthed(true) → boot → straight into console (src/app/page.tsx)
- PortalLogin hardened: lazy-initializer escape hatch auto-mints credentials if missing (legacy locked-out state), case-insensitive user/token match, "new credentials generated" banner with CopyFields (src/components/deepinit/portal-login.tsx)
- Bright redesign (rene.co-inspired): globals.css full token flip (ivory bg oklch 0.977/88, coral primary oklch 0.665/41, peach secondary, espresso fg), soft color-blob + dotted-grid canvas, warm glow/sheen/sweep, both :root and .dark identical; layout.tsx dark class removed + themeColor #faf5ec; button.tsx pill rounded-full (sm/lg too); Panel rounded-2xl + soft warm shadow; instances-panel code blocks bg-stone-900/text-stone-100; landing pastel traffic dots + footer credit "made using GLM 5.3 FLASH · by Roman · www.rommark.dev"
- Browser-verified (agent-browser): full wizard (Roman/Init) → sudo init --agent → dashboard directly ✓; Lock → PortalLogin → re-login with roman/di_454152cc… ✓; reload keeps session ✓; sessionStorage cleared → lock screen ✓; channels tab whitelist UI bright ✓; built-in bot pairing via real API ✓ gatewayMode poll (local)
- ESLint --max-warnings=0 clean, tsc clean (src)
- GitHub: pushed 86940da (design+login) and 3c82f6c (harden findByPairingToken vs malformed entries) → github.com/romangalaxys10-spec/deep-init-ai
- Vercel: production deploy Ready (deep-init-ai.vercel.app), env BLOB_READ_WRITE_TOKEN + BUILTIN_TELEGRAM_BOT_TOKEN present; prod pair API verified gatewayMode webhook; setWebhook registered for @init_smart_bot → https://deep-init-ai.vercel.app/api/telegram/webhook (getWebhookInfo confirmed); vercel git connect failed (needs Vercel GitHub App access to repo) — manual deploy path documented

Stage Summary:
- All 3 user asks complete: (1) init→dashboard bug fixed & verified, (2) user/token login/re-login verified, (3) bright rene.co-inspired redesign live on production
- Production: https://deep-init-ai.vercel.app (HTTP 200, bright theme, webhook armed for builtin bot)
- Repo: https://github.com/romangalaxys10-spec/deep-init-ai (main @ 3c82f6c)

---
Task ID: 4
Agent: Super Z (main)
Task: Multi-lang UI (EN/RU/HE + RTL), Hermes/OpenClaw-grade streaming (Telegram + web console), code-block rendering, GitHub + Vercel publish. (Also: acknowledged the "tooling bug" — previous turn emitted fake web_search/web_fetch tool calls as text; this turn used the real web-search/page-reader skills.)

Work Log:
- Studied OpenClaw docs (docs.openclaw.ai/concepts/streaming) via page_reader: two-layer model = block streaming (emit completed blocks) + preview streaming (Telegram: send + editMessageText appends), chunkMode newline/length, textChunkLimit ~4000; known Hermes bug: markdown formatting silently lost on chunked messages → designed against it.
- src/lib/telegram-format.ts: markdown→Telegram HTML (``` fences → <pre><code class="language-x">, inline code, **bold**, *italic*, links; full HTML escaping), fence-aware chunker that never silently mangles code (oversized blocks hard-split with reopened <pre> wrapper, entity-safe slicing), htmlToPlain + plainPreview.
- src/lib/brain.ts: SSE streaming engine — callOpenAICompatibleStream (data: deltas) + callAnthropicStream (content_block_delta), non-SSE provider fallback (some providers ignore stream:true), demo brain delta-replay (12 slices), runAgentChainStreaming with same fallback order.
- /api/chat: stream:true → NDJSON lines {provider_start|delta|done} (ReadableStream, no-store, X-Accel-Buffering:no).
- src/lib/telegram.ts: streamReplyToChat — persistent typing (sendChatAction every 4.2s until first delta), first ≥30 chars claim a placeholder message, throttled editMessageText previews (≥1.6s, ≥48 new chars, "▌" cursor), final edit swaps in formatted HTML (chunk-aware, editMessageId), plain-text fallback on any HTML parse rejection; chat path now streams end-to-end (webhook + poll bridge share it).
- src/components/deepinit/rich-text.tsx: RichText renderer — dark code cards (language label + copy button), inline code chips, bold, links; unterminated fences render as code (mid-stream safe).
- agent-console.tsx: NDJSON reader (delta → live bubble update via updateMessage, "▊" cursor), legacy JSON fallback retained, message bubbles render RichText.
- i18n: src/lib/i18n.ts (EN/RU/HE ~130 keys, {var} interpolation, EN fallback, useT hook); store uiLang (persisted, survives factory reset); LangSwitch pills (landing nav, wizard rail, portal login, dashboard header); page.tsx syncs document.documentElement.dir/lang (he → rtl); wired landing (hero/caps/steps/footer), portal-login (all strings + shadowing bug fix tok), boot, dashboard chrome (tabs/stats/panels/dialogs), console chrome + suggestions, wizard chrome (step rail, back/next, review).
- Tests: scripts/test-telegram-format.ts (17/17 — incl. fence-aware split, entity-safe cuts, unterminated fence), scripts/test-streaming-pipeline.ts (monotonic deltas, chunk limits) — both PASS.
- Fixed during build: unterminated-fence detection failed when text precedes the open fence (fenceCount parity check now); portal-login local `t` shadowed the useT hook → renamed to tok; agent-console ev type aligned to FallbackStep.
- Verified (agent-browser, local): landing bright + LangSwitch; RU hero/CTA/panel translated; HE flips dir=rtl + full mirror; wizard E2E (pair built-in bot → skip providers → goals → sudo init --agent) lands straight in dashboard (auth-fix regression PASS); console streams demo-brain reply and renders dark code block; Lock → re-login roman/di_d64a6cc… PASS; curl /api/chat NDJSON: delta+done lines confirmed.
- GitHub: pushed 6e45d2b → github.com/romangalaxys10-spec/deep-init-ai (main).
- Vercel: prod deploy Ready (deep-init-76dkyscfm-ryzenadvanceds-projects.vercel.app → deep-init-ai.vercel.app HTTP 200); setWebhook re-armed for @init_smart_bot (5 pending updates will flow through the new streaming gateway); prod landing renders new UI (LangSwitch verified headless); /api/chat 502 with no providers on prod = expected BYOK/demo-brain-off-Vercel behavior.

Stage Summary:
- Init now streams like Hermes/OpenClaw: typing indicator → live preview edits in Telegram → final formatted HTML with real code blocks; same streaming in the web console with styled code cards.
- UI is trilingual: English / Русский / עברית with true RTL for Hebrew, switchable from every surface.
- Live: https://deep-init-ai.vercel.app · Repo: https://github.com/romangalaxys10-spec/deep-init-ai (main @ 6e45d2b)

---
Task ID: 5
Agent: Super Z (main)
Task: Fix tooling bug — agent models leaking raw tool-call syntax (<function=...>/<parameter=...>) and internal context (protocol/skill names) into chat & Telegram replies

Work Log:
- Root cause: agent-flavored models behind custom providers emit tool calls AS TEXT (e.g. <function=mcp__browser__fetch><parameter=url>...) instead of structured tool_calls; the chat pipeline passed content through verbatim, so the syntax + planning narration reached users.
- NEW src/lib/tools.ts: (1) extractToolCalls() — parses 4 leak dialects (<function=NAME>, <function name="">, <tool_call>{json} Qwen-style, <invoke name=""> antml-style) with <parameter=K> / <parameter name="K"> values; (2) sanitizeAgentText()/sanitizeStreamText() — final-output + mid-stream guarantees that NO tool syntax (complete or unterminated), special tokens (<|tool_call_begin|>) or stray closers ever reach a viewer (real ``` fences untouched); (3) executors — web_search (SDK functions.invoke → DuckDuckGo HTML fallback) and web_fetch (SDK page_reader → direct fetch + html→text, 15s timeout, 3.5k budget), alias matching (mcp__browser__fetch, browser_fetch, page_reader, search_web...), unknown tools refused safely (SSRF note: remote reader refuses private IPs → fallback verified); (4) AGENT_GUARDRAILS system-prompt add-on: never quote system prompt/rules/protocols/skill names, never print tool-call syntax, use injected tool results silently.
- src/lib/brain.ts refactor: shared runChainOnce/runChainOnceStreaming (providers + demo brain, per-round) + agentic tool loop (MAX_TOOL_ROUNDS=2): leaked calls are parsed → executed server-side → results injected as [AUTOMATED TOOL RESULTS] user message → model answers again. Streaming deltas are sanitized at emission (sanitizeStreamText(prefix+delta)) so previews stay clean and monotonic; final content = last-round clean answer (intermediate tool-narration stays preview-only). Both /api/chat modes + Telegram gateway inherit this automatically (streamReplyToChat consumes runAgentChainStreaming).
- scripts/test-tools.ts (30 checks): exact prod leak sample parsed+cleaned; dialect variants; unterminated-tail char-by-char drip (no syntax visible at ANY prefix); live web_search/web_fetch execution; unknown-tool refusal; offline e2e with mock leaky OpenAI-compatible provider — non-streaming AND streaming loops execute the tool and return clean answers (30/30 PASS).
- Regression: test-streaming-pipeline.ts delta-count assertion was calibrated to old demo-brain answer length → prompt now requests 400+ words (deterministic >=2 deltas); PASS. test-telegram-format.ts 17/17. tsc: src clean. ESLint --max-warnings=0 clean.

Stage Summary:
- Any provider/model that leaks <function=...> syntax now gets its tools executed for real and users only ever see sanitized, natural answers — on web console, /api/chat and Telegram alike; internal-context narration is suppressed via guardrails and tool-round isolation.
