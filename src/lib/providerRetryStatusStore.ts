/**
 * Live provider retry progress (`session://retry`).
 * Kept off AppWorkbench so the shell freeze stays intact.
 */

export type ProviderRetryStatus = {
  attempt: number;
  maxRetries: number;
  reason: string;
  aborting?: boolean;
} | null;

type Listener = () => void;

let state: ProviderRetryStatus = null;
const listeners = new Set<Listener>();

export function getProviderRetryStatus(): ProviderRetryStatus {
  return state;
}

export function setProviderRetryStatus(next: ProviderRetryStatus): void {
  state = next;
  for (const listener of listeners) listener();
}

export function clearProviderRetryStatus(): void {
  setProviderRetryStatus(null);
}

export function subscribeProviderRetryStatus(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Short, single-line reason for Thinking chrome (no stack dumps). */
export function shortProviderRetryReason(reason: string, max = 80): string {
  const t = reason.replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}
