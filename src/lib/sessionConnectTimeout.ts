/**
 * Client deadline for `session_connect`.
 *
 * Host wall-clock is 90s and now includes `connect_lock` wait. If Host IPC
 * itself never returns (wedged runtime), the UI must still drop 连接中.
 * Stay slightly above the Host budget so a real Host timeout wins.
 */
export const SESSION_CONNECT_CLIENT_TIMEOUT_MS = 100_000;

/**
 * Duplicate-claim wait and `session_stop` on retry share the connect budget so
 * a wedged peer claim / stop cannot sit on 连接中 for a separate 120s ceiling.
 */
export const SESSION_CONNECT_CLAIM_WAIT_MS = SESSION_CONNECT_CLIENT_TIMEOUT_MS;

export const SESSION_STOP_CLIENT_TIMEOUT_MS = 15_000;

export const SESSION_STOP_TIMEOUT_CODE = "SESSION_STOP_TIMEOUT";

export function sessionConnectTimeoutError(
  budgetMs = SESSION_CONNECT_CLIENT_TIMEOUT_MS,
): Error {
  const secs = Math.max(1, Math.round(budgetMs / 1000));
  return new Error(`CONNECT_FAILED: connect timed out after ${secs}s`);
}

export function sessionStopTimeoutError(
  budgetMs = SESSION_STOP_CLIENT_TIMEOUT_MS,
): Error {
  const secs = Math.max(1, Math.round(budgetMs / 1000));
  return new Error(
    `${SESSION_STOP_TIMEOUT_CODE}: session stop timed out after ${secs}s`,
  );
}

export function isSessionStopTimeoutError(err: unknown): boolean {
  return (
    err instanceof Error &&
    err.message.startsWith(`${SESSION_STOP_TIMEOUT_CODE}:`)
  );
}

export function withDeadline<T>(
  promise: Promise<T>,
  budgetMs: number,
  onTimeout: () => Error,
): Promise<T> {
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(onTimeout());
    }, budgetMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
