import { describe, expect, it } from "vitest";
import {
  SESSION_JOURNAL_LOAD_TIMEOUT_MS,
  isSessionJournalTimeoutError,
  sessionJournalTimeoutError,
  withJournalLoadDeadline,
} from "./sessionJournalTimeout";
import { SESSION_CONNECT_CLIENT_TIMEOUT_MS } from "./sessionConnectTimeout";

describe("sessionJournalTimeout", () => {
  it("stays shorter than the connect client budget", () => {
    expect(SESSION_JOURNAL_LOAD_TIMEOUT_MS).toBe(15_000);
    expect(SESSION_JOURNAL_LOAD_TIMEOUT_MS).toBeLessThan(
      SESSION_CONNECT_CLIENT_TIMEOUT_MS,
    );
  });

  it("uses a dedicated timeout code", () => {
    expect(sessionJournalTimeoutError(15_000).message).toBe(
      "JOURNAL_LOAD_TIMEOUT: journal load timed out after 15s",
    );
    expect(isSessionJournalTimeoutError(sessionJournalTimeoutError())).toBe(
      true,
    );
    expect(isSessionJournalTimeoutError(new Error("other"))).toBe(false);
  });

  it("rejects never-resolving journal loads", async () => {
    await expect(
      withJournalLoadDeadline(
        new Promise<string>(() => {
          /* never */
        }),
        20,
      ),
    ).rejects.toThrow("JOURNAL_LOAD_TIMEOUT");
  });

  it("resolves when the load finishes in time", async () => {
    await expect(
      withJournalLoadDeadline(Promise.resolve("ok"), 50),
    ).resolves.toBe("ok");
  });
});
