import { describe, expect, it } from "vitest";
import {
  STOP_LATCH_MS,
  armStopLatch,
  canSendWithStopLatch,
  createStopLatchState,
  settleStopLatchAfterSessionStop,
  shouldHoldReadyAfterUserStop,
  tickStopLatch,
} from "./stopLatch";

describe("stopLatch", () => {
  it("force-completes after budget while still streaming", () => {
    let latch = createStopLatchState();
    latch = armStopLatch(latch, "s1", 1000);
    expect(canSendWithStopLatch("streaming", latch)).toBe(false);
    let r = tickStopLatch(latch, "streaming", 1000 + STOP_LATCH_MS - 1);
    expect(r.forceComplete).toBe(false);
    r = tickStopLatch(latch, "streaming", 1000 + STOP_LATCH_MS);
    expect(r.forceComplete).toBe(true);
    expect(r.latch.phase).toBe("force_idle");
    expect(canSendWithStopLatch("streaming", r.latch)).toBe(true);
  });

  it("clears when host becomes ready", () => {
    let latch = armStopLatch(createStopLatchState(), "s1", 1000);
    const r = tickStopLatch(latch, "ready", 1100);
    expect(r.latch.phase).toBe("idle");
    expect(r.forceComplete).toBe(false);
  });

  it("keeps force_idle when sessionStop returns (Host may still be streaming)", () => {
    const armed = armStopLatch(createStopLatchState(), "s1", 1000);
    // No hostState — Stop painted Ready locally; do not trust that as Host truth.
    const next = settleStopLatchAfterSessionStop(armed);
    expect(next.phase).toBe("force_idle");
    expect(next.sessionId).toBe("s1");
    expect(canSendWithStopLatch("streaming", next)).toBe(true);
    expect(settleStopLatchAfterSessionStop(armed, "streaming").phase).toBe(
      "force_idle",
    );
  });

  it("clears latch when sessionStop returns and caller knows Host is ready", () => {
    const armed = armStopLatch(createStopLatchState(), "s1", 1000);
    const next = settleStopLatchAfterSessionStop(armed, "ready");
    expect(next.phase).toBe("idle");
  });

  it("holds composer ready while latch is armed for that session", () => {
    const idle = createStopLatchState();
    expect(shouldHoldReadyAfterUserStop(idle, "s1")).toBe(false);

    const waiting = armStopLatch(idle, "s1", 1000);
    expect(shouldHoldReadyAfterUserStop(waiting, "s1")).toBe(true);
    expect(shouldHoldReadyAfterUserStop(waiting, "other")).toBe(false);

    const forced = settleStopLatchAfterSessionStop(waiting);
    expect(shouldHoldReadyAfterUserStop(forced, "s1")).toBe(true);
  });
});
