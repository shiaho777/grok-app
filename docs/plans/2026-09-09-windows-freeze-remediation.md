# Windows Freeze and Session Reliability Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate the identified Windows session freezes, stuck session switches, reconnect stalls, orphaned ACP process trees, and global PTY blocking.

**Architecture:** Session-manager locks will only protect in-memory state. IPC emission and disk I/O will receive owned snapshots and run after those locks are released. Frontend session operations will use bounded deadlines and generation-aware recovery. Windows ACP processes will be launched in a killable process group and terminated recursively; PTY writes will use per-session synchronization.

**Tech Stack:** Rust/Tauri 2, Tokio, parking_lot, Windows process APIs/taskkill, React/TypeScript, Vitest, Cargo tests.

---

### Task 1: Add lock-free event emission helpers

**Files:**
- Modify: `src-tauri/src/session_manager/stream.rs:861-1012`
- Modify: `src-tauri/src/session_manager/events.rs:260-310, 900-945`
- Modify: `src-tauri/src/session_manager/events_bg.rs:130-165, 590-610`
- Modify: `src-tauri/src/mirror/mod.rs:660-676` only if an owned-payload helper is useful
- Test: `src-tauri/src/session_manager/stream.rs` unit tests or a new focused session-manager test module

**Steps:**

1. Introduce an owned `PendingStreamEmitPayload`/event value that contains the session id, message id, text, done flag, kind, and thought phase.
2. Change `flush_pending_stream_emit` to take the pending value from the session and return the payload; it must not call `app.emit`.
3. Add a lock-free `emit_stream_payload(app, payload)` helper that calls `mirror::fanout_event` after the caller releases `inner`, `background`, or `parked` locks.
4. Refactor timer flush, prompt-complete, tool-release, and process-exit paths to collect zero or more payloads under lock, then emit them afterward.
5. Keep journal preparation/commit semantics unchanged; only move WebView/mirror emission outside locks.
6. Add a regression test proving the lock guard is dropped before the emission callback is invoked. Use a test callback or test-only emitter hook rather than timing-based sleeps.
7. Run `cargo test --manifest-path src-tauri/Cargo.toml session_manager --lib`.

### Task 2: Move background journal RMW off the background mutex

**Files:**
- Modify: `src-tauri/src/session_manager/events_bg.rs:400-510`
- Modify: `src-tauri/src/session_manager/stream.rs` for shared persistence helper if needed
- Test: `src-tauri/src/session_manager/events_bg.rs` tests or `src-tauri/src/session_manager/*_test.rs`

**Steps:**

1. Under `background.lock()`, update only lifecycle/accounting fields and clone the minimum journal inputs: app session id, tool id, rendered content, status, and error flag.
2. Remove `load_messages`, `save_messages`, and `append_message` from the lock scope.
3. Reuse the live-path persistence function (`persist_completed_tool_journal`) or extract it into a shared private helper.
4. Schedule the disk RMW with `tauri::async_runtime::spawn_blocking` after releasing `background`.
5. Ensure completion promotion and runtime snapshot emission happen after the state lock is released.
6. Add a test that blocks the journal persistence closure and verifies another background state operation can acquire the mutex.
7. Run the focused Rust tests and the full session-manager test target.

### Task 3: Add bounded session-journal loading and recovery

**Files:**
- Modify: `src/lib/api/session.ts:738-760`
- Modify: `src/lib/sessionJournalHydrate.ts:251` and its options/result types
- Modify: `src/hooks/useSessionNavigation.ts:331-385`
- Test: `src/lib/sessionJournalHydrate.test.ts`
- Test: a new navigation test near existing session navigation tests, if available

**Steps:**

1. Add a reusable frontend `withTimeout`/deadline wrapper for `sessionMessages`, with a dedicated error code/message key through `src/i18n/`.
2. Set the journal-load deadline to a bounded value shorter than the connect deadline (recommended 15 seconds for fast switch; make it a named constant).
3. Preserve the current generation check, but make timeout and rejection return an explicit `timed_out`/`failed` hydrate result.
4. In `openSession`, use `try/finally` so the matching `openingSessionIdRef` and journal loading state are cleared on timeout or failure.
5. Keep cached transcript visible when available; show a recoverable error and allow a later retry/reconcile.
6. Ensure stale requests cannot clear loading state for a newer session.
7. Add tests for success, rejection, never-resolving `sessionMessages`, stale generation, and recovery of `openingSessionIdRef`.
8. Run `pnpm vitest run src/lib/sessionJournalHydrate.test.ts` and `pnpm typecheck`.

### Task 4: Bound connection claims and retry stop

**Files:**
- Modify: `src/hooks/useSessionConnect.ts:203-224, 402-417`
- Modify: `src/lib/api/session.ts:233-238`
- Test: existing `src/lib/sessionConnectTimeout.test.ts` or a new focused hook/API test

**Steps:**

1. Define one named connection-operation deadline and use it for duplicate claim waiting; replace the 120-second polling ceiling with a bounded wait aligned to the actual connect timeout.
2. Prefer a promise/notification-based claim completion mechanism if the existing refs permit it; otherwise retain polling but use a deadline and a final state snapshot.
3. Wrap `sessionStop` in a timeout helper and make `retryAgentConnect` continue to force-connect after timeout.
4. On timeout, release the claim in `finally` and set a localized recoverable error only if the viewed session is still current.
5. Add tests for a never-resolving claim, a never-resolving stop, and successful force-connect after stop timeout.
6. Run the focused Vitest suite and `pnpm typecheck`.

### Task 5: Implement Windows ACP process-tree cleanup

**Files:**
- Modify: `src-tauri/src/process_util.rs:60-90` with reusable Windows process-group/tree helpers
- Modify: `src-tauri/src/acp_client.rs:1650-1665, 3705-3730`
- Modify: `src-tauri/src/session_manager/process.rs:980-1010` to use the shared helper
- Reference: `src-tauri/src/serve.rs:380-395, 500-520`
- Test: Windows-only Rust tests for command flags/helper behavior; keep non-Windows tests compiling

**Steps:**

1. On Windows, set `CREATE_NEW_PROCESS_GROUP` together with `CREATE_NO_WINDOW` when spawning ACP.
2. Store the ACP child PID in the client/session state before handing the child to reader/writer tasks.
3. Implement a Windows tree-kill helper using `taskkill /PID <pid> /T /F`, with stdout/stderr suppressed and bounded execution.
4. Make `AcpClient::kill` close transport state, invoke tree kill, then clear stdin/reader state; preserve the existing kill timeout.
5. Reuse the helper for tracked session-manager children and retain Unix process-group behavior unchanged.
6. Add diagnostic logging with PID and kill result so abnormal exits can be correlated with cleanup failures.
7. Run `cargo test --manifest-path src-tauri/Cargo.toml --lib` on the host and Windows CI/cross-build validation in the Windows pipeline.

### Task 6: Remove the global PTY write critical section

**Files:**
- Modify: `src-tauri/src/pty_host.rs:350-400`
- Modify: `src-tauri/src/commands/terminal.rs:45-70` only if command boundaries need adjustment
- Test: PTY host unit tests, including concurrent session operations

**Steps:**

1. Change the global sessions map to store independently synchronized session handles.
2. In write/resize/kill, lock the map only long enough to clone the target handle; never hold it during `write_all` or flush.
3. Add a per-session write mutex or bounded write operation so writes to one PTY remain ordered without blocking unrelated tabs.
4. Define the Windows write timeout/error behavior and surface a recoverable terminal error when a pipe is backpressured.
5. Add a concurrency test where one session’s writer blocks while another session can still resize or write.
6. Run PTY-focused Rust tests and the full Rust test suite.

### Task 7: Integration, diagnostics, and release gates

**Files:**
- Modify: `docs/llm-wiki/maintain.md` or a new troubleshooting section if operational guidance is needed
- Modify: `CHANGELOG.md` only when the fixes ship
- Test/CI: Windows build and smoke-test workflow

**Steps:**

1. Add structured logs for journal-load timeout, connection-claim timeout, ACP tree-kill, and lock-held durations.
2. Add a Windows smoke matrix covering: long stream output, rapid session switching, retry during connecting, tool subprocess cancellation, abnormal Agent exit, and two PTY tabs.
3. Run `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings`, `pnpm typecheck`, focused Vitest tests, and the full Rust/JS suites.
4. Verify no new UI strings bypass `src/i18n/` and no native dialogs are introduced.
5. Ship in two stages: first lock/IPC and timeout fixes; then process-tree and PTY changes after Windows smoke validation.
6. Update release notes according to `docs/llm-wiki/release.md`; do not tag without the required changelog entry.

