/**
 * @vitest-environment jsdom
 *
 * Regression coverage for the sidebar session row click path: a plain press
 * (and a horizontal-only trackpad twitch) must open the chat, never get
 * swallowed by the session-move drag hook's trailing-click blocker.
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SidebarSessionRow,
  type SidebarSessionRowLabels,
  type SidebarSessionRowSession,
} from "@/components/SidebarSessionRow";
import { useSidebarSessionMoveDrag } from "@/hooks/useSidebarSessionMoveDrag";
import type { SessionRow } from "@/lib/app/sidebarModels";

afterEach(cleanup);

const labels: SidebarSessionRowLabels = {
  unreadAria: "Unread",
  planPendingAria: "Plan awaiting review",
  pinned: "Pinned",
  muted: "Muted",
  noteAria: "Note",
  automationsTag: "Automation",
  working: "Working",
  pin: "Pin",
  unpin: "Unpin",
  archive: "Archive",
  unarchive: "Unarchive",
  menu: "Menu",
  untitled: "Untitled",
  renameLabel: "Rename chat",
  renamePlaceholder: "Chat title",
};

const session: SidebarSessionRowSession = { id: "s1", title: "Hello chat" };

function Harness({ onOpen }: { onOpen: (s: SidebarSessionRowSession) => void }) {
  useSidebarSessionMoveDrag({
    enabled: true,
    sessions: [session as unknown as SessionRow],
    selectedIds: new Set<string>(),
    selectMode: false,
    formatGhost: (n: number, title: string) => (n > 1 ? `${n}` : title),
    onDrop: vi.fn(),
    onAttach: vi.fn(),
  });
  return (
    <div className="sidebar">
      <SidebarSessionRow
        session={session}
        variant="project"
        active={false}
        working={false}
        unread={false}
        checked={false}
        selectMode={false}
        muted={false}
        noteTitle={null}
        worktreeBadge={null}
        labels={labels}
        locale="en"
        showRelativeTime={false}
        onOpen={onOpen}
        onContextMenu={vi.fn()}
        onToggleSelect={vi.fn()}
        onPin={vi.fn()}
        onArchive={vi.fn()}
        onMenu={vi.fn()}
        onRename={vi.fn()}
      />
    </div>
  );
}

function getRow(container: HTMLElement): HTMLElement {
  const row = container.querySelector<HTMLElement>('[data-session-id="s1"]');
  if (!row) throw new Error("row not found");
  return row;
}

describe("SidebarSessionRow click path", () => {
  it("a plain click opens the session without arming a drag", () => {
    const onOpen = vi.fn();
    const { container } = render(<Harness onOpen={onOpen} />);
    const row = getRow(container);
    fireEvent.pointerDown(row, { button: 0, pointerId: 1, clientX: 40, clientY: 40 });
    fireEvent.pointerUp(row, { button: 0, pointerId: 1, clientX: 40, clientY: 40 });
    fireEvent.click(row, { button: 0, detail: 1 });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("a horizontal-only trackpad twitch still opens the session", () => {
    const onOpen = vi.fn();
    const { container } = render(<Harness onOpen={onOpen} />);
    const row = getRow(container);
    fireEvent.pointerDown(row, { button: 0, pointerId: 1, clientX: 40, clientY: 40 });
    // Horizontal jump that previously armed the drag and swallowed the click.
    fireEvent.pointerMove(row, { button: 0, pointerId: 1, clientX: 90, clientY: 40 });
    fireEvent.pointerUp(row, { button: 0, pointerId: 1, clientX: 90, clientY: 40 });
    fireEvent.click(row, { button: 0, detail: 1 });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
