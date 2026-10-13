/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { AskUserBar } from "./AskUserBar";
import type { AskUserPayload } from "@/lib/session";

afterEach(() => {
  cleanup();
});

const labels = {
  title: "Agent question",
  submit: "Submit",
  cancel: "Dismiss",
  otherPlaceholder: "Type your answer…",
  freeTextHint: "Or type a custom answer",
  multiHint: "Select one or more options",
  close: "Close",
  minimize: "Minimize",
  restore: "Restore",
  pendingChip: "Agent question · awaiting answer",
  autoCancelCountdown: "Auto-dismiss in {seconds}s",
};

function payload(
  questions: AskUserPayload["questions"],
): AskUserPayload {
  return { rpcId: 1, sessionId: "s1", questions };
}

describe("AskUserBar", () => {
  it("renders a composer gate, not a modal overlay", () => {
    render(
      <AskUserBar
        payload={payload([
          {
            id: "q",
            question: "Continue?",
            options: [
              { id: "yes", label: "Yes" },
              { id: "no", label: "No" },
            ],
          },
        ])}
        labels={labels}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(document.querySelector(".overlay")).toBeNull();
    expect(document.querySelector(".ask-user-bar")).not.toBeNull();
    expect(document.querySelector(".ask-user-bar__main")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Continue?" })).toBeInTheDocument();
    expect(screen.queryByText("Agent question")).toBeNull();
  });

  it("does not echo a placeholder as a free-text hint", () => {
    render(
      <AskUserBar
        payload={payload([
          {
            id: "q",
            question: "Write your conclusion",
            options: [],
          },
        ])}
        labels={labels}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Write your conclusion" })).toBeInTheDocument();
    expect(screen.getAllByPlaceholderText("Type your answer…")).toHaveLength(1);
    expect(screen.queryByText("Type your answer…")).toBeNull();
  });

  it("rows short options even when the CLI repeats the label as a description", () => {
    render(
      <AskUserBar
        payload={payload([
          {
            id: "q",
            question: "Continue?",
            options: [
              { id: "yes", label: "Yes", description: "Yes" },
              { id: "no", label: "No", description: "No" },
            ],
          },
        ])}
        labels={labels}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(document.querySelector(".ask-user__options--row")).not.toBeNull();
    expect(screen.getByRole("radio", { name: "Yes" })).toBeInTheDocument();
    expect(screen.queryByText("Yes", { selector: ".ask-user__opt-desc" })).toBeNull();
  });

  it("lays short options out in a row", () => {
    render(
      <AskUserBar
        payload={payload([
          {
            id: "q",
            question: "Continue?",
            options: [
              { id: "yes", label: "Yes" },
              { id: "no", label: "No" },
            ],
          },
        ])}
        labels={labels}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(document.querySelector(".ask-user__options--row")).not.toBeNull();
  });

  it("minimize hides the form without cancelling, then restore keeps the draft", () => {
    const onCancel = vi.fn();
    render(
      <AskUserBar
        payload={payload([
          {
            id: "q",
            question: "Continue?",
            options: [
              { id: "yes", label: "Yes" },
              { id: "no", label: "No" },
            ],
          },
        ])}
        labels={labels}
        onSubmit={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.queryByRole("radio", { name: "Yes" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /awaiting answer/i }));
    expect(screen.getByRole("radio", { name: "Yes" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("submits on Enter after a choice, but not during IME commit", () => {
    const onSubmit = vi.fn();
    render(
      <AskUserBar
        payload={payload([
          {
            id: "q",
            question: "Continue?",
            options: [
              { id: "yes", label: "Yes" },
              { id: "no", label: "No" },
            ],
          },
        ])}
        labels={labels}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    fireEvent.keyDown(document, { key: "Enter", isComposing: true });
    fireEvent.keyDown(document, { key: "Enter", keyCode: 229 });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("Enter inside the free-text textarea does not submit", () => {
    const onSubmit = vi.fn();
    render(
      <AskUserBar
        payload={payload([
          {
            id: "q",
            question: "Continue?",
            options: [{ id: "yes", label: "Yes" }],
          },
        ])}
        labels={labels}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    // Gate becomes submittable once the option is picked…
    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    // …then the user opens the custom-answer textarea to add nuance.
    fireEvent.click(
      screen.getByRole("button", { name: labels.freeTextHint }),
    );
    const textarea = screen.getByRole("textbox");
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
    // Submitting from outside the field still works.
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("Dismiss still cancels the request", () => {
    const onCancel = vi.fn();
    render(
      <AskUserBar
        payload={payload([
          {
            id: "q",
            question: "Continue?",
            options: [{ id: "yes", label: "Yes" }],
          },
        ])}
        labels={labels}
        onSubmit={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
