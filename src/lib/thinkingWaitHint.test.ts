import { describe, expect, it } from "vitest";
import {
  WAITING_FIRST_TOKEN_HINT_MS,
  resolveThinkingWaitHint,
} from "./thinkingWaitHint";

describe("resolveThinkingWaitHint", () => {
  it("stays quiet while tokens or thought body are present", () => {
    expect(
      resolveThinkingWaitHint({
        live: true,
        hasBody: true,
        durationMs: 60_000,
        retry: { attempt: 1, maxRetries: 12, reason: "x" },
      }),
    ).toBeNull();
    expect(
      resolveThinkingWaitHint({
        live: false,
        hasBody: false,
        durationMs: 60_000,
        retry: null,
      }),
    ).toBeNull();
  });

  it("prefers retry over waiting", () => {
    expect(
      resolveThinkingWaitHint({
        live: true,
        hasBody: false,
        durationMs: WAITING_FIRST_TOKEN_HINT_MS,
        retry: { attempt: 2, maxRetries: 12, reason: "reset" },
      }),
    ).toBe("retry");
  });

  it("shows waiting only after the soft threshold", () => {
    expect(
      resolveThinkingWaitHint({
        live: true,
        hasBody: false,
        durationMs: WAITING_FIRST_TOKEN_HINT_MS - 1,
        retry: null,
      }),
    ).toBeNull();
    expect(
      resolveThinkingWaitHint({
        live: true,
        hasBody: false,
        durationMs: WAITING_FIRST_TOKEN_HINT_MS,
        retry: null,
      }),
    ).toBe("waiting");
  });
});
