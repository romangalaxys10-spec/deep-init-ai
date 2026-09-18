/* ============================================================
 * Active-brain chooser — pick WHICH provider/model answers
 *
 * Users can add several brains (providers) under the Brains tab.
 * Priority order defines the fallback chain, but the owner may want
 * a specific brain to answer NOW (e.g. a cheap local model for chat,
 * a premium one when it matters). This module is the single source of
 * truth for identifying and ordering providers, shared by:
 *
 *   • web console — BrainsPanel chooser + console chat requests
 *   • Telegram gateway — /model inline picker + streamReplyToChat
 *   • /api/agent/config — portal → gateway sync (Active-brain passport)
 *
 * The key is `label::baseUrl::model` (trimmed, lowercased): stable
 * across reorders/removals of OTHER providers and identical on both
 * surfaces (the web provider `id` is local-only and never synced).
 * ============================================================ */

interface ProviderLike {
  label?: string;
  baseUrl: string;
  model: string;
}

/** Stable cross-surface identity of a provider (NOT shown to users). */
export function providerKey(p: ProviderLike): string {
  return [p.label || "", p.baseUrl || "", p.model || ""]
    .map((s) => s.trim().toLowerCase())
    .join("::");
}

/**
 * Orders the fallback chain so the ACTIVE brain answers first.
 * `activeKey` null/unknown → untouched (pure priority order).
 * The rest keep their relative order — they stay as fallbacks, so a
 * dead active brain still degrades gracefully instead of erroring.
 * PURE: never mutates the input array (callers pass live agent state).
 */
export function orderProviders<T extends ProviderLike>(providers: T[], activeKey?: string | null): T[] {
  if (!activeKey || providers.length < 2) return providers;
  const idx = providers.findIndex((p) => providerKey(p) === activeKey);
  if (idx <= 0) return providers;
  return [providers[idx], ...providers.filter((_, i) => i !== idx)];
}

/** Human label for pickers/buttons: "Label · model" (falls back to model). */
export function providerDisplayName(p: ProviderLike): string {
  const label = (p.label || "").trim();
  const model = (p.model || "").trim();
  if (label && model && label.toLowerCase() !== model.toLowerCase()) return `${label} · ${model}`;
  return label || model || "unnamed brain";
}
