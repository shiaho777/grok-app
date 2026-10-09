/**
 * Pure Host ↔ UI phase reconcile (CodePilot stream-phase-reconcile style).
 * Does not invent streaming without a live reader — only corrects stuck busy.
 */

import type { SessionState } from "./session";
import { canSend, isSessionLiveStreaming } from "./session";
import type { StopLatchState } from "./stopLatch";
import {
  canSendWithStopLatch,
  shouldHoldReadyAfterUserStop,
} from "./stopLatch";

export type UiBusyGate = {
  /** Composer may send */
  sendable: boolean;
  /** Show quiet thinking placeholder */
  quietThinking: boolean;
  /** UI should clear streaming flags / force idle projection */
  forceIdle: boolean;
  /** Session is in a live turn for sidebar badge */
  liveBusy: boolean;
};

/**
 * Reconcile host session state with optional stop latch.
 */
export function reconcileUiBusyGate(input: {
  hostState: SessionState;
  stopLatch?: StopLatchState;
  /** True when messages still have streaming assistant */
  hasStreamingAssistant?: boolean;
  /** True when a tool is still marked running in current turn */
  hasRunningTool?: boolean;
}): UiBusyGate {
  const host = input.hostState;
  const latch = input.stopLatch ?? {
    phase: "idle" as const,
    sessionId: null,
    startedAt: null,
  };
  const forceIdle = latch.phase === "force_idle";
  const sendable = canSendWithStopLatch(host, latch);
  const liveBusy =
    !forceIdle &&
    (isSessionLiveStreaming(host) ||
      !!input.hasStreamingAssistant ||
      !!input.hasRunningTool);
  const quietThinking =
    liveBusy && !input.hasStreamingAssistant && !input.hasRunningTool;

  return {
    sendable,
    quietThinking,
    forceIdle,
    liveBusy,
  };
}

/**
 * When opening a session, if UI cache says streaming but host snapshot is ready/idle,
 * prefer host (clear stuck busy).
 *
 * Optional `stopLatch`: after the user hits Stop we optimistically paint Ready.
 * Late Host "streaming" must not re-stick the composer while that latch is armed.
 */
export function reconcileSessionState(
  hostState: SessionState,
  uiCached?: SessionState | null,
  opts?: {
    stopLatch?: StopLatchState;
    sessionId?: string | null;
    /**
     * Keep UI streaming when Host briefly paints Ready mid-send
     * (ensureConnected → sessionSend). Avoids a Send/Stop flash.
     */
    preserveStreaming?: boolean;
  },
): SessionState {
  if (!uiCached) return hostState;
  // Host terminal + UI still streaming → host wins — unless a send is still
  // in flight and Ready is only the post-connect handshake.
  if (
    (hostState === "ready" ||
      hostState === "idle" ||
      hostState === "disconnected") &&
    isSessionLiveStreaming(uiCached)
  ) {
    if (opts?.preserveStreaming && hostState === "ready") {
      return uiCached;
    }
    return hostState;
  }
  // User Stop hold: keep optimistic Ready / Idle so Send stays available.
  if (
    opts?.stopLatch &&
    shouldHoldReadyAfterUserStop(opts.stopLatch, opts.sessionId) &&
    isSessionLiveStreaming(hostState) &&
    canSend(uiCached)
  ) {
    return uiCached;
  }
  // Host streaming, UI idle → host wins
  if (isSessionLiveStreaming(hostState) && canSend(uiCached)) {
    return hostState;
  }
  return hostState;
}

/**
 * Stall copy tiers — never use pre-token when tools or assistant body exist.
 * Aligns with Host `stream_stall::StallTier`.
 */
export type StallTier =
  | "pre_first_token"
  | "working_tools"
  | "post_output"
  | "maybe_done"
  /** @deprecated use post_output */
  | "post_first_token";

export function stallTierFromProgress(input: {
  sawModelOutput: boolean;
  sawToolActivity?: boolean;
  terminalCandidate?: boolean;
}): StallTier {
  if (input.terminalCandidate) return "maybe_done";
  if (input.sawModelOutput) return "post_output";
  if (input.sawToolActivity) return "working_tools";
  return "pre_first_token";
}

export function stallMessageKey(tier: StallTier):
  | "endOfTurn.stallPreToken"
  | "endOfTurn.stallWorkingTools"
  | "endOfTurn.stall"
  | "endOfTurn.stallMaybeDone" {
  switch (tier) {
    case "pre_first_token":
      return "endOfTurn.stallPreToken";
    case "working_tools":
      return "endOfTurn.stallWorkingTools";
    case "maybe_done":
      return "endOfTurn.stallMaybeDone";
    case "post_output":
    case "post_first_token":
    default:
      return "endOfTurn.stall";
  }
}

/** Normalize host-emitted tier strings. */
export function normalizeStallTier(
  raw: string | null | undefined,
): StallTier | null {
  if (!raw) return null;
  const t = raw.toLowerCase().trim();
  if (t === "pre_first_token") return "pre_first_token";
  if (t === "working_tools") return "working_tools";
  if (t === "post_output" || t === "post_first_token") return "post_output";
  if (t === "maybe_done") return "maybe_done";
  return null;
}
