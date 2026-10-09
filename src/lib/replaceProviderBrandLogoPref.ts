/**
 * Appearance → Interface: replace the sidebar top-left Grok mark with the
 * active custom provider brand logo (DeepSeek / OpenCode / Volcengine Ark / …).
 * localStorage-only — does not touch Host AppSettings.
 * Default: off (keep Grok branding until the user opts in).
 */

export const REPLACE_PROVIDER_BRAND_LOGO_STORAGE_KEY =
  "grok.replaceProviderBrandLogo";

/** Fired on `window` after a successful save (detail = boolean enabled). */
export const REPLACE_PROVIDER_BRAND_LOGO_CHANGE_EVENT =
  "grok-replace-provider-brand-logo-change";

/** Off by default — product chrome stays Grok unless the user opts in. */
export const DEFAULT_REPLACE_PROVIDER_BRAND_LOGO = false;

/**
 * Shared height (px) for every swappable sidebar brand mark in the nav row.
 * Matches default nav item icons (16). Wordmarks scale by height
 * (`height: N; width: auto`); icon-only marks use the same height as `size`.
 */
export const SIDEBAR_BRAND_LOGO_HEIGHT = 16;

/** Minimal storage surface so unit tests need no jsdom. */
export interface ReplaceProviderBrandLogoStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): ReplaceProviderBrandLogoStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

/** Parse stored value; invalid / empty → default false. */
export function parseReplaceProviderBrandLogoPref(raw: unknown): boolean {
  if (raw === "0" || raw === "false" || raw === false) return false;
  if (raw === "1" || raw === "true" || raw === true) return true;
  return DEFAULT_REPLACE_PROVIDER_BRAND_LOGO;
}

export function loadReplaceProviderBrandLogoPref(
  storage: ReplaceProviderBrandLogoStorage = defaultStorage(),
): boolean {
  try {
    return parseReplaceProviderBrandLogoPref(
      storage.getItem(REPLACE_PROVIDER_BRAND_LOGO_STORAGE_KEY),
    );
  } catch {
    /* private mode */
    return DEFAULT_REPLACE_PROVIDER_BRAND_LOGO;
  }
}

export function saveReplaceProviderBrandLogoPref(
  enabled: boolean,
  storage: ReplaceProviderBrandLogoStorage = defaultStorage(),
): void {
  try {
    storage.setItem(
      REPLACE_PROVIDER_BRAND_LOGO_STORAGE_KEY,
      enabled ? "1" : "0",
    );
  } catch {
    /* private mode / quota */
  }
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(REPLACE_PROVIDER_BRAND_LOGO_CHANGE_EVENT, {
          detail: enabled,
        }),
      );
    } catch {
      /* ignore */
    }
  }
}
