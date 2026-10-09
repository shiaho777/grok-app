/**
 * App-behind gate for in-app CLI upgrades (#1009).
 * Host may soft-fail with an `APP_BEHIND:` error; UI warns before install.
 */

import type { CliUpdateCheck } from "@/lib/api/runtime";

export const APP_BEHIND_ERROR_PREFIX = "APP_BEHIND:";

/** Whether the CLI update check says the App should be updated first. */
export function isCliUpdateAppBehind(
  check: Pick<CliUpdateCheck, "appBehind" | "appUpdateAvailable"> | null | undefined,
): boolean {
  if (!check) return false;
  if (check.appBehind === true) return true;
  if (check.appUpdateAvailable === true) return true;
  return false;
}

/** Detect Host soft-fail for App-behind CLI install. */
export function isAppBehindInstallError(error: unknown): boolean {
  const s = String(error ?? "");
  return s.includes(APP_BEHIND_ERROR_PREFIX);
}

/** Strip the structured prefix for display (best-effort). */
export function stripAppBehindErrorPrefix(error: unknown): string {
  const s = String(error ?? "");
  const idx = s.indexOf(APP_BEHIND_ERROR_PREFIX);
  if (idx < 0) return s;
  return s.slice(idx + APP_BEHIND_ERROR_PREFIX.length).trim() || s;
}
