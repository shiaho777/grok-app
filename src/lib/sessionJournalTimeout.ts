/**
 * Client deadline for opening a session journal.
 *
 * Must stay below the connect client budget so a wedged `session_messages`
 * cannot outlive reconnect / claim waits during rapid session switches.
 */
import { withDeadline } from "./sessionConnectTimeout";

export const SESSION_JOURNAL_LOAD_TIMEOUT_MS = 15_000;

/** Machine-readable prefix so callers can distinguish timeout from other failures. */
export const SESSION_JOURNAL_TIMEOUT_CODE = "JOURNAL_LOAD_TIMEOUT";

export function sessionJournalTimeoutError(
  budgetMs = SESSION_JOURNAL_LOAD_TIMEOUT_MS,
): Error {
  const secs = Math.max(1, Math.round(budgetMs / 1000));
  return new Error(
    `${SESSION_JOURNAL_TIMEOUT_CODE}: journal load timed out after ${secs}s`,
  );
}

export function isSessionJournalTimeoutError(err: unknown): boolean {
  return (
    err instanceof Error &&
    err.message.startsWith(`${SESSION_JOURNAL_TIMEOUT_CODE}:`)
  );
}

export function withJournalLoadDeadline<T>(
  promise: Promise<T>,
  budgetMs = SESSION_JOURNAL_LOAD_TIMEOUT_MS,
): Promise<T> {
  return withDeadline(promise, budgetMs, () =>
    sessionJournalTimeoutError(budgetMs),
  );
}
