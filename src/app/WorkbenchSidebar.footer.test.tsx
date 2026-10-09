/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AccountStatus, CustomProvider } from "@/lib/api";
import { createT } from "@/i18n";
import { WorkbenchSidebar, type WorkbenchSidebarProps } from "./WorkbenchSidebar";

vi.mock("@/lib/floatingMenu", () => ({
  FLOATING_MENU_Z_INDEX: 13_000,
  useFloatingMenu: () => ({
    pos: { top: 100, left: 10 },
    style: { position: "fixed" },
    settled: true,
  }),
}));

vi.mock("@/components/SidebarUpdateButton", () => ({
  SidebarUpdateButton: () => null,
}));

afterEach(cleanup);

const tr = createT("en");

function signedInAccount(): AccountStatus {
  return {
    profile: {
      signedIn: true,
      authMode: "oauth",
      email: "ada@x.ai",
      displayName: "Ada",
      userId: "u1",
      teamId: null,
      principalType: null,
      expiresAt: null,
      expired: false,
      hasRefresh: true,
      oidcIssuer: null,
    },
    hasOfficialKey: false,
    hasRelayKey: false,
    relayBaseUrl: null,
    cliAuthPresent: true,
    cliFound: true,
    cliPath: "/usr/bin/grok",
    channel: "official_oauth",
    billing: {
      available: true,
      source: "remote",
      message: null,
      subscriptionTier: "SuperGrok",
      creditUsagePercent: 11,
      remainingPercent: 89,
      monthlyLimit: null,
      includedUsed: null,
      totalUsed: null,
      prepaidBalance: null,
      onDemandEnabled: null,
      onDemandCap: null,
      onDemandUsed: null,
      billingPeriodStart: null,
      billingPeriodEnd: null,
      resetsAt: "2026-09-07T04:32:00.000Z",
      isUnifiedBillingUser: true,
      products: [],
      manageUrl: "https://grok.com/?_s=usage",
      subscribeUrl: "https://grok.com/supergrok",
      fetchedAt: "2026-09-06T00:00:00.000Z",
    },
    heatmap: [],
    callLogs: [],
    usageManageUrl: "https://grok.com/?_s=usage",
    subscribeUrl: "https://grok.com/supergrok",
  };
}

function deepseekProvider(): CustomProvider {
  return {
    id: "deepseek",
    model: "deepseek-chat",
    baseUrl: "https://api.deepseek.com",
    name: "DeepSeek",
    hasApiKey: true,
    apiBackend: "openai",
    providerMode: "generic",
    isDefault: false,
  };
}

function props(
  override: Partial<WorkbenchSidebarProps> = {},
): WorkbenchSidebarProps {
  return {
    tr,
    locale: "en",
    children: <div>sessions</div>,
    layout: { sidebarCollapsed: false, sidebarWidth: 280 },
    phoneLayout: false,
    sidebarOverlay: false,
    resizingSidebar: false,
    dragZone: null,
    sidebarOpenW: 280,
    sidebarPaint: 280,
    beginSidebarResize: () => undefined,
    dragRegion: "false",
    titlebarMax: {
      onDoubleClick: () => undefined,
      onMouseDown: () => undefined,
    },
    replaceProviderBrandLogo: false,
    customRouteActive: false,
    activeCustomProvider: null,
    mainPane: "chat",
    onOpenSearch: () => undefined,
    onNewChat: () => undefined,
    onNavigateAutomations: () => undefined,
    onNavigateKanban: () => undefined,
    onNavigateRemoteIm: () => undefined,
    showUserMenu: false,
    setShowUserMenu: () => undefined,
    theme: "dark",
    themePreference: "dark",
    account: signedInAccount(),
    accountBusy: false,
    providerBalanceCache: null,
    providerBalanceBusy: false,
    providerBalanceError: null,
    loadProviderBalance: () => undefined,
    applyThemeChoice: () => undefined,
    onSettings: () => undefined,
    onAccountSettings: () => undefined,
    onTutorial: () => undefined,
    onLogin: () => undefined,
    onLogout: () => undefined,
    savedAccounts: [],
    activeAccountId: null,
    accountQuotas: {},
    onSwitchAccount: () => undefined,
    onUserMenuOpened: () => undefined,
    ...override,
  };
}

it("shows compact remain beside the name and opens the user menu from the identity row", () => {
  const setShowUserMenu = vi.fn();
  const onAccountSettings = vi.fn();
  const onSettings = vi.fn();
  render(
    <WorkbenchSidebar
      {...props({
        setShowUserMenu,
        onAccountSettings,
        onSettings,
        showUserMenu: false,
      })}
    />,
  );

  expect(document.querySelector(".sidebar__quota-pin")).toBeNull();
  expect(
    document.querySelector(".sidebar__footer-remain")?.textContent,
  ).toBe("89%");
  expect(screen.getByText("Ada")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(onSettings).toHaveBeenCalledTimes(1);
  expect(onAccountSettings).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
  expect(setShowUserMenu).toHaveBeenCalled();
  expect(onAccountSettings).not.toHaveBeenCalled();
});

it("does not show remain when signed out, but still shows settings", () => {
  const account = signedInAccount();
  account.profile.signedIn = false;
  render(<WorkbenchSidebar {...props({ account })} />);
  expect(document.querySelector(".sidebar__quota-pin")).toBeNull();
  expect(document.querySelector(".sidebar__footer-remain")).toBeNull();
  expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
});

it("shows DeepSeek balance beside the name when the custom route is active", () => {
  render(
    <WorkbenchSidebar
      {...props({
        customRouteActive: true,
        activeCustomProvider: deepseekProvider(),
        providerBalanceCache: {
          providerId: "deepseek",
          fetchedAt: Date.now(),
          result: {
            kind: "balance",
            provider: "deepseek",
            endpoint: "https://api.deepseek.com/user/balance",
            ok: true,
            latencyMs: 12,
            isAvailable: true,
            balances: [
              {
                currency: "CNY",
                totalBalance: "9.55",
                grantedBalance: "0",
                toppedUpBalance: "9.55",
              },
            ],
          },
        },
      })}
    />,
  );

  expect(document.querySelector(".sidebar__quota-pin")).toBeNull();
  expect(
    document.querySelector(".sidebar__footer-remain")?.textContent,
  ).toBe("9.55 CNY");
  expect(screen.getByText("DeepSeek")).toBeTruthy();
});

it("puts the full SuperGrok quota card at the top of the open user menu", () => {
  render(
    <WorkbenchSidebar
      {...props({
        showUserMenu: true,
      })}
    />,
  );

  expect(document.querySelector(".sidebar__quota-pin")).toBeNull();
  const quota = document.querySelector(".user-menu__quota");
  expect(quota).toBeTruthy();
  expect(quota?.textContent).toContain("SuperGrok");
  expect(quota?.textContent).not.toContain("Resets");
  expect(quota?.textContent).toMatch(/\d{2}\/\d{2}/);
  expect(quota?.textContent).toContain("89%");
  expect(document.querySelector(".user-menu__quota .account-quota-bar")).toBeTruthy();
});

it("puts DeepSeek balance + refresh at the top of the open user menu", () => {
  const loadProviderBalance = vi.fn();
  render(
    <WorkbenchSidebar
      {...props({
        showUserMenu: true,
        customRouteActive: true,
        activeCustomProvider: deepseekProvider(),
        loadProviderBalance,
        providerBalanceCache: {
          providerId: "deepseek",
          fetchedAt: Date.now(),
          result: {
            kind: "balance",
            provider: "deepseek",
            endpoint: "https://api.deepseek.com/user/balance",
            ok: true,
            latencyMs: 12,
            isAvailable: true,
            balances: [
              {
                currency: "CNY",
                totalBalance: "9.55",
                grantedBalance: "0",
                toppedUpBalance: "9.55",
              },
            ],
          },
        },
      })}
    />,
  );

  const balance = document.querySelector(".user-menu__balance");
  expect(balance).toBeTruthy();
  expect(balance?.textContent).toContain("9.55 CNY");
  const refresh = screen.getByRole("button", { name: "Refresh balance" });
  fireEvent.click(refresh);
  expect(loadProviderBalance).toHaveBeenCalled();
});
