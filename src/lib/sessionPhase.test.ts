import { describe, expect, it } from "vitest";
import {
  reconcileSessionState,
  reconcileUiBusyGate,
  stallMessageKey,
  stallTierFromProgress,
  normalizeStallTier,
} from "./sessionPhase";
import { armStopLatch, createStopLatchState, tickStopLatch, STOP_LATCH_MS } from "./stopLatch";

describe("sessionPhase", () => {
  it("reconcileUiBusyGate force idle unlocks send", () => {
    let latch = armStopLatch(createStopLatchState(), "s", 0);
    latch = tickStopLatch(latch, "streaming", STOP_LATCH_MS).latch;
    const gate = reconcileUiBusyGate({
      hostState: "streaming",
      stopLatch: latch,
    });
    expect(gate.sendable).toBe(true);
    expect(gate.forceIdle).toBe(true);
  });

  it("stall tiers never pretends pre-token after tools or body", () => {
    expect(stallTierFromProgress({ sawModelOutput: false })).toBe(
      "pre_first_token",
    );
    expect(
      stallTierFromProgress({ sawModelOutput: false, sawToolActivity: true }),
    ).toBe("working_tools");
    expect(stallTierFromProgress({ sawModelOutput: true })).toBe("post_output");
    expect(
      stallTierFromProgress({
        sawModelOutput: true,
        terminalCandidate: true,
      }),
    ).toBe("maybe_done");
    expect(stallMessageKey("pre_first_token")).toBe("endOfTurn.stallPreToken");
    expect(stallMessageKey("working_tools")).toBe(
      "endOfTurn.stallWorkingTools",
    );
    expect(stallMessageKey("post_output")).toBe("endOfTurn.stall");
    expect(stallMessageKey("maybe_done")).toBe("endOfTurn.stallMaybeDone");
    expect(stallMessageKey("post_first_token")).toBe("endOfTurn.stall");
  });

  it("normalizeStallTier maps host strings", () => {
    expect(normalizeStallTier("post_output")).toBe("post_output");
    expect(normalizeStallTier("working_tools")).toBe("working_tools");
    expect(normalizeStallTier("nope")).toBeNull();
  });

  it("reconcileSessionState prefers host terminal over stuck UI streaming", () => {
    expect(reconcileSessionState("ready", "streaming")).toBe("ready");
    expect(reconcileSessionState("streaming", "ready")).toBe("streaming");
  });

  it("reconcileSessionState keeps UI ready after user Stop while Host still streams", () => {
    const latch = armStopLatch(createStopLatchState(), "s1", 0);
    // Without latch, Host streaming would re-stick the composer (old bug).
    expect(reconcileSessionState("streaming", "ready")).toBe("streaming");
    // With an armed stop latch for this chat, keep the optimistic ready so
    // Send stays clickable instead of flipping back to Stop.
    expect(
      reconcileSessionState("streaming", "ready", {
        stopLatch: latch,
        sessionId: "s1",
      }),
    ).toBe("ready");
    expect(
      reconcileSessionState("streaming", "ready", {
        stopLatch: latch,
        sessionId: "other",
      }),
    ).toBe("streaming");
  });

  it("reconcileSessionState keeps streaming across connect Ready mid-send", () => {
    // ensureConnected paints Host Ready before sessionSend — must not flash Send.
    expect(reconcileSessionState("ready", "streaming")).toBe("ready");
    expect(
      reconcileSessionState("ready", "streaming", { preserveStreaming: true }),
    ).toBe("streaming");
  });
});
