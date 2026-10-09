/**
 * Sidebar brand mark for the new-session row: default Grok mark, or the
 * active custom provider brand when Appearance → “Replace brand logo” is on.
 *
 * Wordmark brands (DeepSeek, OpenCode) carry their own name — no extra label.
 * Icon-only brands (Volcengine Ark, Amux, Zhipu) render the mark + a text label.
 * All swappable marks share {@link SIDEBAR_BRAND_LOGO_HEIGHT} for size parity.
 */

import { memo } from "react";
import { GrokLogo } from "@/components/GrokLogo";
import { ProviderBrandIcon } from "@/components/ProviderBrandIcon";
import {
  DeepSeekFullMark,
  OpenCodeWordmark,
} from "@/components/ProviderWelcomeMark";
import type { ProviderBrandId } from "@/lib/providerPresets";
import { SIDEBAR_BRAND_LOGO_HEIGHT } from "@/lib/replaceProviderBrandLogoPref";

export type SidebarBrandProps = {
  /** When true and `brandId` is set, swap Grok for the provider mark. */
  replaceLogo?: boolean;
  /** Resolved brand for the active custom route (null = no known logo). */
  brandId?: ProviderBrandId | null;
  /**
   * Text beside icon-only marks (Volcengine / Amux), and the default “Grok”
   * label when not replacing.
   */
  label?: string;
};

/**
 * Brands whose SVG is a full wordmark (name included).
 * Others are icon-only and need a separate text label.
 */
export function isSidebarBrandWordmark(brand: ProviderBrandId): boolean {
  return brand === "deepseek" || brand === "opencode-go";
}

export const SidebarBrand = memo(function SidebarBrand({
  replaceLogo = false,
  brandId = null,
  label = "Grok",
}: SidebarBrandProps) {
  if (replaceLogo && brandId) {
    if (brandId === "deepseek") {
      return (
        <DeepSeekFullMark
          className="sidebar-brand-mark sidebar-brand-mark--wordmark"
          title="DeepSeek"
        />
      );
    }
    if (brandId === "opencode-go") {
      return (
        <OpenCodeWordmark
          className="sidebar-brand-mark sidebar-brand-mark--wordmark"
          title="OpenCode"
        />
      );
    }
    // Icon-only (Volcengine Ark, Amux, Zhipu): mark + label.
    const display = (label || brandId).trim() || brandId;
    return (
      <>
        <ProviderBrandIcon
          brand={brandId}
          size={SIDEBAR_BRAND_LOGO_HEIGHT}
          className="sidebar-brand-mark sidebar-brand-mark--icon"
          title={display}
        />
        <span className="sidebar-brand-row__label">{display}</span>
      </>
    );
  }

  // Preference off / no known brand: always Grok mark + "Grok" (never the
  // active provider name — that would look like a partial swap).
  // 16px matches sidebar nav item icons (IconScheduled / IconList / …).
  return (
    <>
      <GrokLogo size={16} />
      <span className="sidebar-brand-row__label">Grok</span>
    </>
  );
});
