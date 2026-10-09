import { describe, expect, it } from "vitest";
import {
  isPastSessionDragThreshold,
  isSessionMoveIgnoredTarget,
  SESSION_DRAG_HOLD_MS,
  SESSION_DRAG_MAX_HORIZONTAL_PX,
  SESSION_DRAG_VERTICAL_THRESHOLD_PX,
  sessionDragArmDecision,
  sessionDragDropFromElements,
  sessionDragShouldTrackPointer,
} from "@/hooks/useSidebarSessionMoveDrag";

function rowWithChrome() {
  const actionBtn = document.createElement("button");
  actionBtn.className = "tree-icon-btn";
  const glyph = document.createElement("span");
  actionBtn.appendChild(glyph);
  const actions = document.createElement("span");
  actions.className = "tree-l3__actions";
  actions.appendChild(actionBtn);
  const row = document.createElement("div");
  row.className = "tree-l3";
  const title = document.createElement("span");
  title.className = "tree-l3__title";
  title.textContent = "Chat";
  row.appendChild(title);
  row.appendChild(actions);
  return { actionBtn, glyph, row, title };
}

describe("sidebar attach vs move gestures", () => {
  it("row-body starts move; action chrome does not", () => {
    if (typeof document === "undefined") return;
    const { actionBtn, glyph, row, title } = rowWithChrome();
    expect(isSessionMoveIgnoredTarget(actionBtn)).toBe(true);
    expect(isSessionMoveIgnoredTarget(glyph)).toBe(true);
    expect(isSessionMoveIgnoredTarget(row)).toBe(false);
    expect(isSessionMoveIgnoredTarget(title)).toBe(false);
    expect(document.querySelector(".tree-l3__drag-handle")).toBeNull();
  });

  it("does not treat a click-sized jitter as a drag", () => {
    expect(isPastSessionDragThreshold(0, 0)).toBe(false);
    expect(isPastSessionDragThreshold(3, 3)).toBe(false);
    // Horizontal movement alone never arms, however large (rows are vertical).
    expect(isPastSessionDragThreshold(8, 0)).toBe(false);
    expect(
      isPastSessionDragThreshold(SESSION_DRAG_VERTICAL_THRESHOLD_PX, 0),
    ).toBe(false);
    expect(
      isPastSessionDragThreshold(SESSION_DRAG_VERTICAL_THRESHOLD_PX * 2, 0),
    ).toBe(false);
    // Vertical must clear the threshold…
    expect(
      isPastSessionDragThreshold(0, SESSION_DRAG_VERTICAL_THRESHOLD_PX - 1),
    ).toBe(false);
    expect(
      isPastSessionDragThreshold(0, SESSION_DRAG_VERTICAL_THRESHOLD_PX),
    ).toBe(true);
    // …while horizontal wander stays under the 10px cap.
    expect(
      isPastSessionDragThreshold(
        SESSION_DRAG_MAX_HORIZONTAL_PX - 1,
        SESSION_DRAG_VERTICAL_THRESHOLD_PX,
      ),
    ).toBe(true);
    expect(
      isPastSessionDragThreshold(
        SESSION_DRAG_MAX_HORIZONTAL_PX,
        SESSION_DRAG_VERTICAL_THRESHOLD_PX,
      ),
    ).toBe(false);
  });

  it("does not arm drag chrome on the first-click synthetic jump", () => {
    const horizontalJump = {
      dx: SESSION_DRAG_VERTICAL_THRESHOLD_PX,
      dy: 0,
      buttons: 1,
    };
    // Immediate pointermove after pointerdown (WKWebView / trackpad press).
    expect(sessionDragArmDecision({ ...horizontalJump, elapsedMs: 0 })).toBe(
      "rebase",
    );
    expect(
      sessionDragArmDecision({
        ...horizontalJump,
        elapsedMs: SESSION_DRAG_HOLD_MS - 1,
      }),
    ).toBe("rebase");
    // After the hold window a pure horizontal move must stay a click.
    expect(
      sessionDragArmDecision({
        ...horizontalJump,
        elapsedMs: SESSION_DRAG_HOLD_MS,
      }),
    ).toBe("ignore");
    expect(
      sessionDragArmDecision({ dx: 0, dy: 0, elapsedMs: 200, buttons: 1 }),
    ).toBe("ignore");
    expect(
      sessionDragArmDecision({
        ...horizontalJump,
        elapsedMs: SESSION_DRAG_HOLD_MS,
        buttons: 0,
      }),
    ).toBe("ignore");
  });

  it("arms only on a vertical pull within the horizontal wander cap", () => {
    const vertical = {
      dx: 0,
      dy: SESSION_DRAG_VERTICAL_THRESHOLD_PX,
      buttons: 1,
      elapsedMs: SESSION_DRAG_HOLD_MS,
    };
    expect(sessionDragArmDecision(vertical)).toBe("arm");
    expect(
      sessionDragArmDecision({
        ...vertical,
        dx: SESSION_DRAG_MAX_HORIZONTAL_PX - 1,
      }),
    ).toBe("arm");
    expect(
      sessionDragArmDecision({
        ...vertical,
        dx: SESSION_DRAG_MAX_HORIZONTAL_PX,
      }),
    ).toBe("ignore");
    expect(
      sessionDragArmDecision({
        ...vertical,
        dx: -SESSION_DRAG_MAX_HORIZONTAL_PX,
      }),
    ).toBe("ignore");
    // A small diagonal lean is still a vertical pull.
    expect(
      sessionDragArmDecision({
        dx: 3,
        dy: SESSION_DRAG_VERTICAL_THRESHOLD_PX,
        buttons: 1,
        elapsedMs: SESSION_DRAG_HOLD_MS,
      }),
    ).toBe("arm");
  });

  it("does not arm drag while the workbench is still taking key from the pet", () => {
    expect(sessionDragShouldTrackPointer(false)).toBe(false);
    expect(sessionDragShouldTrackPointer(true)).toBe(true);
    expect(
      sessionDragArmDecision({
        dx: SESSION_DRAG_VERTICAL_THRESHOLD_PX,
        dy: 0,
        elapsedMs: SESSION_DRAG_HOLD_MS,
        buttons: 1,
        activationDuring: true,
      }),
    ).toBe("rebase");
  });

  it("prefers composer attach over project move in the hit stack", () => {
    if (typeof document === "undefined") return;
    const ghost = document.createElement("div");
    ghost.className = "tree-l3 tree-l3--drag-ghost";
    const composer = document.createElement("div");
    composer.setAttribute("data-session-attach", "");
    const inner = document.createElement("div");
    composer.appendChild(inner);
    const project = document.createElement("div");
    project.setAttribute("data-session-drop", "proj-a");
    const orphan = document.createElement("div");
    orphan.setAttribute("data-session-drop", "__orphan__");

    expect(sessionDragDropFromElements([ghost, inner])).toEqual({
      kind: "attach",
      node: composer,
    });
    expect(sessionDragDropFromElements([inner, project])).toEqual({
      kind: "attach",
      node: composer,
    });
    expect(sessionDragDropFromElements([project])).toEqual({
      kind: "move",
      node: project,
      projectId: "proj-a",
    });
    expect(sessionDragDropFromElements([orphan])).toEqual({
      kind: "move",
      node: orphan,
      projectId: null,
    });
    expect(sessionDragDropFromElements([ghost])).toEqual({ kind: "none" });
  });
});
