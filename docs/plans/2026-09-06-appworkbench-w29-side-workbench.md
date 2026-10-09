# AppWorkbench 继续拆解 — WP-W29 Side Workbench

**日期**：2026-09-06  
**基线**：`origin/main` @ `f7d4060a`（`fix(worktree): actually run GC on confirm (#1038)`）  
**来源**：HANDOFF `docs/plans/HANDOFF-appworkbench-decomposition.md` · 软件设计哲学（深模块 / 信息隐藏）  
**执行位置**：worktree `D:/code/grok-app-appworkbench-w29-side-workbench` · 分支 `refactor/appworkbench-w29-side-workbench`  
**状态**：W29 代码已在该 worktree 写完、未提交、未开 PR、不 merge `main`

---

## 1. 问题

`src/app/AppWorkbench.tsx` 行数大是症状。根因是**信息未被隐藏**：域的 state / effect / 持久化 / 动词仍堆在 host 顶层。改 Side Workbench 必须在 100+ 个 `useState` 里判断耦合。

约束（不可破）：

- AGENTS.md §7：App shell + AppWorkbench **合计行数只降不升**；新状态进域模块，禁止再往 host 加 `useState` / 大功能块。
- 按**知识归属**抽深 hook（state + effect + persist + 少量动词），不切 80-prop Stage 壳，不按「读-算-写」切浅 helper。
- `files_ge_1000` 闸门 ≤80、顶格；新文件必须 <1000 行。
- 一次一个域。`wwwww` 独立 worktree。禁止 merge `main`，除非用户明确说。
- UI 文案走 `createT` / `t()`；无 `window.confirm` / `prompt` / `alert`。

---

## 2. 同步

`git fetch origin main` 后 `origin/main` 仍是 `f7d4060a`（W28 #1034 + shortcuts #1036 + worktree GC #1038）。W29 worktree 已在该 SHA，**无需 rebase**。

---

## 3. 剩余域（W29 前快照，main @ f7d4060a）

W28 后 host 约 **14416 行 / 122 useState / 75 useEffect**。内聚、可独立隐藏的簇：

| 优先级 | 域 | 自持知识 | 为何现在切 / 不切 |
|--------|----|----------|-------------------|
| **W29（本刀）** | Side Workbench | tabs、dock composer、Review focus、⌘W 关 tab、git 探测、chat→side 路由、项目隔离 | 产品边界清楚；hostRef 晚绑已有 W27/W28 先例 |
| W30 | 会话徽章 | mute / unread / plan-pending 的 Set、localStorage、CustomEvent、tray/dock 计数、clear-all | 下一刀。自持 persist，不碰 chat 正文 |
| W31 | 账号 / 配额 | `account`、loading/busy、heatmap/probe error、loginHint、boot 缓存再 refresh | 已有 `useAccountQuotaAutoRefresh`；host 仍持投影 state |
| W32 | MCP doctor | report / error / loading / focus + `mcpDoctor()` | 弹层已在 chrome overlays，state 仍回流 host |
| W33 | setup / boot | `appGate`、bootDetect*、`setupCliSeed`、`setSetup` | 与 first-run 向导、CLI 探测缠在一起，后切 |
| **留 host** | `sessionChangesById` | chat 线程 + Review 面板共用 | 两边都写都读；抽走会变成双写或 80-prop |
| **留 host** | `gitDirtySummary` | composer chip；W28 经 `applyStatusBranch` 补 branch | 与 worktree chrome 只共享 gitStatus 结果，不是同一产品动作 |

**否决的切法**：再拆 `WorkbenchResourcesAside` 的 props 袋（浅模块，接口成本上升）；把 dock 高度测量塞进 Side hook（测量依赖 `composerWrapRef` / attachments / welcome，是 composer 知识）。

---

## 4. W29 锁定方案

### 4.1 模块

新建 `src/hooks/useSideWorkbenchChrome.ts`（深 hook，对标 `useGitWorktreeChrome` / `useSessionConnect`）：

自持：

- `sideWorkbench` + 项目隔离（已有 `useSideWorkbenchProjectIsolation`，改为 hook 内调用）
- `sideDockComposer` / `sideDockComposerH`
- `sideIsGitProject`（`api.gitStatus` 探测）
- `reviewFocus`（path / token / pinnedPaths）
- `closeActiveSideRequest` + ⌘W / Ctrl+W 监听（`APP_CLOSE_TAB_OR_WINDOW_EVENT`）
- chat `resourceOpenTarget` → `applySideContextOpen` 路由（aside 折叠时开栏并保留 target，#998）

对外动词（host 只调这些）：

`openSkills` · `openPlan` · `openPicker` · `openReview` · `focusReviewPath` · `onAsideCloseExtras` · `onExpandedChange` · `toggleDockComposer` · `consumeCloseActive` · `closeSideTabOrWindow`

### 4.2 hostRef 晚绑

`showToast` / `openAsidePane` / `tr` 声明点分散。沿用 W27 模式：

```ts
type SideWorkbenchChromeHost = {
  tr: TFn;
  showToast: (msg: string, ms?: number) => void;
  openAsidePane: () => void;
  setResourceOpenTarget: Dispatch<SetStateAction<ResourceOpenTarget | null>>;
  setPlanFocusKey: Dispatch<SetStateAction<number>>;
  asideCollapsed: () => boolean; // 读 layoutRef，避免关 tab 读到过期 collapsed
};
```

每轮 render 在 `gitWorktreeHostRef` 填充块旁写入 `sideWorkbenchHostRef`。effects 在 commit 后跑，此时袋已满。

### 4.3 明确仍留 host 的薄封装

| 点 | 原因 |
|----|------|
| `openSideSkillsPanel` | 先关 composer `+` / slash，再 `openSkills()`。关菜单是 composer 知识 |
| dock 高度 `ResizeObserver` | 读 `composerWrapRef`、attachments、welcome。setter 仍来自 hook |
| `onThreadOpenSessionChanges` / `onThreadOpenModifiedPath` | 先 `seedSessionChangesForReview`（host 的 changes 表），再 `openReview` + `focusReviewPath` |
| `sessionChangesById` / `gitDirtySummary` | 见 §3 |

Aside / Main 继续吃 `sideWorkbench` + `setSideWorkbench`（视图要改 tab 条）。本刀不收成 80-prop 壳。

### 4.4 测试

`src/hooks/useSideWorkbenchChrome.test.ts`（jsdom），对标 W28：

1. `openSkills` 建 skills tab 并 `openAsidePane`
2. `openPlan` 建 plan tab 并 bump `setPlanFocusKey`
3. `openPicker("file")` 建 file tab 且 `treeVisible`
4. `openPicker("review")` 在 git 未确认时不建 tab
5. git probe `available: true` 后 review picker 建 tab
6. aside 折叠时 file `resourceOpenTarget` 路由进 files tab
7. `focusReviewPath` pin + token+1
8. `onAsideCloseExtras` 收 expand 与 dock

### 4.5 闸门

实测（W29 接线后）：

| | W28 main | W29 worktree | 新天花板 |
|--|----------|--------------|----------|
| 行数 | 14416 | **14258** | 14650 → **14400** |
| useState | 122 | **116** | 130 → **120** |
| useEffect | 75 | **71** | 80 → **74** |

ledger：`docs/plans/CODE-QUALITY-PROGRESS.md` 追加 W29 行；`HANDOFF` 记本刀并写「下一步会话徽章」。

---

## 5. 已改文件（worktree 现状）

| 文件 | 作用 |
|------|------|
| `src/hooks/useSideWorkbenchChrome.ts` | 新深 hook（未跟踪） |
| `src/hooks/useSideWorkbenchChrome.test.ts` | 8 测（未跟踪） |
| `src/app/AppWorkbench.tsx` | 净删接线；host 只填袋 + 薄封装 |
| `scripts/check-code-quality-gates.py` | 天花板下调 |
| `docs/plans/CODE-QUALITY-PROGRESS.md` | WP-W29 + metrics log |
| `docs/plans/HANDOFF-appworkbench-decomposition.md` | W29 一行 |
| `docs/plans/2026-09-06-appworkbench-w29-side-workbench.md` | 本方案 |

`android/capacitor.settings.gradle` 不存在，`skip-worktree` 跳过。

---

## 6. 验收（W29）

- 改 Side tabs / dock / Review / ⌘W / git 探测 / chat→side 路由，不必打开 host 函数体（host 只填 `sideWorkbenchHostRef`）。
- 行为与抽前一致：非 git 时 review picker 仍不建 tab；#998 带 path 的 changes 开 Review 不弹吓人 toast；⌘W 先关 tab 再关窗。
- `python scripts/check-code-quality-gates.py --mode final` PASS。
- `tsc --noEmit`、eslint（改动文件 `--max-warnings 0`）、相关 vitest（hook 8 + sideWorkbench/sideContextOpen/reviewFocusPaths/sideFloatComposer 共 50）PASS。
- 新文件 <1000 行；`files_ge_1000` 仍 80。
- **不做**：浏览器点选（Tauri；本环境无桌面探测）。用单测代替。

当前 worktree 上列检查已过。

---

## 7. 流程

1. 本方案落在 `docs/plans/2026-09-06-appworkbench-w29-side-workbench.md`。
2. 代码已在该 worktree；不新开第二棵。不 merge `main`。
3. 用户未叫 `cmttt` / 提 issue+PR：默认不提交。需要时再 Conventional Commit，例如 `refactor(workbench): extract Side Workbench chrome`。
4. 本机无 `pi`：按 HANDOFF 记录跳过，不挡本刀。
5. Windows 全量 `pnpm test` 的 CRLF source-guard 与本地 `TaskDialogIndirect` 是环境问题，不以它们为 W29 出口。

---

## 8. 后续（不在本刀）

**W30 会话徽章**（HANDOFF 已写下一步）：

- 新 `useSessionChromeBadges`（名可在动手时按仓库词汇微调）。
- 自持 `mutedSessionIds` / `unreadSessionIds` / `planPendingSessionIds`、storage 事件、`applyClearSessionUnread` / `applyMarkSessionUnread` / `markPlanPendingBadge`、tray/dock `busyCount`。
- host 只把 Set 和动词传给 sidebar / UserMenu。
- `manualUnreadHoldIdsRef` 跟着走（与「当前正在看」绑定，经 hostRef 读 `viewingSessionIdRef`）。

其后 W31 账号配额 → W32 MCP doctor → W33 setup/boot。`sessionChangesById` 与 `gitDirtySummary` 继续留 host，直到 Review 与 composer chip 不再双边写入。
