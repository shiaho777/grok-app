/**
 * Empty live Thinking rows: show why the turn still looks blank
 * (provider retry vs waiting on first token). Relays often omit CoT.
 */

import type { ProviderRetryStatus } from "./providerRetryStatusStore";

/** Soft hint before the 90s STREAM_STALL banner. */
export const WAITING_FIRST_TOKEN_HINT_MS = 12_000;

export type ThinkingWaitHintKind = "retry" | "waiting" | null;

export function resolveThinkingWaitHint(args: {
  live: boolean;
  hasBody: boolean;
  durationMs?: number | null;
  retry: ProviderRetryStatus;
}): ThinkingWaitHintKind {
  if (!args.live || args.hasBody) return null;
  if (args.retry) return "retry";
  if ((args.durationMs ?? 0) >= WAITING_FIRST_TOKEN_HINT_MS) return "waiting";
  return null;
}
