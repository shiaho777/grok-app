//! CLI update check via `grok update --check --json`.
//!
//! ## Install choice
//! When a resolved binary exists, install runs `grok update` so the CLI keeps
//! its channel (stable/alpha) and internal installer. If the binary is missing
//! or `grok update` fails, we fall back to [`crate::cli_install::install_cli_latest`]
//! (multi-mirror + checksum trust chain + progress events) — safer for first-time
//! installs and when self-update is broken.
//!
//! ## Channels (CLI ≥ 0.2.117)
//! `grok update --check --json` may report `channel` (`stable` / `alpha`).
//! Switch with `grok update --alpha` / `--stable`; pin with `--version <V>`.
//! App never invents channels — unknown/missing values surface as unknown.

use std::path::Path;
use std::process::Command;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tracing::{info, warn};

use crate::cli_install::{self, CliInstallResult};
use crate::cli_probe;
use crate::process_util;

const CHECK_TIMEOUT: Duration = Duration::from_secs(45);
const UPDATE_TIMEOUT: Duration = Duration::from_secs(600);

/// Known Grok Build CLI release channels from `grok update --check --json`.
/// Do **not** invent extra channels — only map what the CLI documents.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CliReleaseChannel {
    Stable,
    Alpha,
    /// Missing, empty, or unrecognized — UI shows unknown; no switch flag.
    Unknown,
}

impl CliReleaseChannel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Stable => "stable",
            Self::Alpha => "alpha",
            Self::Unknown => "unknown",
        }
    }

    /// CLI flag for channel switch (`--stable` / `--alpha`), if any.
    pub fn switch_flag(self) -> Option<&'static str> {
        match self {
            Self::Stable => Some("--stable"),
            Self::Alpha => Some("--alpha"),
            Self::Unknown => None,
        }
    }
}

/// Parse a channel string from CLI JSON or user input.
/// Only `stable` / `alpha` (case-insensitive) are recognized — never invent.
pub fn parse_cli_channel(raw: Option<&str>) -> CliReleaseChannel {
    let Some(s) = raw.map(str::trim).filter(|s| !s.is_empty()) else {
        return CliReleaseChannel::Unknown;
    };
    match s.to_ascii_lowercase().as_str() {
        "stable" => CliReleaseChannel::Stable,
        "alpha" => CliReleaseChannel::Alpha,
        _ => CliReleaseChannel::Unknown,
    }
}

/// Absolute App floor for in-app CLI upgrades without acknowledge (#1009).
/// Historical: App 0.2.19 pulling CLI 1.0.x caused recovery / protocol gaps.
/// Bump only when documenting that older Apps must not pull newest CLI alone;
/// day-to-day “App behind” also comes from GitHub `app_check_update`.
pub const MIN_APP_VERSION_FOR_CLI_UPGRADE: (u64, u64, u64) = (0, 2, 20);

/// Prefix for structured soft-fail when App should be updated first (#1009).
pub const APP_BEHIND_ERROR_PREFIX: &str = "APP_BEHIND:";

/// Render [`MIN_APP_VERSION_FOR_CLI_UPGRADE`] as `x.y.z`.
pub fn min_app_version_for_cli_upgrade_str() -> String {
    let (a, b, c) = MIN_APP_VERSION_FOR_CLI_UPGRADE;
    format!("{a}.{b}.{c}")
}

/// True when App semver is below the absolute CLI-upgrade floor.
/// Unparseable versions fail-open (`false`).
pub fn app_version_below_cli_upgrade_floor(app_version: &str) -> bool {
    match crate::app_update::parse_semver(app_version) {
        Some(v) => v < MIN_APP_VERSION_FOR_CLI_UPGRADE,
        None => false,
    }
}

/// Options for `grok update` install / channel switch / version pin.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CliUpdateInstallOpts {
    /// Switch release channel (`stable` / `alpha`). Mutually exclusive with pin.
    pub channel: Option<String>,
    /// Install a specific version (`--version`). Mutually exclusive with channel.
    pub version: Option<String>,
    /// Pass `--force-reinstall` when true.
    pub force: bool,
    /// User confirmed CLI install while App is behind (#1009).
    pub acknowledge_app_behind: bool,
}

/// Validate version pin text for `--version` (semver-ish; no flags/path tricks).
pub fn is_valid_cli_version_pin(raw: &str) -> bool {
    let t = raw.trim();
    if t.is_empty() || t.len() > 64 {
        return false;
    }
    // Reject anything that looks like a CLI flag or path.
    if t.starts_with('-') || t.contains('/') || t.contains('\\') || t.contains(' ') {
        return false;
    }
    // Require at least one digit and only version-ish chars.
    let mut has_digit = false;
    for c in t.chars() {
        if c.is_ascii_digit() {
            has_digit = true;
            continue;
        }
        if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '+' || c == '_' {
            continue;
        }
        return false;
    }
    has_digit
}

/// Build argv after the binary for `grok update …` (without the program name).
/// Pure helper — soft-fails with Err when opts are invalid or invent a channel.
pub fn build_update_args(opts: &CliUpdateInstallOpts) -> Result<Vec<String>, String> {
    let channel_raw = opts
        .channel
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let version_raw = opts
        .version
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    if channel_raw.is_some() && version_raw.is_some() {
        return Err("channel switch and version pin are mutually exclusive".into());
    }

    let mut args: Vec<String> = vec!["update".into()];

    if let Some(ch) = channel_raw {
        let parsed = parse_cli_channel(Some(ch));
        let flag = parsed.switch_flag().ok_or_else(|| {
            format!("unknown CLI channel `{ch}` — only stable and alpha are supported")
        })?;
        args.push(flag.into());
    } else if let Some(ver) = version_raw {
        if !is_valid_cli_version_pin(ver) {
            return Err(format!("invalid CLI version pin: {ver}"));
        }
        args.push("--version".into());
        args.push(ver.to_string());
    }

    if opts.force {
        args.push("--force-reinstall".into());
    }

    Ok(args)
}

/// Parsed `grok update --check --json` payload (camelCase).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CliUpdateCheck {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    /// Raw channel from CLI JSON when present (`stable` / `alpha`); never invented.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub installer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_update: Option<bool>,
    /// CLI-reported error string when present (null in healthy responses).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Resolved binary path used for the check (App-side, not from JSON).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cli_path: Option<String>,
    /// Running App version (`CARGO_PKG_VERSION`) — App-side enrichment (#1009).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_version: Option<String>,
    /// Absolute App floor for CLI upgrades without acknowledge.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_app_version: Option<String>,
    /// Latest App on GitHub when the check could reach releases (#1009).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latest_app_version: Option<String>,
    /// True when GitHub reports a newer App than this binary.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_update_available: Option<bool>,
    /// Soft gate: App below floor and/or newer App available — warn before CLI install.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_behind: Option<bool>,
}

/// Parse stdout from `grok update --check --json` into a typed DTO.
/// Tolerant of extra fields; requires current/latest version strings.
pub fn parse_update_check_json(raw: &str) -> Result<CliUpdateCheck, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("empty update --check output".into());
    }
    // Some builds may print log lines before JSON — take the last JSON object line.
    let json_slice = extract_json_object(trimmed)
        .ok_or_else(|| "update --check output is not JSON".to_string())?;
    let v: Value =
        serde_json::from_str(json_slice).map_err(|e| format!("update --check parse: {e}"))?;
    parse_update_check_value(&v)
}

fn extract_json_object(s: &str) -> Option<&str> {
    let s = s.trim();
    if s.starts_with('{') {
        return Some(s);
    }
    // Walk lines; prefer the last line that looks like a JSON object.
    s.lines()
        .map(str::trim)
        .rfind(|l| l.starts_with('{') && l.ends_with('}'))
        .or_else(|| {
            let start = s.find('{')?;
            let end = s.rfind('}')?;
            if end >= start {
                Some(&s[start..=end])
            } else {
                None
            }
        })
}

fn parse_update_check_value(v: &Value) -> Result<CliUpdateCheck, String> {
    let error = string_field(v, &["error"]).filter(|s| !s.is_empty());
    // Accept camelCase / snake_case / short aliases. Some CLI builds or
    // failure payloads omit latestVersion while still reporting currentVersion.
    let current = string_field(
        v,
        &["currentVersion", "current_version", "current", "version"],
    );
    let latest = string_field(v, &["latestVersion", "latest_version", "latest"]);

    let (current, latest, update_available, error) = match (current, latest) {
        (Some(c), Some(l)) => {
            let available = bool_field(v, &["updateAvailable", "update_available"])
                .unwrap_or_else(|| versions_differ(&c, &l));
            (c, l, available, error)
        }
        (Some(c), None) => {
            // Remote check incomplete: keep UI usable with current. Preserve CLI
            // `error` when present so Settings can surface the real cause.
            (c.clone(), c, false, error)
        }
        (None, Some(l)) => (l.clone(), l, false, error),
        (None, None) => {
            return Err(error.unwrap_or_else(|| {
                "missing currentVersion/latestVersion in update --check JSON".into()
            }));
        }
    };

    // Keep only recognized channel labels from CLI JSON — never invent.
    let channel = string_field(v, &["channel"]).and_then(|c| match parse_cli_channel(Some(&c)) {
        CliReleaseChannel::Unknown => None,
        known => Some(known.as_str().to_string()),
    });
    let installer = string_field(v, &["installer"]);
    let auto_update = bool_field(v, &["autoUpdate", "auto_update"]);

    Ok(CliUpdateCheck {
        current_version: current,
        latest_version: latest,
        update_available,
        channel,
        installer,
        auto_update,
        error,
        cli_path: None,
        app_version: None,
        min_app_version: None,
        latest_app_version: None,
        app_update_available: None,
        app_behind: None,
    })
}

/// Attach App-side compatibility fields for CLI upgrade UX (#1009).
///
/// `latest_app` / `app_update_available` come from a best-effort App update
/// check (may be `None` when GitHub is unreachable). Floor always applies.
pub fn enrich_cli_update_check_app_compat(
    dto: &mut CliUpdateCheck,
    app_version: &str,
    latest_app: Option<&str>,
    app_update_available: Option<bool>,
) {
    dto.app_version = Some(app_version.trim().to_string());
    dto.min_app_version = Some(min_app_version_for_cli_upgrade_str());
    dto.latest_app_version = latest_app
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    dto.app_update_available = app_update_available;
    let floor_hit = app_version_below_cli_upgrade_floor(app_version);
    let remote_behind = app_update_available == Some(true);
    dto.app_behind = Some(floor_hit || remote_behind);
}

/// Build the structured soft-fail used when CLI install is gated (#1009).
pub fn app_behind_install_error(app_version: &str, latest_app: Option<&str>) -> String {
    let min = min_app_version_for_cli_upgrade_str();
    match latest_app.map(str::trim).filter(|s| !s.is_empty()) {
        Some(latest) => format!(
            "{APP_BEHIND_ERROR_PREFIX}App {app_version} → {latest} available (min {min}). Update the App before upgrading CLI, or acknowledge to continue."
        ),
        None => format!(
            "{APP_BEHIND_ERROR_PREFIX}App {app_version} is below min {min} for CLI upgrades. Update the App first, or acknowledge to continue."
        ),
    }
}

fn string_field(v: &Value, keys: &[&str]) -> Option<String> {
    for k in keys {
        let Some(x) = v.get(*k) else { continue };
        if let Some(s) = x.as_str() {
            let t = s.trim();
            if !t.is_empty() && t != "null" {
                return Some(t.to_string());
            }
            continue;
        }
        // Rare: numeric version tokens (coerce so parse does not hard-fail).
        if let Some(n) = x.as_u64() {
            return Some(n.to_string());
        }
        if let Some(n) = x.as_i64() {
            return Some(n.to_string());
        }
    }
    None
}

fn bool_field(v: &Value, keys: &[&str]) -> Option<bool> {
    for k in keys {
        if let Some(b) = v.get(*k).and_then(|x| x.as_bool()) {
            return Some(b);
        }
    }
    None
}

fn versions_differ(a: &str, b: &str) -> bool {
    normalize_ver(a) != normalize_ver(b)
}

fn normalize_ver(s: &str) -> String {
    s.trim().trim_start_matches(['v', 'V']).to_ascii_lowercase()
}

/// Resolve CLI binary and run `update --check --json`.
pub fn check_cli_update(manual_path: Option<&str>) -> Result<CliUpdateCheck, String> {
    let probe = cli_probe::probe_cli(manual_path);
    let path = probe.path.filter(|_| probe.found).ok_or_else(|| {
        "Grok Build CLI not found — install or set the path under Runtime".to_string()
    })?;

    let output = run_cli_with_timeout(
        Path::new(&path),
        &["update", "--check", "--json"],
        CHECK_TIMEOUT,
    )?;
    let mut dto = parse_update_check_json(&output)?;
    dto.cli_path = Some(path);
    // Prefer probe version when JSON omits a usable current version.
    if dto.current_version.is_empty() {
        if let Some(v) = probe.version {
            dto.current_version = strip_grok_prefix(&v);
        }
    }
    Ok(dto)
}

fn strip_grok_prefix(v: &str) -> String {
    let t = v.trim();
    // e.g. "grok 0.2.111" / "Grok Build 0.2.111"
    let lower = t.to_ascii_lowercase();
    for prefix in ["grok build ", "grok "] {
        if lower.starts_with(prefix) {
            return t[prefix.len()..].trim().to_string();
        }
    }
    t.to_string()
}

/// Install / switch CLI: prefer `grok update` (with optional channel/version),
/// else App install trust-chain for plain latest only.
///
/// Channel switch and version pin never fall back to the App trust-chain
/// (which always pulls stable latest). Soft-fail with Err instead.
///
/// When the running App is behind (absolute floor and/or newer App on GitHub),
/// refuse unless `acknowledge_app_behind` (#1009). Network failure on the App
/// check fails open (only the absolute floor still applies).
pub async fn install_cli_update(
    app: tauri::AppHandle,
    opts: CliUpdateInstallOpts,
) -> Result<CliInstallResult, String> {
    let app_ver = env!("CARGO_PKG_VERSION");
    if !opts.acknowledge_app_behind {
        let mut behind = app_version_below_cli_upgrade_floor(app_ver);
        let mut latest_app: Option<String> = None;
        match crate::app_update::check_app_update().await {
            Ok(check) => {
                latest_app = Some(check.latest_version.clone());
                if check.update_available {
                    behind = true;
                }
            }
            Err(e) => {
                warn!("cli_update_install: app update check soft-failed ({e}); floor-only gate");
            }
        }
        if behind {
            return Err(app_behind_install_error(app_ver, latest_app.as_deref()));
        }
    }

    let settings = crate::store::load_settings();
    let manual = settings.manual_cli_path.clone();
    let probe = cli_probe::probe_cli(manual.as_deref());

    let args = build_update_args(&opts)?;
    let specialized = opts.channel.is_some() || opts.version.is_some();
    let args_label = args.join(" ");

    if probe.found {
        if let Some(path) = probe.path.clone() {
            info!("cli_update_install: running `{path} {args_label}`");
            let args_owned = args.clone();
            match tauri::async_runtime::spawn_blocking({
                let path = path.clone();
                move || {
                    let arg_refs: Vec<&str> = args_owned.iter().map(|s| s.as_str()).collect();
                    run_cli_with_timeout(Path::new(&path), &arg_refs, UPDATE_TIMEOUT)
                }
            })
            .await
            {
                Ok(Ok(stdout)) => {
                    // Re-probe after update.
                    let after = cli_probe::probe_cli(manual.as_deref());
                    let version = after
                        .version
                        .map(|v| strip_grok_prefix(&v))
                        .or_else(|| extract_version_hint(&stdout));
                    let message = if let Some(ch) = opts.channel.as_deref() {
                        format!("Switched CLI channel via `grok update --{ch}`")
                    } else if let Some(ver) = opts.version.as_deref() {
                        format!("Installed CLI {ver} via `grok update --version`")
                    } else {
                        "Updated via `grok update`".into()
                    };
                    return Ok(CliInstallResult {
                        ok: true,
                        path: after.path.or(Some(path)),
                        version,
                        mirror_used: Some("grok-update".into()),
                        message,
                        sha256: None,
                        checksum_verified: None,
                    });
                }
                Ok(Err(e)) => {
                    if specialized {
                        // Soft-fail: do not pull stable latest when user asked for channel/version.
                        return Err(format!("grok {args_label} failed: {e}"));
                    }
                    warn!(
                        "cli_update_install: grok update failed ({e}); falling back to install_cli_latest"
                    );
                }
                Err(e) => {
                    if specialized {
                        return Err(format!("grok {args_label} join error: {e}"));
                    }
                    warn!(
                        "cli_update_install: join error ({e}); falling back to install_cli_latest"
                    );
                }
            }
        }
    } else if specialized {
        return Err("Grok Build CLI not found — install or set the path under Runtime".into());
    }

    info!("cli_update_install: using cli_install trust-chain");
    let allow = crate::store::load_settings().allow_unverified_cli_install;
    let result = cli_install::install_cli_latest(app, allow).await?;
    let mut s = crate::store::load_settings();
    s.last_cli_checksum_verified = result.checksum_verified;
    let _ = crate::store::save_settings(&s);
    Ok(result)
}

fn extract_version_hint(stdout: &str) -> Option<String> {
    // Best-effort: look for a semver-looking token after update output.
    for line in stdout.lines() {
        let l = line.trim();
        if l.is_empty() {
            continue;
        }
        for token in l.split_whitespace() {
            let t =
                token.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '.' && c != '-');
            if t.chars().filter(|c| *c == '.').count() >= 1
                && t.chars().next().is_some_and(|c| c.is_ascii_digit())
            {
                return Some(t.to_string());
            }
        }
    }
    None
}

fn run_cli_with_timeout(bin: &Path, args: &[&str], timeout: Duration) -> Result<String, String> {
    let bin = bin.to_path_buf();
    let args_owned: Vec<String> = args.iter().map(|s| (*s).to_string()).collect();
    let args_label = args_owned.join(" ");
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut cmd = Command::new(&bin);
        cmd.args(&args_owned);
        // PATH + HOME (Windows GUI often lacks $HOME; CLI hub / update cache needs it).
        process_util::apply_cli_env_std(&mut cmd);
        // `grok update` downloads over the network — honor the proxy (NEW-02).
        crate::proxy::apply_to_std_command(&mut cmd);
        let result = cmd.output();
        let _ = tx.send(result);
    });

    match rx.recv_timeout(timeout) {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            if !output.status.success() {
                let err = stderr.trim();
                let out = stdout.trim();
                // Some failures still emit JSON on stdout (e.g. network error payload).
                if out.starts_with('{') {
                    return Ok(stdout);
                }
                let msg = if !err.is_empty() {
                    err.chars().take(400).collect()
                } else if !out.is_empty() {
                    out.chars().take(400).collect()
                } else {
                    format!("grok {args_label} exited with {}", output.status)
                };
                return Err(msg);
            }
            if stdout.trim().is_empty() && !stderr.trim().is_empty() {
                // Rare: JSON on stderr
                return Ok(stderr);
            }
            Ok(stdout)
        }
        Ok(Err(e)) => Err(format!("failed to run grok {args_label}: {e}")),
        Err(_) => Err(format!(
            "grok {args_label} timed out after {}s",
            timeout.as_secs()
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_UP_TO_DATE: &str = r#"{
  "currentVersion": "0.2.111",
  "latestVersion": "0.2.111",
  "updateAvailable": false,
  "installer": "internal",
  "channel": "stable",
  "autoUpdate": true,
  "error": null
}"#;

    const SAMPLE_AVAILABLE: &str = r#"{"currentVersion":"0.2.100","latestVersion":"0.2.111","updateAvailable":true,"installer":"internal","channel":"stable","autoUpdate":true,"error":null}"#;

    #[test]
    fn parse_up_to_date_sample() {
        let d = parse_update_check_json(SAMPLE_UP_TO_DATE).unwrap();
        assert_eq!(d.current_version, "0.2.111");
        assert_eq!(d.latest_version, "0.2.111");
        assert!(!d.update_available);
        assert_eq!(d.channel.as_deref(), Some("stable"));
        assert_eq!(d.installer.as_deref(), Some("internal"));
        assert_eq!(d.auto_update, Some(true));
        assert!(d.error.is_none());
    }

    #[test]
    fn parse_update_available_sample() {
        let d = parse_update_check_json(SAMPLE_AVAILABLE).unwrap();
        assert!(d.update_available);
        assert_eq!(d.current_version, "0.2.100");
        assert_eq!(d.latest_version, "0.2.111");
    }

    #[test]
    fn parse_tolerates_log_prefix() {
        let raw = format!("checking…\n{SAMPLE_AVAILABLE}\n");
        let d = parse_update_check_json(&raw).unwrap();
        assert!(d.update_available);
    }

    #[test]
    fn parse_snake_case_keys() {
        let raw = r#"{"current_version":"1.0.0","latest_version":"1.1.0","update_available":true}"#;
        let d = parse_update_check_json(raw).unwrap();
        assert!(d.update_available);
        assert_eq!(d.latest_version, "1.1.0");
    }

    #[test]
    fn parse_infers_available_when_flag_missing() {
        let raw = r#"{"currentVersion":"1.0.0","latestVersion":"1.0.1"}"#;
        let d = parse_update_check_json(raw).unwrap();
        assert!(d.update_available);
    }

    #[test]
    fn parse_rejects_empty() {
        assert!(parse_update_check_json("  ").is_err());
        assert!(parse_update_check_json("not json").is_err());
    }

    #[test]
    fn parse_accepts_short_aliases_latest_and_current() {
        let raw = r#"{"current":"0.2.100","latest":"0.2.111","updateAvailable":true}"#;
        let d = parse_update_check_json(raw).unwrap();
        assert_eq!(d.current_version, "0.2.100");
        assert_eq!(d.latest_version, "0.2.111");
        assert!(d.update_available);
    }

    #[test]
    fn parse_soft_fills_missing_latest_from_current() {
        // Incomplete payload without latestVersion still yields a usable DTO.
        let raw = r#"{"currentVersion":"0.2.117","updateAvailable":false}"#;
        let d = parse_update_check_json(raw).unwrap();
        assert_eq!(d.current_version, "0.2.117");
        assert_eq!(d.latest_version, "0.2.117");
        assert!(!d.update_available);
        assert!(d.error.is_none());
    }

    #[test]
    fn parse_preserves_cli_error_when_latest_missing() {
        let raw = r#"{"currentVersion":"0.2.117","error":"fetch failed"}"#;
        let d = parse_update_check_json(raw).unwrap();
        assert_eq!(d.latest_version, "0.2.117");
        assert_eq!(d.error.as_deref(), Some("fetch failed"));
    }

    #[test]
    fn parse_surfaces_cli_error_when_versions_absent() {
        let raw = r#"{"error":"hub error: neither $GROK_HOME nor $HOME is set"}"#;
        let err = parse_update_check_json(raw).unwrap_err();
        assert!(err.contains("neither $GROK_HOME nor $HOME is set"));
    }

    #[test]
    fn parse_coerces_numeric_version_tokens() {
        let raw = r#"{"currentVersion":1,"latestVersion":2,"updateAvailable":true}"#;
        let d = parse_update_check_json(raw).unwrap();
        assert_eq!(d.current_version, "1");
        assert_eq!(d.latest_version, "2");
    }

    #[test]
    fn extract_json_object_from_mixed() {
        let s = "info: start\n{\"a\":1}\n";
        assert_eq!(extract_json_object(s), Some("{\"a\":1}"));
    }

    #[test]
    fn parse_cli_channel_known_and_unknown() {
        assert_eq!(parse_cli_channel(Some("stable")), CliReleaseChannel::Stable);
        assert_eq!(parse_cli_channel(Some("ALPHA")), CliReleaseChannel::Alpha);
        assert_eq!(
            parse_cli_channel(Some("  alpha  ")),
            CliReleaseChannel::Alpha
        );
        assert_eq!(parse_cli_channel(None), CliReleaseChannel::Unknown);
        assert_eq!(parse_cli_channel(Some("")), CliReleaseChannel::Unknown);
        assert_eq!(parse_cli_channel(Some("beta")), CliReleaseChannel::Unknown);
        assert_eq!(
            parse_cli_channel(Some("nightly")),
            CliReleaseChannel::Unknown
        );
    }

    #[test]
    fn parse_drops_unknown_channel_field() {
        let raw = r#"{"currentVersion":"0.2.117","latestVersion":"0.2.117","updateAvailable":false,"channel":"nightly"}"#;
        let d = parse_update_check_json(raw).unwrap();
        assert!(d.channel.is_none());
    }

    #[test]
    fn parse_normalizes_alpha_channel() {
        let raw = r#"{"currentVersion":"0.2.117","latestVersion":"0.2.118-alpha.1","updateAvailable":true,"channel":"Alpha"}"#;
        let d = parse_update_check_json(raw).unwrap();
        assert_eq!(d.channel.as_deref(), Some("alpha"));
    }

    #[test]
    fn build_update_args_plain_and_force() {
        assert_eq!(
            build_update_args(&CliUpdateInstallOpts::default()).unwrap(),
            vec!["update"]
        );
        assert_eq!(
            build_update_args(&CliUpdateInstallOpts {
                force: true,
                ..Default::default()
            })
            .unwrap(),
            vec!["update", "--force-reinstall"]
        );
    }

    #[test]
    fn build_update_args_channel_switch() {
        assert_eq!(
            build_update_args(&CliUpdateInstallOpts {
                channel: Some("alpha".into()),
                ..Default::default()
            })
            .unwrap(),
            vec!["update", "--alpha"]
        );
        assert_eq!(
            build_update_args(&CliUpdateInstallOpts {
                channel: Some("STABLE".into()),
                force: true,
                ..Default::default()
            })
            .unwrap(),
            vec!["update", "--stable", "--force-reinstall"]
        );
        assert!(build_update_args(&CliUpdateInstallOpts {
            channel: Some("beta".into()),
            ..Default::default()
        })
        .is_err());
    }

    #[test]
    fn build_update_args_version_pin() {
        assert_eq!(
            build_update_args(&CliUpdateInstallOpts {
                version: Some("0.2.117".into()),
                ..Default::default()
            })
            .unwrap(),
            vec!["update", "--version", "0.2.117"]
        );
        assert_eq!(
            build_update_args(&CliUpdateInstallOpts {
                version: Some("0.1.151-alpha.2".into()),
                force: true,
                ..Default::default()
            })
            .unwrap(),
            vec![
                "update",
                "--version",
                "0.1.151-alpha.2",
                "--force-reinstall"
            ]
        );
        assert!(build_update_args(&CliUpdateInstallOpts {
            version: Some("--help".into()),
            ..Default::default()
        })
        .is_err());
        assert!(build_update_args(&CliUpdateInstallOpts {
            version: Some("../etc/passwd".into()),
            ..Default::default()
        })
        .is_err());
    }

    #[test]
    fn build_update_args_rejects_channel_and_version() {
        assert!(build_update_args(&CliUpdateInstallOpts {
            channel: Some("alpha".into()),
            version: Some("0.2.117".into()),
            ..Default::default()
        })
        .is_err());
    }

    #[test]
    fn is_valid_cli_version_pin_samples() {
        assert!(is_valid_cli_version_pin("0.2.117"));
        assert!(is_valid_cli_version_pin("0.1.151-alpha.2"));
        assert!(!is_valid_cli_version_pin(""));
        assert!(!is_valid_cli_version_pin("  "));
        assert!(!is_valid_cli_version_pin("-alpha"));
        assert!(!is_valid_cli_version_pin("a b"));
        assert!(!is_valid_cli_version_pin("no-digits"));
    }

    #[test]
    fn app_version_below_cli_upgrade_floor_samples() {
        assert!(app_version_below_cli_upgrade_floor("0.2.19"));
        assert!(app_version_below_cli_upgrade_floor("v0.2.19"));
        assert!(!app_version_below_cli_upgrade_floor("0.2.20"));
        assert!(!app_version_below_cli_upgrade_floor("0.2.30"));
        assert!(!app_version_below_cli_upgrade_floor("not-a-version"));
    }

    #[test]
    fn enrich_cli_update_check_marks_app_behind() {
        let mut dto = parse_update_check_json(SAMPLE_AVAILABLE).unwrap();
        enrich_cli_update_check_app_compat(&mut dto, "0.2.19", Some("0.2.30"), Some(true));
        assert_eq!(dto.app_version.as_deref(), Some("0.2.19"));
        assert_eq!(dto.latest_app_version.as_deref(), Some("0.2.30"));
        assert_eq!(dto.app_update_available, Some(true));
        assert_eq!(dto.app_behind, Some(true));
        assert_eq!(
            dto.min_app_version.as_deref(),
            Some(min_app_version_for_cli_upgrade_str().as_str())
        );

        let mut ok = parse_update_check_json(SAMPLE_AVAILABLE).unwrap();
        enrich_cli_update_check_app_compat(&mut ok, "0.2.30", Some("0.2.30"), Some(false));
        assert_eq!(ok.app_behind, Some(false));
    }

    #[test]
    fn app_behind_install_error_prefixed() {
        let err = app_behind_install_error("0.2.19", Some("0.2.30"));
        assert!(err.starts_with(APP_BEHIND_ERROR_PREFIX));
        assert!(err.contains("0.2.19"));
        assert!(err.contains("0.2.30"));
    }
}
