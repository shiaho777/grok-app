# Sidebar quota → UserMenu design

**Date:** 2026-09-08  
**Status:** Approved (approach A)  
**Related:** #1048 (moved quota to expanded pin); `docs/llm-wiki/account.md`

## Problem

Expanded sidebar shows a full quota / DeepSeek balance **card above** the account footer. Users want that card back **inside** the username pull-up menu (top), and only a **compact remaining value** beside the display name outside.

## Goals

1. Remove the standalone `.sidebar__quota-pin` block from the expanded footer.
2. Beside the username (right of name, still inside the UserMenu trigger): show compact remaining — SuperGrok `89%`, DeepSeek `余额 ¥…` (existing formatters).
3. Put the **full** quota / balance card at the **top** of the UserMenu sheet.
4. Entire footer identity row (avatar + name + compact remain) toggles the menu — no separate click target for Account settings from the compact chip.
5. Settings gear stays on the footer row (unchanged).

## Non-goals

- Main chat / composer / session tree chrome.
- Changing Settings → Account heatmap / full quota panel.
- New i18n product languages beyond existing keys (reuse remain / balance / reset strings).

## Interaction

| Surface | Content | Click |
|---------|---------|--------|
| Footer trigger | Avatar + name + compact remain (or balance) | Toggle UserMenu |
| Footer settings gear | Gear icon | Open Settings (existing) |
| UserMenu top | Full card: plan/reset + bar/% **or** provider balance + refresh | Refresh only where already supported; optional soft open Account is out of scope unless already wired |
| Signed out / unsupported custom | No compact remain; no menu quota block | Menu still opens for theme / login |

## Visual

- **Outside:** single-line `user-meta` — name ellipsis + tabular remain (`sidebar__footer-remain` or equivalent). Low remain (≤10%) keeps danger color. No progress bar outside.
- **Menu top:** reuse `.user-menu__quota` / `.user-menu__balance` styles already in `sidebar.part4.css`. Place above What's New / tour / theme. Separator before menu items.
- Match existing panel solid chrome (dialogs.md); no new OS-default controls.

## Data

- Official: `resolveQuotaPercents` + `formatQuotaRemainLabel` + `formatQuotaResetTime` + `tierLabel` (same as pin today).
- Custom balance providers: `supportsProviderBalance` + `providerBalanceCache` / busy / error + `loadProviderBalance` (refresh in menu).
- Visibility: official signed-in **or** custom route with balance support (same `pinQuota` gate, renamed).

## Files (expected)

- `src/app/WorkbenchSidebar.tsx` — remove pin; compact remain in footer button; pass quota props into UserMenu.
- `src/components/UserMenu.tsx` — optional quota/balance slot at panel top.
- `src/styles/sidebar.part4.css` — footer remain chip; drop or stop using pin rules.
- `src/app/WorkbenchSidebar.footer.test.tsx` (+ UserMenu tests if needed).
- `docs/llm-wiki/account.md` — update Goals §2 pin wording.
- `CHANGELOG.md` Unreleased — one short Fixed/Changed bullet.

## Acceptance

1. Expanded signed-in SuperGrok: name row shows `%`; no pin card; menu top shows plan + reset + bar + remain.
2. DeepSeek active route: name row shows balance line; menu top shows balance + refresh; busy/error states preserved.
3. Clicking remain/name/avatar opens menu (does not call `onAccountSettings`).
4. Signed out: no remain chip; settings gear still present.
5. Footer tests updated and green; account.md matches behavior.

## Rejected alternatives

- **B:** Keep a separate pin row that only opens the menu — still wastes vertical space.
- **C:** Menu-only quota with nothing beside the name — fails the “% beside name” requirement.
- Separate click on remain → Account settings — rejected by product (option 1).
