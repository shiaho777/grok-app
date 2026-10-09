/**
 * PLUGIN-VALIDATE-PRO — pure helpers for `grok plugin validate` UX.
 *
 * Host runs the CLI and returns an envelope; UI classifies outcomes into
 * stable kinds for i18n labels, severity chips, and GlassModal presentation.
 * Soft-fail when the CLI is too old / missing — never invents success.
 */

export type PluginValidateReason = "cli_too_old" | "cli_missing" | string;

/** Envelope from host `plugin_validate` (and pure parse helpers). */
export interface PluginValidateResult {
  ok: boolean;
  messages: string[];
  /** Resolved path that was validated (when known). */
  path?: string | null;
  /** Soft-fail machine reason (e.g. `cli_too_old` when CLI lacks the subcommand). */
  reason?: PluginValidateReason | null;
}

/** Stable outcome kinds for validate UI. */
export type PluginValidateKind =
  | "ok"
  | "cli_too_old"
  | "cli_missing"
  | "empty_source"
  | "path_only"
  | "not_found"
  | "not_a_directory"
  | "no_manifest"
  | "parse_error"
  | "missing_field"
  | "invalid_manifest"
  | "host_only"
  | "host_error"
  | "other";

/** Visual severity for chips / modal / in-row tone. */
export type PluginValidateSeverity = "ok" | "warn" | "err" | "info";

/** Modal / panel presentation model (strings already resolved or English fallback). */
export type PluginValidatePresentation = {
  kind: PluginValidateKind;
  severity: PluginValidateSeverity;
  /** Short headline (kind label). */
  title: string;
  /** One-line summary (often first message or kind label). */
  summary: string;
  /** Multi-line CLI messages joined. */
  detail: string;
  /** Machine reason from host when present. */
  reason: string | null;
  path: string | null;
  messages: string[];
  /** Whether this represents a successful validate. */
  ok: boolean;
  /** Soft-fail: UI should not treat as a hard action error. */
  softFail: boolean;
};

/**
 * Split stdout + stderr into non-empty message lines (stderr first).
 * Pure — used by tests and optional client-side re-parse.
 */
export function parsePluginValidateMessages(
  stdout: string | null | undefined,
  stderr: string | null | undefined,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of [stderr ?? "", stdout ?? ""]) {
    for (const line of part.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/**
 * Build a validate result from raw CLI streams + exit status.
 * Exit code is authoritative for `ok` (informational "no plugin.json" is still ok).
 */
export function parsePluginValidateOutput(
  stdout: string | null | undefined,
  stderr: string | null | undefined,
  exitOk: boolean,
): Pick<PluginValidateResult, "ok" | "messages"> {
  const messages = parsePluginValidateMessages(stdout, stderr);
  return { ok: exitOk, messages };
}

/**
 * Heuristic: old CLI rejects `plugin validate` as an unknown subcommand.
 * Matches clap-style errors from older grok builds.
 */
export function looksLikeUnsupportedPluginValidate(
  stderr: string | null | undefined,
  stdout: string | null | undefined = "",
): boolean {
  const s = `${stderr ?? ""}\n${stdout ?? ""}`.toLowerCase();
  if (!s.trim()) return false;
  if (
    s.includes("unrecognized subcommand") ||
    s.includes("unknown subcommand") ||
    s.includes("unexpected subcommand") ||
    s.includes("invalid subcommand")
  ) {
    return true;
  }
  // `error: unexpected argument 'validate'` / similar
  if (
    s.includes("validate") &&
    (s.includes("unexpected argument") ||
      s.includes("unrecognized") ||
      s.includes("unknown command") ||
      s.includes("unknown argument"))
  ) {
    return true;
  }
  return false;
}

export function isPluginValidateCliTooOld(
  result: Pick<PluginValidateResult, "reason" | "messages"> | null | undefined,
): boolean {
  if (!result) return false;
  if (result.reason === "cli_too_old") return true;
  const joined = (result.messages ?? []).join("\n").toLowerCase();
  return (
    joined.includes("does not support") && joined.includes("plugin validate")
  );
}

/** Soft-fail outcomes (CLI capability / preflight) — not a hard action error. */
export function isPluginValidateSoftFail(
  result: Pick<PluginValidateResult, "reason" | "messages" | "ok"> | null | undefined,
): boolean {
  if (!result || result.ok) return false;
  if (result.reason === "cli_too_old" || result.reason === "cli_missing") {
    return true;
  }
  return isPluginValidateCliTooOld(result);
}

/** Join messages for compact display (panel body / title attribute). */
export function formatPluginValidateMessages(
  messages: string[] | null | undefined,
  fallback = "",
): string {
  const lines = (messages ?? []).map((m) => m.trim()).filter(Boolean);
  if (lines.length === 0) return fallback;
  return lines.join("\n");
}

/**
 * True when install source looks like a local filesystem path
 * (Validate pre-install only makes sense for paths, not git / owner/repo).
 */
export function isLocalPluginPath(raw: string | null | undefined): boolean {
  const s = (raw ?? "").trim();
  if (!s) return false;
  if (/^file:/i.test(s)) return true;
  if (s.startsWith("git@") || s.includes("://")) return false;
  // Absolute / home / relative / Windows drive
  if (
    s.startsWith("/") ||
    s.startsWith("~") ||
    s.startsWith("./") ||
    s.startsWith("../") ||
    s.startsWith(".\\") ||
    s.startsWith("..\\")
  ) {
    return true;
  }
  if (s.length >= 3) {
    const c0 = s.charCodeAt(0);
    const isLetter =
      (c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122);
    if (isLetter && s[1] === ":" && (s[2] === "\\" || s[2] === "/")) {
      return true;
    }
  }
  // Bare name or owner/repo → not a local path for pre-install validate
  return false;
}

/**
 * Prefer installed plugin path for validate; fall back to name.
 * Host also resolves bare names to install paths when possible.
 */
export function pluginValidateTarget(plugin: {
  path?: string | null;
  name: string;
}): string {
  const path = (plugin.path ?? "").trim();
  if (path) return path;
  return plugin.name.trim();
}

// ── Classification (PLUGIN-VALIDATE-PRO) ────────────────────────────────────

/**
 * Classify host envelope into a stable kind.
 * Prefer explicit `reason`, then message heuristics. Never invents ok.
 */
export function classifyPluginValidateResult(
  result: PluginValidateResult | null | undefined,
): PluginValidateKind {
  if (!result) return "other";
  if (result.ok) {
    const joined = (result.messages ?? []).join("\n").toLowerCase();
    if (joined.includes("no plugin.json") || joined.includes("no manifest")) {
      return "no_manifest";
    }
    return "ok";
  }

  const reason = String(result.reason ?? "")
    .trim()
    .toLowerCase();
  if (reason === "cli_too_old") return "cli_too_old";
  if (reason === "cli_missing") return "cli_missing";
  if (reason === "empty_source") return "empty_source";
  if (reason === "path_only") return "path_only";
  if (reason === "host_only") return "host_only";

  if (isPluginValidateCliTooOld(result)) return "cli_too_old";

  const joined = (result.messages ?? []).join("\n").toLowerCase();
  if (!joined.trim()) return "other";

  if (
    joined.includes("does not support") &&
    joined.includes("plugin validate")
  ) {
    return "cli_too_old";
  }
  if (
    joined.includes("cli not found") ||
    joined.includes("command not found") ||
    (joined.includes("no such file or directory") && joined.includes("grok"))
  ) {
    return "cli_missing";
  }
  if (
    joined.includes("not a directory") ||
    joined.includes("is a file") ||
    joined.includes("not a folder")
  ) {
    return "not_a_directory";
  }
  if (
    joined.includes("no such file") ||
    joined.includes("not found") ||
    joined.includes("does not exist") ||
    joined.includes("enoent")
  ) {
    return "not_found";
  }
  if (
    joined.includes("missing field") ||
    joined.includes("missing required")
  ) {
    return "missing_field";
  }
  if (
    joined.includes("failed to parse") ||
    joined.includes("parse error") ||
    joined.includes("invalid json") ||
    (joined.includes("expected") && joined.includes("json"))
  ) {
    return "parse_error";
  }
  if (
    joined.includes("failed to load manifest") ||
    joined.includes("invalid manifest") ||
    joined.includes("plugin.json")
  ) {
    return "invalid_manifest";
  }
  if (joined.includes("no plugin.json") || joined.includes("no manifest")) {
    return "no_manifest";
  }

  return "other";
}

/**
 * Classify a thrown host / invoke error before a result envelope exists.
 */
export function classifyPluginValidateException(
  err: unknown,
): PluginValidateKind {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err ?? "");
  const m = raw.toLowerCase();
  if (!m.trim()) return "host_error";
  if (
    m.includes("not a tauri") ||
    m.includes("not available") ||
    m.includes("requires the desktop") ||
    m.includes("host only")
  ) {
    return "host_only";
  }
  if (
    m.includes("cli not found") ||
    m.includes("command not found") ||
    (m.includes("not found") && m.includes("grok"))
  ) {
    return "cli_missing";
  }
  if (looksLikeUnsupportedPluginValidate(raw, "")) return "cli_too_old";
  if (m.includes("timed out") || m.includes("timeout")) return "other";
  return "host_error";
}

/** Severity for a classified kind (soft-fail capability gaps are warn). */
export function pluginValidateSeverity(
  kind: PluginValidateKind,
): PluginValidateSeverity {
  switch (kind) {
    case "ok":
      return "ok";
    case "no_manifest":
      // Informational OK from CLI (discover without plugin.json) → ok tone when ok,
      // warn when classified from a failed envelope.
      return "info";
    case "cli_too_old":
    case "cli_missing":
    case "empty_source":
    case "path_only":
    case "host_only":
      return "warn";
    case "not_found":
    case "not_a_directory":
    case "parse_error":
    case "missing_field":
    case "invalid_manifest":
    case "host_error":
    case "other":
      return "err";
    default:
      return "err";
  }
}

/**
 * Soft-fail kinds: capability / preflight — do not escalate to hard action error.
 */
export function pluginValidateIsSoftFailKind(kind: PluginValidateKind): boolean {
  return (
    kind === "cli_too_old" ||
    kind === "cli_missing" ||
    kind === "empty_source" ||
    kind === "path_only" ||
    kind === "host_only"
  );
}

export type PluginValidateKindLabels = Partial<
  Record<PluginValidateKind, string>
>;

/** English fallback labels for kinds (UI should prefer i18n). */
export const PLUGIN_VALIDATE_KIND_FALLBACK: Record<PluginValidateKind, string> =
  {
    ok: "Valid",
    cli_too_old: "CLI too old",
    cli_missing: "CLI missing",
    empty_source: "Empty source",
    path_only: "Local path only",
    not_found: "Not found",
    not_a_directory: "Not a directory",
    no_manifest: "No plugin.json",
    parse_error: "Parse error",
    missing_field: "Missing field",
    invalid_manifest: "Invalid manifest",
    host_only: "Desktop host required",
    host_error: "Host error",
    other: "Error",
  };

/** Actionable English hints (UI should prefer i18n). */
export const PLUGIN_VALIDATE_HINT_FALLBACK: Partial<
  Record<PluginValidateKind, string>
> = {
  ok: "Manifest checks passed. Review messages if the CLI printed notes.",
  no_manifest:
    "No plugin.json is required when skills/agents/hooks use standard folders.",
  cli_too_old:
    "Update Grok CLI (`grok update`) and fully restart the app to enable validate.",
  cli_missing: "Install or path the Grok CLI, then retry validate.",
  empty_source: "Enter a local folder path to validate before install.",
  path_only:
    "Pre-install validate works on a local folder path (not git URL or owner/repo).",
  not_found: "Path or plugin name was not found — check install location.",
  not_a_directory: "Point validate at a plugin folder, not a file.",
  parse_error: "Fix plugin.json JSON syntax, then validate again.",
  missing_field: "Add required fields in plugin.json (e.g. name), then retry.",
  invalid_manifest: "Fix the plugin manifest and re-run validate.",
  host_only: "Open the desktop app (Tauri) to run plugin validate.",
  host_error: "Host invoke failed — see detail.",
  other: "Unexpected outcome — see CLI messages.",
};

export function pluginValidateKindLabel(
  kind: PluginValidateKind,
  labels?: PluginValidateKindLabels,
): string {
  return labels?.[kind] ?? PLUGIN_VALIDATE_KIND_FALLBACK[kind] ?? kind;
}

export function pluginValidateHint(
  kind: PluginValidateKind,
  hints?: Partial<Record<PluginValidateKind, string>>,
): string {
  return hints?.[kind] ?? PLUGIN_VALIDATE_HINT_FALLBACK[kind] ?? "";
}

/**
 * Badge class suffix helper for UI (`ok` | `fail` | `muted`).
 * Maps severity → existing ext-badge modifiers.
 */
export function pluginValidateBadgeTone(
  severity: PluginValidateSeverity,
): "ok" | "fail" | "muted" {
  if (severity === "ok") return "ok";
  if (severity === "err") return "fail";
  return "muted";
}

/**
 * CSS modifier for in-row validate panel (`ok` | `warn` | `err`).
 */
export function pluginValidateRowTone(
  severity: PluginValidateSeverity,
): "ok" | "warn" | "err" {
  if (severity === "ok") return "ok";
  if (severity === "err") return "err";
  return "warn";
}

export type BuildPluginValidateLabels = {
  kinds?: PluginValidateKindLabels;
  /** Override title when ok. */
  okTitle?: string;
  /** Override title when failed (generic). */
  failTitle?: string;
  /** Fallback when messages empty. */
  emptyMessages?: string;
};

/**
 * Build GlassModal-ready presentation from a host validate envelope.
 * Honest: `ok` only when host `ok` is true.
 */
export function buildPluginValidatePresentation(
  result: PluginValidateResult | null | undefined,
  labels?: BuildPluginValidateLabels,
): PluginValidatePresentation {
  const kind = classifyPluginValidateResult(result);
  // Successful "no plugin.json" note stays ok-severity (CLI exited 0).
  let severity = pluginValidateSeverity(kind);
  if (result?.ok && kind === "no_manifest") {
    severity = "ok";
  } else if (result?.ok) {
    severity = "ok";
  }
  const kindLabel = pluginValidateKindLabel(kind, labels?.kinds);
  const messages = Array.isArray(result?.messages)
    ? result!.messages.filter((m): m is string => typeof m === "string" && !!m.trim())
    : [];
  const detail = formatPluginValidateMessages(
    messages,
    labels?.emptyMessages ?? "",
  );
  const summary =
    messages[0]?.trim() ||
    (result?.ok
      ? labels?.okTitle ?? kindLabel
      : labels?.failTitle ?? kindLabel);

  let title = kindLabel;
  if (result?.ok) {
    title = labels?.okTitle ?? kindLabel;
  } else if (kind === "other") {
    title = labels?.failTitle ?? kindLabel;
  }

  const softFail =
    !Boolean(result?.ok) &&
    (pluginValidateIsSoftFailKind(kind) || isPluginValidateSoftFail(result));

  return {
    kind,
    severity,
    title,
    summary,
    detail,
    reason: result?.reason != null && result.reason !== ""
      ? String(result.reason)
      : kind !== "ok" && kind !== "other"
        ? kind
        : null,
    path: result?.path ? String(result.path) : null,
    messages,
    ok: Boolean(result?.ok),
    softFail,
  };
}

/**
 * Build presentation for a thrown error (no result envelope).
 */
export function buildPluginValidateExceptionPresentation(
  err: unknown,
  labels?: BuildPluginValidateLabels,
): PluginValidatePresentation {
  const kind = classifyPluginValidateException(err);
  const severity = pluginValidateSeverity(kind);
  const kindLabel = pluginValidateKindLabel(kind, labels?.kinds);
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err ?? "");
  const detail = raw.trim();
  return {
    kind,
    severity,
    title: kindLabel,
    summary: detail || kindLabel,
    detail,
    reason: kind,
    path: null,
    messages: detail ? [detail] : [],
    ok: false,
    softFail: pluginValidateIsSoftFailKind(kind),
  };
}

/**
 * Client preflight for advanced-install Validate (empty / non-local path).
 * Returns a presentation when the client should block the host call.
 */
export function buildPluginValidatePreflightError(
  source: string | null | undefined,
  opts?: {
    isTauri?: boolean;
    emptyMessage?: string;
    pathOnlyMessage?: string;
    hostOnlyMessage?: string;
    labels?: BuildPluginValidateLabels;
  },
): PluginValidatePresentation | null {
  if (opts?.isTauri === false) {
    const kind: PluginValidateKind = "host_only";
    const title =
      opts?.hostOnlyMessage ??
      pluginValidateKindLabel(kind, opts?.labels?.kinds);
    return {
      kind,
      severity: pluginValidateSeverity(kind),
      title,
      summary: title,
      detail: title,
      reason: "host_only",
      path: null,
      messages: [title],
      ok: false,
      softFail: true,
    };
  }
  const s = (source ?? "").trim();
  if (!s) {
    const kind: PluginValidateKind = "empty_source";
    const title =
      opts?.emptyMessage ??
      pluginValidateKindLabel(kind, opts?.labels?.kinds);
    return {
      kind,
      severity: pluginValidateSeverity(kind),
      title,
      summary: title,
      detail: title,
      reason: "empty_source",
      path: null,
      messages: [title],
      ok: false,
      softFail: true,
    };
  }
  if (!isLocalPluginPath(s)) {
    const kind: PluginValidateKind = "path_only";
    const title =
      opts?.pathOnlyMessage ??
      pluginValidateKindLabel(kind, opts?.labels?.kinds);
    return {
      kind,
      severity: pluginValidateSeverity(kind),
      title,
      summary: title,
      detail: title,
      reason: "path_only",
      path: null,
      messages: [title],
      ok: false,
      softFail: true,
    };
  }
  return null;
}

/**
 * Normalize host API result into the pure envelope shape.
 */
export function normalizePluginValidateResult(res: {
  ok?: boolean;
  messages?: unknown;
  path?: string | null;
  reason?: string | null;
}): PluginValidateResult {
  return {
    ok: !!res.ok,
    messages: Array.isArray(res.messages)
      ? res.messages.filter((m): m is string => typeof m === "string")
      : [],
    path: res.path ?? null,
    reason: res.reason ?? null,
  };
}
