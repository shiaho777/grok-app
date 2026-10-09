# Sidebar quota in UserMenu Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move the expanded-sidebar quota pin into the UserMenu top; show compact remaining % / DeepSeek balance beside the username; whole identity row opens the menu.

**Architecture:** WorkbenchSidebar owns quota/balance data and renders a compact remain next to the name inside the existing UserMenu trigger. UserMenu gains an optional header slot (quota or balance) above What's New. Remove `.sidebar__quota-pin`. Update account.md + footer tests.

**Tech Stack:** React + Vitest (jsdom), existing `formatQuotaRemainLabel` / `formatProviderBalanceLine`, CSS in `sidebar.part4.css`.

**Design:** `docs/plans/2026-09-08-sidebar-quota-in-usermenu-design.md`

---

### Task 1: Failing footer tests for new layout

**Files:**
- Modify: `src/app/WorkbenchSidebar.footer.test.tsx`

**Step 1: Rewrite the pin test to the new contract**

Replace `pins plan + reset…` with expectations:

```tsx
it("shows compact remain beside the name and opens the user menu from the identity row", () => {
  const setShowUserMenu = vi.fn();
  const onAccountSettings = vi.fn();
  render(
    <WorkbenchSidebar
      {...props({
        setShowUserMenu,
        onAccountSettings,
        showUserMenu: false,
      })}
    />,
  );

  expect(document.querySelector(".sidebar__quota-pin")).toBeNull();
  expect(
    document.querySelector(".sidebar__footer-remain")?.textContent,
  ).toBe("89%");
  expect(screen.getByText("Ada")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: /Ada|user|menu/i }));
  // Prefer querying the footer identity button:
  // screen.getByRole("button", { name: tr("user.menu") }) if Tip/aria-label wraps it.
  expect(onAccountSettings).not.toHaveBeenCalled();
});
```

Keep signed-out test: no pin, no remain chip, settings present.

Add DeepSeek-style case using a mock custom provider that `supportsProviderBalance` accepts + `providerBalanceCache` with a known line (assert `.sidebar__footer-remain` contains the formatted balance, no pin).

**Step 2: Run tests — expect FAIL**

```bash
pnpm exec vitest run src/app/WorkbenchSidebar.footer.test.tsx
```

Expected: FAIL (pin still present / no `.sidebar__footer-remain`).

**Step 3: Commit tests only**

```bash
git add src/app/WorkbenchSidebar.footer.test.tsx
git commit -m "test(sidebar): expect compact remain beside name, no quota pin"
```

---

### Task 2: Compact remain in sidebar footer trigger

**Files:**
- Modify: `src/app/WorkbenchSidebar.tsx` (footer / pin section ~409–560)
- Modify: `src/styles/sidebar.part4.css`

**Step 1: Remove pin button block**

Delete the `{pinQuota ? ( <button className="sidebar__quota-pin" …/> ) : null}` block.

**Step 2: Inside `.sidebar__footer` button `user-meta`, after name**

```tsx
{(pinQuota && pinRemain) || remainBusyPlaceholder ? (
  <span
    className={
      "sidebar__footer-remain" + (remainLow ? " is-low" : "")
    }
  >
    {pinRemain /* or busy ellipsis for provider balance */}
  </span>
) : null}
```

Use existing `pinRemain` / `remainLow` / `pinQuota`. For provider busy with no cache, show a short `…` or existing busy hint — do not invent new i18n if a dash/`…` is enough.

Ensure the Tip/aria-label for the footer button still works (identity opens menu).

**Step 3: CSS**

Add:

```css
.user-meta {
  /* ensure row: name + remain */
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}
.sidebar__footer-remain {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}
.sidebar__footer-remain.is-low {
  color: var(--danger, #e25555);
}
```

Leave `.sidebar__quota-pin*` rules in place unused or delete if nothing else references them.

**Step 4: Run footer tests**

```bash
pnpm exec vitest run src/app/WorkbenchSidebar.footer.test.tsx
```

Expected: compact-remain assertions PASS; menu-quota tests may still fail until Task 3.

**Step 5: Commit**

```bash
git add src/app/WorkbenchSidebar.tsx src/styles/sidebar.part4.css
git commit -m "fix(sidebar): show compact quota beside username, remove pin"
```

---

### Task 3: Full quota / balance block at UserMenu top

**Files:**
- Modify: `src/components/UserMenu.tsx`
- Modify: `src/app/WorkbenchSidebar.tsx` (pass props)
- Modify: `src/components/UserMenu.test.tsx` if present; else extend footer test with `showUserMenu: true`

**Step 1: Extend `UserMenuProps`**

Add optional:

```ts
quotaHeader?: ReactNode; // or structured props:
// officialQuota?: { plan; resetText; remainLabel; usedPercent; remainingPercent } | null
// providerBalance?: { line; busy; error; onRefresh } | null
```

Prefer **structured props** so UserMenu owns markup/classes (`.user-menu__quota`, `.user-menu__balance`, refresh button) and matches existing CSS.

Pass from WorkbenchSidebar:

- Official signed-in: plan, reset, remain, bar fill class, used %
- Custom balance: formatted line, busy, error string, `loadProviderBalance` as onRefresh
- Labels: reuse `tr("account.resetsAt")`, refresh string if already in i18n (`account.refresh` / provider balance refresh key — grep existing)

**Step 2: Render at top of portal panel**

Before What's New:

```tsx
{quotaBlock}
{quotaBlock ? <div className="user-menu__sep" role="separator" /> : null}
```

Use existing separator class if any (`user-menu__flyout-sep` pattern or border on quota container).

Refresh button: `type="button"`, does **not** call `onClose` before refresh (keep menu open while loading) unless current product already closes — match AccountPanel/prior menu behavior (grep `loadProviderBalance` / `user-menu__balance-refresh`).

**Step 3: Tests**

With `showUserMenu: true`, assert `.user-menu__quota` or `.user-menu__balance` in document (portal). Assert pin still absent.

**Step 4: Run**

```bash
pnpm exec vitest run src/app/WorkbenchSidebar.footer.test.tsx src/components/UserMenu.test.tsx
```

**Step 5: Commit**

```bash
git add src/components/UserMenu.tsx src/app/WorkbenchSidebar.tsx src/app/WorkbenchSidebar.footer.test.tsx
git commit -m "feat(user-menu): restore full quota card at menu top"
```

---

### Task 4: Docs + CHANGELOG

**Files:**
- Modify: `docs/llm-wiki/account.md` Goals §2
- Modify: `CHANGELOG.md` Unreleased

**Step 1: account.md**

Replace expanded pin wording with:

- Sidebar footer identity: name + compact remain % / custom balance; click opens user menu.
- User menu sheet top: full quota or provider balance (+ refresh); then what's new / theme / login.

**Step 2: CHANGELOG**

EN (≤90 char first sentence):

`- Account quota sits in the user menu again, with remaining % beside the name.`

ZH:

`- 额度卡片回到用户菜单顶部，名字旁显示剩余百分比。`

**Step 3: whatsNew + targeted tests**

```bash
pnpm exec vitest run src/lib/whatsNew.test.ts src/app/WorkbenchSidebar.footer.test.tsx
```

**Step 4: Commit + push**

```bash
git add docs/llm-wiki/account.md CHANGELOG.md docs/plans/2026-09-08-sidebar-quota-in-usermenu-design.md docs/plans/2026-09-08-sidebar-quota-in-usermenu.md
git commit -m "docs: sidebar quota lives in user menu again"
git push origin HEAD
```

---

### Task 5: Smoke checklist (manual / browser if available)

1. Official SuperGrok signed-in: `%` beside name; menu top has plan + bar.
2. DeepSeek route: balance beside name; menu top has balance + refresh.
3. Click remain → menu opens; Settings gear still works.
4. Signed out: no remain; login in menu.
5. Collapsed sidebar / phone: no regression on footer if still rendered.
