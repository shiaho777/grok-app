import { describe, expect, it } from "vitest";
import {
  buildPluginValidateExceptionPresentation,
  buildPluginValidatePreflightError,
  buildPluginValidatePresentation,
  classifyPluginValidateException,
  classifyPluginValidateResult,
  formatPluginValidateMessages,
  isLocalPluginPath,
  isPluginValidateCliTooOld,
  isPluginValidateSoftFail,
  looksLikeUnsupportedPluginValidate,
  normalizePluginValidateResult,
  parsePluginValidateMessages,
  parsePluginValidateOutput,
  pluginValidateBadgeTone,
  pluginValidateHint,
  pluginValidateIsSoftFailKind,
  pluginValidateKindLabel,
  pluginValidateRowTone,
  pluginValidateSeverity,
  pluginValidateTarget,
} from "./pluginValidate";

describe("parsePluginValidateMessages", () => {
  it("splits non-empty lines; stderr before stdout; dedupes", () => {
    expect(
      parsePluginValidateMessages(
        "Plugin manifest is valid.\n  name: demo\n",
        "  name: demo\n",
      ),
    ).toEqual(["name: demo", "Plugin manifest is valid."]);
  });

  it("handles empty / null", () => {
    expect(parsePluginValidateMessages("", "")).toEqual([]);
    expect(parsePluginValidateMessages(null, undefined)).toEqual([]);
  });
});

describe("parsePluginValidateOutput", () => {
  it("ok follows exit status even when messages look soft", () => {
    const noManifest =
      "No plugin.json found. Grok discovers skills, agents, and hooks automatically from standard directories. A manifest is only needed for custom paths or metadata.";
    expect(parsePluginValidateOutput(noManifest, "", true)).toEqual({
      ok: true,
      messages: [noManifest],
    });
  });

  it("failed parse is not ok", () => {
    const err =
      "Error: Failed to load manifest: failed to parse /tmp/bad/plugin.json: missing field `name`";
    const r = parsePluginValidateOutput("", err, false);
    expect(r.ok).toBe(false);
    expect(r.messages[0]).toContain("missing field `name`");
  });
});

describe("looksLikeUnsupportedPluginValidate", () => {
  it("detects clap unrecognized subcommand", () => {
    expect(
      looksLikeUnsupportedPluginValidate(
        "error: unrecognized subcommand 'validate'\n\nUsage: grok plugin [OPTIONS] <COMMAND>",
        "",
      ),
    ).toBe(true);
  });

  it("detects unexpected argument validate", () => {
    expect(
      looksLikeUnsupportedPluginValidate(
        "error: unexpected argument 'validate' found",
        "",
      ),
    ).toBe(true);
  });

  it("ignores normal validate failures", () => {
    expect(
      looksLikeUnsupportedPluginValidate(
        "Error: Not a directory: /nope",
        "",
      ),
    ).toBe(false);
    expect(
      looksLikeUnsupportedPluginValidate(
        "Error: Failed to load manifest: missing field `name`",
        "",
      ),
    ).toBe(false);
  });
});

describe("isPluginValidateCliTooOld / soft-fail", () => {
  it("uses reason field", () => {
    expect(
      isPluginValidateCliTooOld({
        reason: "cli_too_old",
        messages: [],
      }),
    ).toBe(true);
    expect(
      isPluginValidateSoftFail({
        ok: false,
        reason: "cli_too_old",
        messages: [],
      }),
    ).toBe(true);
  });

  it("falls back to message text", () => {
    expect(
      isPluginValidateCliTooOld({
        reason: null,
        messages: [
          "This Grok CLI does not support `plugin validate`. Update the CLI and restart the app.",
        ],
      }),
    ).toBe(true);
  });

  it("cli_missing is soft-fail", () => {
    expect(
      isPluginValidateSoftFail({
        ok: false,
        reason: "cli_missing",
        messages: ["CLI not found"],
      }),
    ).toBe(true);
  });
});

describe("formatPluginValidateMessages", () => {
  it("joins lines and uses fallback", () => {
    expect(formatPluginValidateMessages(["a", "b"])).toBe("a\nb");
    expect(formatPluginValidateMessages([], "none")).toBe("none");
  });
});

describe("isLocalPluginPath", () => {
  it("accepts filesystem paths", () => {
    expect(isLocalPluginPath("/tmp/my-plugin")).toBe(true);
    expect(isLocalPluginPath("~/code/plugin")).toBe(true);
    expect(isLocalPluginPath("file:///tmp/my-plugin")).toBe(true);
    expect(isLocalPluginPath("./plugin")).toBe(true);
    expect(isLocalPluginPath("../plugin")).toBe(true);
    expect(isLocalPluginPath("C:\\Users\\a\\plugin")).toBe(true);
    expect(isLocalPluginPath("D:/plugins/x")).toBe(true);
  });

  it("rejects git / marketplace / bare names", () => {
    expect(isLocalPluginPath("owner/repo")).toBe(false);
    expect(isLocalPluginPath("vercel@xAI Official")).toBe(false);
    expect(isLocalPluginPath("https://github.com/a/b.git")).toBe(false);
    expect(isLocalPluginPath("git@github.com:a/b.git")).toBe(false);
    expect(isLocalPluginPath("chrome-devtools-mcp")).toBe(false);
    expect(isLocalPluginPath("")).toBe(false);
  });
});

describe("pluginValidateTarget", () => {
  it("prefers path over name", () => {
    expect(
      pluginValidateTarget({
        name: "demo",
        path: "/p/demo",
      }),
    ).toBe("/p/demo");
    expect(pluginValidateTarget({ name: "demo", path: null })).toBe("demo");
  });
});

describe("classifyPluginValidateResult", () => {
  it("maps ok / no_manifest / reason soft-fails", () => {
    expect(
      classifyPluginValidateResult({
        ok: true,
        messages: ["Plugin manifest is valid."],
      }),
    ).toBe("ok");
    expect(
      classifyPluginValidateResult({
        ok: true,
        messages: [
          "No plugin.json found. Grok discovers skills automatically.",
        ],
      }),
    ).toBe("no_manifest");
    expect(
      classifyPluginValidateResult({
        ok: false,
        reason: "cli_too_old",
        messages: ["does not support"],
      }),
    ).toBe("cli_too_old");
    expect(
      classifyPluginValidateResult({
        ok: false,
        reason: "cli_missing",
        messages: ["CLI not found"],
      }),
    ).toBe("cli_missing");
  });

  it("classifies message heuristics", () => {
    expect(
      classifyPluginValidateResult({
        ok: false,
        messages: ["Error: Not a directory: /tmp/file"],
      }),
    ).toBe("not_a_directory");
    expect(
      classifyPluginValidateResult({
        ok: false,
        messages: ["Error: Not a directory: /nope"],
      }),
    ).toBe("not_a_directory");
    expect(
      classifyPluginValidateResult({
        ok: false,
        messages: ["Error: path does not exist: /missing"],
      }),
    ).toBe("not_found");
    expect(
      classifyPluginValidateResult({
        ok: false,
        messages: [
          "Error: Failed to load manifest: failed to parse /tmp/bad/plugin.json: missing field `name`",
        ],
      }),
    ).toBe("missing_field");
    expect(
      classifyPluginValidateResult({
        ok: false,
        messages: [
          "Error: Failed to load manifest: failed to parse /tmp/bad/plugin.json: expected value at line 1",
        ],
      }),
    ).toBe("parse_error");
    expect(
      classifyPluginValidateResult({
        ok: false,
        messages: ["Error: Failed to load manifest: invalid structure"],
      }),
    ).toBe("invalid_manifest");
  });

  it("handles null as other", () => {
    expect(classifyPluginValidateResult(null)).toBe("other");
    expect(classifyPluginValidateResult(undefined)).toBe("other");
  });
});

describe("classifyPluginValidateException", () => {
  it("detects host-only / cli missing / cli too old", () => {
    expect(
      classifyPluginValidateException("Validate requires the desktop host"),
    ).toBe("host_only");
    expect(
      classifyPluginValidateException(new Error("not a Tauri window")),
    ).toBe("host_only");
    expect(classifyPluginValidateException("CLI not found: grok")).toBe(
      "cli_missing",
    );
    expect(
      classifyPluginValidateException(
        "error: unrecognized subcommand 'validate'",
      ),
    ).toBe("cli_too_old");
    expect(classifyPluginValidateException("boom")).toBe("host_error");
  });
});

describe("severity / labels / badge / soft-fail kinds", () => {
  it("ok is ok; soft-fail warn; fail err", () => {
    expect(pluginValidateSeverity("ok")).toBe("ok");
    expect(pluginValidateSeverity("cli_too_old")).toBe("warn");
    expect(pluginValidateSeverity("missing_field")).toBe("err");
    expect(pluginValidateBadgeTone("ok")).toBe("ok");
    expect(pluginValidateBadgeTone("warn")).toBe("muted");
    expect(pluginValidateBadgeTone("err")).toBe("fail");
    expect(pluginValidateRowTone("ok")).toBe("ok");
    expect(pluginValidateRowTone("warn")).toBe("warn");
    expect(pluginValidateRowTone("err")).toBe("err");
    expect(pluginValidateIsSoftFailKind("cli_too_old")).toBe(true);
    expect(pluginValidateIsSoftFailKind("parse_error")).toBe(false);
  });

  it("labels and hints resolve with overrides", () => {
    expect(pluginValidateKindLabel("cli_too_old")).toMatch(/CLI too old/i);
    expect(
      pluginValidateKindLabel("cli_too_old", { cli_too_old: "CLI 过旧" }),
    ).toBe("CLI 过旧");
    expect(pluginValidateHint("path_only")).toMatch(/local folder/i);
  });
});

describe("buildPluginValidatePresentation", () => {
  it("surfaces ok, path, messages, severity", () => {
    const p = buildPluginValidatePresentation({
      ok: true,
      messages: ["Plugin manifest is valid.", "name: demo"],
      path: "/p/demo",
    });
    expect(p.ok).toBe(true);
    expect(p.kind).toBe("ok");
    expect(p.severity).toBe("ok");
    expect(p.softFail).toBe(false);
    expect(p.path).toBe("/p/demo");
    expect(p.detail).toContain("Plugin manifest is valid.");
    expect(p.summary).toContain("Plugin manifest is valid.");
  });

  it("ok no_manifest keeps ok severity", () => {
    const p = buildPluginValidatePresentation({
      ok: true,
      messages: ["No plugin.json found. Grok discovers skills…"],
    });
    expect(p.kind).toBe("no_manifest");
    expect(p.ok).toBe(true);
    expect(p.severity).toBe("ok");
  });

  it("cli_too_old is soft-fail warn", () => {
    const p = buildPluginValidatePresentation({
      ok: false,
      reason: "cli_too_old",
      messages: [
        "This Grok CLI does not support `plugin validate`; update CLI.",
      ],
    });
    expect(p.kind).toBe("cli_too_old");
    expect(p.severity).toBe("warn");
    expect(p.softFail).toBe(true);
    expect(p.ok).toBe(false);
  });

  it("exception presentation classifies host errors", () => {
    const p = buildPluginValidateExceptionPresentation(
      new Error("not a Tauri window"),
    );
    expect(p.kind).toBe("host_only");
    expect(p.softFail).toBe(true);
    expect(p.ok).toBe(false);
  });
});

describe("buildPluginValidatePreflightError", () => {
  it("blocks empty / non-local / non-tauri", () => {
    expect(
      buildPluginValidatePreflightError("", { isTauri: true })?.kind,
    ).toBe("empty_source");
    expect(
      buildPluginValidatePreflightError("owner/repo", { isTauri: true })?.kind,
    ).toBe("path_only");
    expect(
      buildPluginValidatePreflightError("/tmp/p", { isTauri: false })?.kind,
    ).toBe("host_only");
    expect(
      buildPluginValidatePreflightError("/tmp/p", { isTauri: true }),
    ).toBe(null);
  });

  it("uses custom messages when provided", () => {
    const p = buildPluginValidatePreflightError("", {
      isTauri: true,
      emptyMessage: "Enter something",
    });
    expect(p?.summary).toBe("Enter something");
  });
});

describe("normalizePluginValidateResult", () => {
  it("coerces host payload", () => {
    expect(
      normalizePluginValidateResult({
        ok: 1 as unknown as boolean,
        messages: ["a", 2, "b"] as unknown as string[],
        path: "/x",
        reason: "cli_too_old",
      }),
    ).toEqual({
      ok: true,
      messages: ["a", "b"],
      path: "/x",
      reason: "cli_too_old",
    });
  });
});
