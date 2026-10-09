import { afterEach, describe, expect, it } from "vitest";
import {
  clearProviderRetryStatus,
  getProviderRetryStatus,
  setProviderRetryStatus,
  shortProviderRetryReason,
  subscribeProviderRetryStatus,
} from "./providerRetryStatusStore";

afterEach(() => {
  clearProviderRetryStatus();
});

describe("providerRetryStatusStore", () => {
  it("notifies subscribers on set and clear", () => {
    let ticks = 0;
    const unsub = subscribeProviderRetryStatus(() => {
      ticks += 1;
    });
    setProviderRetryStatus({
      attempt: 2,
      maxRetries: 12,
      reason: "stream reset",
    });
    expect(getProviderRetryStatus()?.attempt).toBe(2);
    expect(ticks).toBe(1);
    clearProviderRetryStatus();
    expect(getProviderRetryStatus()).toBeNull();
    expect(ticks).toBe(2);
    unsub();
  });

  it("shortProviderRetryReason collapses whitespace and truncates", () => {
    expect(shortProviderRetryReason("  a\n b  ")).toBe("a b");
    const long = "x".repeat(100);
    expect(shortProviderRetryReason(long, 20).length).toBe(20);
    expect(shortProviderRetryReason(long, 20).endsWith("…")).toBe(true);
  });
});
