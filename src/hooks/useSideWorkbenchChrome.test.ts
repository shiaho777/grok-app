/**
 * @vitest-environment jsdom
 *
 * Side Workbench tab/dock/review verbs live here. Host supplies aside open
 * and toasts. Git probe is a no-op off Tauri unless gitStatus is mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createT } from "@/i18n";
import * as api from "@/lib/api";
import {
  createSideWorkbenchChromeHost,
  useSideWorkbenchChrome,
} from "./useSideWorkbenchChrome";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    isTauri: vi.fn(() => false),
    gitStatus: vi.fn(),
  };
});

type SideResourceTarget = Parameters<
  typeof useSideWorkbenchChrome
>[0]["resourceOpenTarget"];

function setup(opts?: {
  asideCollapsed?: boolean;
  phoneLayout?: boolean;
  resourceOpenTarget?: SideResourceTarget;
}) {
  const host = createSideWorkbenchChromeHost();
  host.tr = createT("en");
  host.showToast = vi.fn();
  host.openAsidePane = vi.fn();
  host.setResourceOpenTarget = vi.fn();
  host.setPlanFocusKey = vi.fn();
  host.asideCollapsed = () => opts?.asideCollapsed ?? true;
  const hostRef = { current: host };
  const hook = renderHook(
    (props: { resourceOpenTarget: SideResourceTarget }) =>
      useSideWorkbenchChrome({
        hostRef,
        projectId: "p1",
        projectPath: "/repo",
        asideCollapsed: opts?.asideCollapsed ?? true,
        phoneLayout: opts?.phoneLayout ?? false,
        resourceOpenTarget: props.resourceOpenTarget ?? null,
      }),
    { initialProps: { resourceOpenTarget: opts?.resourceOpenTarget ?? null } },
  );
  return { ...hook, host };
}

describe("useSideWorkbenchChrome", () => {
  beforeEach(() => {
    vi.mocked(api.isTauri).mockReturnValue(false);
    vi.mocked(api.gitStatus).mockReset();
    vi.mocked(api.gitStatus).mockRejectedValue(new Error("no git"));
  });

  it("openSkills creates a skills tab and opens the aside", () => {
    const { result, host } = setup();
    act(() => {
      result.current.openSkills();
    });
    expect(result.current.sideWorkbench.tabs.some((t) => t.kind === "skills")).toBe(
      true,
    );
    expect(host.openAsidePane).toHaveBeenCalled();
  });

  it("openPlan opens the plan tab and bumps plan focus", () => {
    const { result, host } = setup();
    act(() => {
      result.current.openPlan();
    });
    expect(result.current.sideWorkbench.tabs.some((t) => t.kind === "plan")).toBe(
      true,
    );
    expect(host.openAsidePane).toHaveBeenCalled();
    expect(host.setPlanFocusKey).toHaveBeenCalled();
  });

  it("openPicker(file) creates a files tab", () => {
    const { result, host } = setup();
    act(() => {
      result.current.openPicker("file");
    });
    expect(result.current.sideWorkbench.tabs.some((t) => t.kind === "file")).toBe(
      true,
    );
    expect(result.current.sideWorkbench.treeVisible).toBe(true);
    expect(host.openAsidePane).toHaveBeenCalled();
  });

  it("openPicker(review) is a no-op until git is confirmed", () => {
    const { result } = setup();
    act(() => {
      result.current.openPicker("review");
    });
    expect(result.current.sideWorkbench.tabs).toEqual([]);
  });

  it("openPicker(review) opens after git probe succeeds", async () => {
    vi.mocked(api.gitStatus).mockResolvedValue({
      available: true,
      files: [],
    });
    const { result } = setup();
    await waitFor(() => {
      expect(result.current.sideIsGitProject).toBe(true);
    });
    act(() => {
      result.current.openPicker("review");
    });
    expect(
      result.current.sideWorkbench.tabs.some((t) => t.kind === "review"),
    ).toBe(true);
  });

  it("routes a collapsed-aside file target into a files tab", () => {
    const { result, host, rerender } = setup();
    act(() => {
      rerender({
        resourceOpenTarget: { type: "file", path: "/repo/a.ts", title: "a.ts" },
      });
    });
    expect(result.current.sideWorkbench.tabs.some((t) => t.kind === "file")).toBe(
      true,
    );
    expect(host.openAsidePane).toHaveBeenCalled();
  });

  it("focusReviewPath pins the path and bumps the token", () => {
    const { result } = setup();
    act(() => {
      result.current.focusReviewPath("src/a.ts");
    });
    expect(result.current.reviewFocus?.path).toMatch(/src\/a\.ts$/);
    const token = result.current.reviewFocus?.token ?? 0;
    act(() => {
      result.current.focusReviewPath("src/b.ts");
    });
    expect(result.current.reviewFocus?.token).toBe(token + 1);
    expect(result.current.reviewFocus?.pinnedPaths[0]).toMatch(/src\/b\.ts$/);
  });

  it("onAsideCloseExtras collapses expand and dock", () => {
    const { result } = setup();
    act(() => {
      result.current.setSideWorkbench((s) => ({ ...s, expanded: true }));
      result.current.setSideDockComposer(true);
    });
    act(() => {
      result.current.onAsideCloseExtras();
    });
    expect(result.current.sideWorkbench.expanded).toBe(false);
    expect(result.current.sideDockComposer).toBe(false);
  });
});
