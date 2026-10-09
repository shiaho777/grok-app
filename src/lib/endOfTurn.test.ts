import { describe, expect, it } from "vitest";
import {
  currentTurnHasEndMarker,
  endOfTurnMarkerContent,
  isEndOfTurnMarker,
  mapEndOfTurnReason,
  parseEndOfTurnContent,
} from "./endOfTurn";
import { applyTurnMarker, type ChatMessage } from "./session";

describe("endOfTurn", () => {
  it("maps user stop / stall / error", () => {
    expect(mapEndOfTurnReason("user_stop").reason).toBe("user_stop");
    expect(mapEndOfTurnReason("stall").messageKey).toBe("endOfTurn.stall");
    expect(mapEndOfTurnReason("permission_denied").tone).toBe("error");
    expect(mapEndOfTurnReason("error").reason).toBe("error");
  });

  it("maps hard-end recycle reasons (CLI upgrade / auth / route)", () => {
    expect(mapEndOfTurnReason("cli_upgrade").messageKey).toBe(
      "endOfTurn.cliUpgrade",
    );
    expect(mapEndOfTurnReason("app_update").messageKey).toBe(
      "endOfTurn.appUpdate",
    );
    expect(mapEndOfTurnReason("account_auth").messageKey).toBe(
      "endOfTurn.accountAuth",
    );
    expect(mapEndOfTurnReason("provider_route").messageKey).toBe(
      "endOfTurn.providerRoute",
    );
    expect(mapEndOfTurnReason("models_aux").reason).toBe("provider_route");
    expect(mapEndOfTurnReason("session_data_mode").messageKey).toBe(
      "endOfTurn.sessionDataMode",
    );
    expect(mapEndOfTurnReason("host_exit").messageKey).toBe(
      "endOfTurn.hostExit",
    );
    expect(mapEndOfTurnReason("host_exit").tone).toBe("warning");
    expect(mapEndOfTurnReason("host_exit").reason).toBe("host_exit");
  });

  it("maps permission_rejected alias to permission_denied", () => {
    expect(mapEndOfTurnReason("permission_rejected").reason).toBe(
      "permission_denied",
    );
    expect(mapEndOfTurnReason("unknown_permission").messageKey).toBe(
      "endOfTurn.permissionDenied",
    );
  });

  it("recognizes markers", () => {
    expect(isEndOfTurnMarker("turn_cancelled")).toBe(true);
    expect(isEndOfTurnMarker("turn_end")).toBe(true);
    expect(isEndOfTurnMarker("tool_step")).toBe(false);
  });

  it("parses content", () => {
    expect(parseEndOfTurnContent("turn_end|user_stop")).toBe("user_stop");
    expect(parseEndOfTurnContent("turn_cancelled")).toBe("cancelled");
  });

  it("keeps host journal user_stop reason (history matches live chip)", () => {
    // Host stop: turn_cancelled|user_stop — must not collapse to generic cancelled.
    expect(parseEndOfTurnContent("turn_cancelled|user_stop")).toBe("user_stop");
    expect(
      mapEndOfTurnReason(
        parseEndOfTurnContent("turn_cancelled|user_stop"),
      ).messageKey,
    ).toBe("activity.cancelledByUser");
    expect(
      parseEndOfTurnContent("turn_cancelled|user_stop|partial:hello"),
    ).toBe("user_stop");
    expect(parseEndOfTurnContent("turn_cancelled|agent_exit")).toBe(
      "agent_exit",
    );
    expect(parseEndOfTurnContent("turn_cancelled|host_exit")).toBe("host_exit");
    expect(parseEndOfTurnContent("turn_end|stall")).toBe("stall");
  });

  it("history parses hard-end reasons same as live reasonOverride", () => {
    const cases: Array<[string, string]> = [
      ["turn_cancelled|cli_upgrade", "cli_upgrade"],
      ["turn_cancelled|permission_denied", "permission_denied"],
      ["turn_cancelled|cancelled", "cancelled"],
      ["turn_cancelled|account_auth", "account_auth"],
      ["turn_cancelled|host_exit", "host_exit"],
      ["turn_end|provider_route", "provider_route"],
    ];
    for (const [content, reason] of cases) {
      const parsed = parseEndOfTurnContent(content);
      expect(parsed).toBe(reason);
      // Same chip model whether FE uses content or toolStatus/reasonOverride.
      expect(mapEndOfTurnReason(parsed).reason).toBe(
        mapEndOfTurnReason(reason).reason,
      );
    }
  });

  it("detects an end marker only in the current turn", () => {
    const messages: ChatMessage[] = [
      { id: "u0", role: "user", content: "first" },
      { id: "a0", role: "assistant", content: "ok" },
      {
        id: "end0",
        role: "tool",
        content: endOfTurnMarkerContent("user_stop"),
        marker: "turn_end",
        toolStatus: "user_stop",
      },
      { id: "u1", role: "user", content: "second" },
      { id: "a1", role: "assistant", content: "", streaming: true },
    ];
    expect(currentTurnHasEndMarker(messages)).toBe(false);
    messages.push({
      id: "end1",
      role: "tool",
      content: endOfTurnMarkerContent("user_stop"),
      marker: "turn_end",
      toolStatus: "user_stop",
    });
    expect(currentTurnHasEndMarker(messages)).toBe(true);
  });

  it("applyTurnMarker does not double user_stop in the same turn", () => {
    let messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "hi" },
      { id: "a1", role: "assistant", content: "hello", streaming: true },
    ];
    messages = applyTurnMarker(messages, {
      messageId: "end-local",
      marker: "turn_end",
      reason: "user_stop",
      content: endOfTurnMarkerContent("user_stop"),
    });
    expect(messages.filter((m) => isEndOfTurnMarker(m.marker))).toHaveLength(1);

    // Host late marker with a different id must not add a second chip.
    const again = applyTurnMarker(messages, {
      messageId: "end-host",
      marker: "turn_cancelled",
      reason: "user_stop",
      content: "turn_cancelled|user_stop",
    });
    expect(again.filter((m) => isEndOfTurnMarker(m.marker))).toHaveLength(1);
    expect(again).toBe(messages);
  });
});
