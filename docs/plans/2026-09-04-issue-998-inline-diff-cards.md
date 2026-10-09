# Issue #998 — 气泡内嵌高亮 diff 卡片 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把已有的「本轮改了哪些文件」条升级成接近 Codex 的可展开卡片：气泡内直接看高亮 unified diff；同时修掉点击无法聚焦 Review 文件的 MVP 缺口。

**Architecture:** 不新建 diff 引擎。路径仍来自 assistant timeline 的 edit tools；diff 内容优先查当前会话的 `sessionChanges`（live `before`/`after`）→ `buildUnifiedDiff` + `parseReviewPatch`，渲染复用 Side Workbench Review 的 `sw-review-line--add/del` 样式。无 snippet 时再按需 `gitFileDiff` 回退。侧栏 Review 作为「查看全部 / 打开完整审阅」的二级入口，并补上 `path` 聚焦。

**Tech Stack:** React + 现有 `sessionChanges` / `reviewDiff` / Side Workbench；i18n 15 locales；Vitest；不扩 `App.tsx` / 少动 `AppWorkbench`（props 下传即可）。

**Issue:** [#998](https://github.com/RongleCat/grok-app/issues/998)（已关 MVP；本轮按产品要求补齐内嵌 diff）  
**User choices (locked):**
1. 加强现有卡片 → **气泡内嵌高亮 diff**（更接近 Codex）
2. 点击 chip → **A：打开 Review 并聚焦该文件的高亮 diff**（不要改成 File 全文预览）

---

## 现状与缺口

### 已有（`c548f484` MVP）

- `TurnChangedFiles`：回合结束后 basename chips +「查看全部」
- 数据：`collectTurnModifiedPaths(timelineUnits)`（edit tool + path）
- 点击意图：`onOpenModifiedPath` / `onOpenSessionChanges` → aside `type: "changes"`

### MVP 实测（2026-09-04，用户截图）

- ✅ 文件条出现：`.grok-app-998-mvp-a.txt` / `.grok-app-998-mvp-b.txt`
- ❌ 点击底部文件：侧栏打开 **Review**，但是：
  1. **没有进入该文件预览/聚焦**（`path` 在 `SideWorkbench` / `sideContextOpen` 被丢掉）
  2. Review 显示 **「No changes to review」** 空态（session 工具改动未出现在 Review 列表，或未传入/未匹配）
- 已拍板：**A** — 点文件名应打开 Review 并滚到该文件 **diff**，不是 File 全文 tab

### 关键缺口

1. **点击 path 被丢掉（已确认）**：`onThreadOpenModifiedPath` 传 `{ type: "changes", path }`，但 `SideWorkbench.tsx:328` 只 `openSideTab(..., "review")`，忽略 path；`sideContextOpen.ts:71` 同样不带 path。
2. **Review 空态（已确认）**：点开后无 session/workspace 条目可聚焦——需查 `sessionChanges` 是否到达 ReviewTab，以及新建 untracked 文件是否被过滤。**无列表则聚焦无意义，P0 必须一起修。**
3. **气泡内无 diff**：只有文件名，看不到高亮改动。
4. **无 +/− 统计**：composer chip 有，turn strip 没有。
5. **冷启动**：journal 不持久化 `before`/`after`；历史回合可能只有 path，需 git 回退或诚实空态。

### 明确不做（本轮）

- 点击改成 File 全文预览（已否决 B）
- Host journal 持久化 before/after（大改）
- 气泡内 Accept / Reject hunk
- 回合结束自动弹出 Review（吵）
- 重写 ResourceViewer 主路径

---

## 分阶段交付

| 阶段 | 内容 | 验收 |
|------|------|------|
| **P0（优先）** | 修 path→Review 聚焦 **+** 修 Review 空态（session 改动必须进列表） | 点 `.grok-app-998-mvp-b.txt` → Review 有该文件条目并滚动展开高亮 diff |
| **P1** | 卡片 +/− + 气泡内可展开高亮 diff（sessionChanges） | 本轮 live 编辑后可在气泡内看到 add/del 行 |
| **P2** | 无 snippet 时 `gitFileDiff` 懒加载回退 | 冷启动 / 仅 path 时仍尽量有 diff；失败有空态文案 |
| **P3** | 视觉打磨 + i18n + 回归测试 | 15 locale；单测；手测桌面 |

建议：**先单独落地 P0**（立刻兑现「点文件能看到 diff」），再同批或紧随 P1 气泡内嵌。

## 执行进度（agent 自管）

| 阶段 | 状态 | 提交 |
|------|------|------|
| P0 Review 打开 + path 聚焦 | 进行中→已合 | `1dc8e8fd` … `dbbdb196` |
| P0 空态 / pin / 非 git 可读盘 | **已合** | `e7790077`, `7abf0fede` |
| P1 气泡内嵌可展开 diff | **已合** | — |
| Issue #998 | **已 reopen** | — |

---

### Task 1: 修 Review 聚焦 + 空态（P0）

**Files:**
- Modify: `src/lib/sideContextOpen.ts`
- Modify: `src/components/side-workbench/SideWorkbench.tsx`（`openRequest.type === "changes"` 分支 ~328）
- Modify: `src/components/side-workbench/ReviewTab.tsx`（`focusPath` / `focusToken` + 空态根因）
- Diagnose: `sessionChanges` 如何传入 ReviewTab；新建 untracked / write 工具条目为何未进 `files`
- Test: `src/lib/sideContextOpen.test.ts`（若无则新建）+ Review/sessionChanges 相关测

**Step 1 — 聚焦接线：**
- `resolveSideContextOpen`：`changes` + path 时保留 path（meta / 返回值）
- `SideWorkbench`：开 review 同时把 `openRequest.path` 交给 `ReviewTab` 的 `focusPath` + 递增 `focusToken`
- `ReviewTab`：`focusPath`/`focusToken` 变化 → normalize 后匹配 entry → 现有 `scrollToFile(key)`

**Step 2 — 空态根因（实测阻塞点）：**
- 确认 `AppWorkbench` → SideWorkbench 的 `sessionChanges={sessionChangesById[sid]}` 在点击时非空
- 确认 `buildSessionEntries` 是否漏掉仅有 path、无 before/after 的 write；新建文件应至少以 `after` 或 git untracked 出现
- 若 sessionChanges 有而 UI 空：查 kindFilter / compose 逻辑
- 若 sessionChanges 本身空：查 live `mergeSessionChange` 是否未写入该次 write（timeline 有 path、changes 无）

**Step 3 — 验收场景（复现用户测法）：**
- 再建/改 `.grok-app-998-mvp-*.txt` → 点底部文件 → Review **非空**且滚到该文件 diff

**Step 4:** 单测聚焦 + 空态修复相关纯函数。

**Step 5:** Commit  
`fix(side): Review opens focused file diff from turn changed-files (#998)`

---

### Task 2: 纯函数 — 卡片模型 + diff 解析（P1）

**Files:**
- Modify: `src/lib/turnChangedFiles.ts`
- Modify: `src/lib/turnChangedFiles.test.ts`
- Reuse: `buildUnifiedDiff` / `sessionFileLineDelta`（`sessionChanges.ts`）、`parseReviewPatch`（`reviewDiff.ts`）

**Step 1:** 扩展模型，例如：

```ts
export type TurnChangedFileCard = {
  path: string;
  name: string;
  added: number;
  removed: number;
  /** Unified patch when before/after known; null → need fallback / empty. */
  patch: string | null;
  hasSnippet: boolean;
};
```

**Step 2:** 新增 `buildTurnChangedFileCards(paths, sessionChanges, projectPath?)`：
- 按 path 查 `SessionFileChange`
- 有 before+after（或仅 after）→ `buildUnifiedDiff` + delta
- 无 snippet → `added/removed = 0`，`patch = null`，`hasSnippet = false`

**Step 3:** 写失败→通过的 Vitest（有 snippet / 无 snippet / 多文件顺序）。

**Step 4:** Commit  
`feat(chat): turn changed-file card model with patch deltas (#998)`

---

### Task 3: 可复用迷你 diff 行渲染（P1）

**Files:**
- Create: `src/components/lobe-chat/TurnFileDiffPreview.tsx`（或 `src/components/review/MiniUnifiedDiff.tsx`）
- Modify: `src/components/lobe-chat/lobe-chat.part1.css`（卡片壳）；可复用 `sw-review-line*` class（已在 `side-workbench.part2.css`，全局可用则直接 className，避免复制颜色）
- Test: 轻量 render 测或纯函数测 parse 行数上限

**行为：**
- 输入 `patch: string`
- `parseReviewPatch` → 渲染 add/del/ctx 行
- **截断**：默认最多 ~40 行变更行 +「在 Review 中查看全部」按钮（调用已有 `onOpenPath`）
- 无障碍：`role="region"` + i18n aria

**不要**复制一整份 ReviewTab；只抽行渲染。

**Commit:**  
`feat(chat): mini unified-diff preview for turn file cards (#998)`

---

### Task 4: 升级 `TurnChangedFiles` UI（P1）

**Files:**
- Modify: `src/components/lobe-chat/TurnChangedFiles.tsx`
- Modify: `src/components/lobe-chat/ConversationThread.tsx`（传入 sessionChanges）
- Modify: `src/app/WorkbenchChatStage.tsx` / `ConversationThreadLive` props 链（从已有 `sessionChanges` 下传；**不要**在 AppWorkbench 新堆 useState）
- Modify: `src/i18n/messages/{15}/chat.ts` — 新 key（en 权威，其余锁步）

**交互：**
1. 默认：卡片列表（文件名 + `+a −d`）；仍保留「查看全部」→ Review
2. 点击卡片头：展开/折叠该文件的 `TurnFileDiffPreview`
3. 展开后底部：「在 Review 中打开」→ `onOpenPath(path)`（依赖 Task 1 聚焦）
4. streaming：不渲染（保持现状）
5. 无 patch：展开显示空态文案（`chat.changedFiles.noDiffYet`），仍可「在 Review 中打开」

**i18n 建议 key（en）：**
- `chat.changedFiles.delta` — `+{added} −{removed}`
- `chat.changedFiles.expand` / `collapse`
- `chat.changedFiles.openInReview`
- `chat.changedFiles.noDiffYet`
- `chat.changedFiles.truncated` — `Showing {shown} of {total} lines`
- 已有 `viewAll` / `openFile` / `aria` 可保留

**视觉：** 实色表面（现有 `.lobe-turn-changed`），对齐 lobe-chat / chip，禁止透明菜单；不用 `window.confirm`。

**Commit:**  
`feat(chat): expandable inline diff cards on turn changed files (#998)`

---

### Task 5: git 回退懒加载（P2，推荐同批）

**Files:**
- Modify: `TurnChangedFiles.tsx` 或小 hook `useTurnFileDiffFallback.ts`
- Reuse: `api.gitFileDiff(projectPath, relPath)`（`src/lib/api/fs.ts`）
- Props: `projectPath` + `isGitProject`（Workbench 已有，经 ChatStage 下传）

**逻辑：**
- 仅当用户**展开**且 `!hasSnippet` 且 `isGitProject && projectPath` 时请求
- 成功：用返回 unified / before-after 填 preview
- 失败 / 非 git：空态 + 仍可开 Review（非 git 时 Review 可能 toast — 可改为开 file preview，可选小修）

**注意：** 并发展开多文件要取消过期请求（seq / Abort 风格标志位）。

**Commit:**  
`feat(chat): git diff fallback for turn file cards without snippets (#998)`

---

### Task 6: 回归与手测清单

**自动：**
```bash
pnpm exec vitest run src/lib/turnChangedFiles.test.ts src/lib/reviewDiff.test.ts src/i18n/messages.test.ts
pnpm exec tsc --noEmit
```
（若有 sideContextOpen / Review 新测一并跑）

**手测（Tauri 桌面）：**
1. 新会话让 agent `search_replace` 2+ 文件 → 回合结束出现卡片与 +/−
2. 展开一张 → 气泡内绿/红高亮行
3. 「在 Review 中打开」→ 侧栏 Review 滚到该文件
4. 「查看全部」→ Review 全列表
5. 刷新/重开会话：有 path 芯片；无 snippet 时展开触发 git 回退或空态（不崩）
6. 流式中不出现卡片；结束后出现

**验证约束：** 无浏览器 CDP 时以 Vitest + 上述手测为准；UI 改动声明未做浏览器自动化。

---

### Task 7: 收尾

- 在 #998 留言说明「MVP → 内嵌 diff」已补齐（可 reopen 再 close，或仅评论）
- `git push`（SSH 不稳时用 HTTPS）
- 不改已发版 CHANGELOG 旧节；若临近发版再在未发布节加一句 What's New（短句、无路径）

---

## 数据流（实现后）

```text
timeline edit paths
        │
        ▼
buildTurnChangedFileCards(paths, sessionChanges)
        │
        ├─ has before/after → buildUnifiedDiff → MiniDiff
        └─ else on expand → gitFileDiff → MiniDiff / empty
        │
        └─ "Open in Review" → openRequest{changes, path}
                → SideWorkbench → ReviewTab.scrollToFile
```

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| AppWorkbench 膨胀 | 只加 props 下传；逻辑在 lobe-chat / lib |
| 大 diff 卡顿 | 行数截断 + 「在 Review 查看全部」 |
| 冷启动无 snippet | P2 git 回退 + 诚实空态 |
| 样式分叉 | 复用 `sw-review-line*`，不新造一套色 |

## 成功标准

1. Interaction：展开/折叠、打开 Review 聚焦、空态、streaming 隐藏均可用  
2. Visual：与 lobe-chat / Review 高亮一致，实色卡片  
3. Feature Parity：对话内能看到「改了啥 + 高亮行」，侧栏仍是完整审阅  
