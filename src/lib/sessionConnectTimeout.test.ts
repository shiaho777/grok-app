import { describe, expect, it } from "vitest";
import {
  SESSION_CONNECT_CLAIM_WAIT_MS,
  SESSION_CONNECT_CLIENT_TIMEOUT_MS,
  SESSION_STOP_CLIENT_TIMEOUT_MS,
  isSessionStopTimeoutError,
  sessionConnectTimeoutError,
  sessionStopTimeoutError,
  withDeadline,
} from "./sessionConnectTimeout";

describe("sessionConnectTimeout", () => {
  it("sits above the Host 90s wall clock", () => {
    expect(SESSION_CONNECT_CLIENT_TIMEOUT_MS).toBeGreaterThan(90_000);
    expect(SESSION_CONNECT_CLIENT_TIMEOUT_MS).toBeLessThanOrEqual(120_000);
  });

  it("aligns claim wait with the connect client budget", () => {
    expect(SESSION_CONNECT_CLAIM_WAIT_MS).toBe(SESSION_CONNECT_CLIENT_TIMEOUT_MS);
    expect(SESSION_STOP_CLIENT_TIMEOUT_MS).toBeLessThan(
      SESSION_CONNECT_CLIENT_TIMEOUT_MS,
    );
  });

  it("uses the CONNECT_FAILED deck code", () => {
    expect(sessionConnectTimeoutError(100_000).message).toBe(
      "CONNECT_FAILED: connect timed out after 100s",
    );
  });

  it("uses a dedicated stop timeout code", () => {
    expect(sessionStopTimeoutError(15_000).message).toBe(
      "SESSION_STOP_TIMEOUT: session stop timed out after 15s",
    );
    expect(isSessionStopTimeoutError(sessionStopTimeoutError())).toBe(true);
  });

  it("resolves when the work finishes in time", async () => {
    await expect(
      withDeadline(Promise.resolve("ok"), 50, () => new Error("late")),
    ).resolves.toBe("ok");
  });

  it("rejects when the work misses the budget", async () => {
    await expect(
      withDeadline(
        new Promise<string>(() => {
          /* never */
        }),
        20,
        () => sessionConnectTimeoutError(20),
      ),
    ).rejects.toThrow("CONNECT_FAILED: connect timed out after 1s");
  });
});
