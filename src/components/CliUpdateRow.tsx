/**
 * Check / install Grok Build CLI updates (`grok update --check --json`).
 * Channel switch (`--alpha` / `--stable`) and version pin (`--version`) for CLI ≥ 0.2.117.
 * Used in Settings → Runtime / About and Doctor → Advanced.
 */

import { useCallback, useEffect, useState } from "react";
import type { MessageKey } from "@/i18n";
import * as api from "@/lib/api";
import {
  canSwitchCliChannel,
  cliChannelLabelKey,
  formatCliUpdateStatus,
  isValidCliVersionPin,
  normalizeCliChannel,
  type CliSwitchableChannel,
} from "@/lib/cliUpdateChannel";
import {
  isAppBehindInstallError,
  isCliUpdateAppBehind,
  stripAppBehindErrorPrefix,
} from "@/lib/cliUpdateAppBehind";
import { GlassModal } from "@/components/GlassModal";

type BusyKind =
  | "check"
  | "install"
  | "switch-stable"
  | "switch-alpha"
  | "pin"
  | null;

type ConfirmAction =
  | { kind: "switch"; channel: CliSwitchableChannel }
  | { kind: "pin"; version: string }
  | {
      kind: "app-behind";
      /** Pending install opts after the user acknowledges App skew (#1009). */
      opts?: api.CliUpdateInstallOpts | null;
      busyKind: BusyKind;
    };

export function CliUpdateRow({
  t,
  cliFound,
  onAfterInstall,
  compact,
  /** Auto-run check once when CLI is available (About / Runtime). */
  autoCheck = false,
}: {
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  cliFound?: boolean;
  onAfterInstall?: () => void;
  /** Tighter layout for Doctor advanced section. */
  compact?: boolean;
  autoCheck?: boolean;
}) {
  const [busy, setBusy] = useState<BusyKind>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<api.CliUpdateCheck | null>(null);
  const [installMsg, setInstallMsg] = useState<string | null>(null);
  const [needsRestart, setNeedsRestart] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);

  const status = result
    ? formatCliUpdateStatus({
        currentVersion: result.currentVersion ?? result.current,
        latestVersion: result.latestVersion ?? result.latest,
        channel: result.channel,
        updateAvailable: result.updateAvailable,
      })
    : null;

  const channel = status?.channel ?? "unknown";

  const check = useCallback(async () => {
    if (!api.isTauri()) {
      setError("not in Tauri");
      return;
    }
    if (cliFound === false) {
      setError(t("settings.cliUpdateNeedCli"));
      setResult(null);
      return;
    }
    setBusy("check");
    setError(null);
    setInstallMsg(null);
    try {
      const r = await api.cliUpdateCheck();
      setResult(r);
      if (r.error) {
        setError(r.error);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }, [cliFound, t]);

  useEffect(() => {
    if (!autoCheck || compact) return;
    if (cliFound === false) return;
    void check();
    // mount / cliFound / autoCheck only
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional one-shot refresh
  }, [autoCheck, compact, cliFound]);

  const runInstall = async (
    opts?: api.CliUpdateInstallOpts | null,
    busyKind: BusyKind = "install",
    acknowledgedAppBehind = false,
  ) => {
    if (!api.isTauri()) {
      setError("not in Tauri");
      return;
    }
    // Soft gate: warn when App is behind before pulling a newer CLI (#1009).
    if (!acknowledgedAppBehind && isCliUpdateAppBehind(result)) {
      setConfirm({ kind: "app-behind", opts: opts ?? null, busyKind });
      return;
    }
    setBusy(busyKind);
    setError(null);
    setInstallMsg(null);
    setConfirm(null);
    const installOpts: api.CliUpdateInstallOpts = {
      ...(opts ?? {}),
      acknowledgeAppBehind: acknowledgedAppBehind || opts?.acknowledgeAppBehind,
    };
    try {
      const r = await api.cliUpdateInstall(installOpts);
      if (r.ok === false) {
        const failMsg = r.message || r.error || "update failed";
        if (isAppBehindInstallError(failMsg) && !acknowledgedAppBehind) {
          setConfirm({ kind: "app-behind", opts: opts ?? null, busyKind });
          return;
        }
        setError(
          isAppBehindInstallError(failMsg)
            ? stripAppBehindErrorPrefix(failMsg)
            : failMsg,
        );
        return;
      }
      const version =
        r.version ||
        opts?.version ||
        result?.latestVersion ||
        result?.latest ||
        "—";
      if (opts?.channel) {
        const ch = normalizeCliChannel(opts.channel);
        setInstallMsg(
          t("settings.cliChannel.switched", {
            channel: t(cliChannelLabelKey(ch)),
            version: String(version),
          }),
        );
      } else if (opts?.version) {
        setInstallMsg(
          t("settings.cliChannel.pinned", {
            version: String(opts.version),
          }),
        );
      } else {
        setInstallMsg(
          t("settings.cliUpdateDone", {
            version: String(version),
          }),
        );
      }
      setNeedsRestart(true);
      try {
        const next = await api.cliUpdateCheck();
        setResult(next);
      } catch {
        if (result) {
          setResult({
            ...result,
            currentVersion: String(version),
            updateAvailable: false,
            channel: opts?.channel
              ? normalizeCliChannel(opts.channel)
              : result.channel,
          });
        }
      }
      onAfterInstall?.();
    } catch (e) {
      if (isAppBehindInstallError(e) && !acknowledgedAppBehind) {
        setConfirm({ kind: "app-behind", opts: opts ?? null, busyKind });
        return;
      }
      setError(
        isAppBehindInstallError(e) ? stripAppBehindErrorPrefix(e) : String(e),
      );
    } finally {
      setBusy(null);
    }
  };

  const restartSessions = async () => {
    setRestarting(true);
    try {
      await api.agentsRecycleAll();
      setNeedsRestart(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setRestarting(false);
    }
  };

  const requestSwitch = (target: CliSwitchableChannel) => {
    if (!canSwitchCliChannel(channel, target)) return;
    setConfirm({ kind: "switch", channel: target });
  };

  const requestPin = () => {
    const v = pinInput.trim();
    if (!isValidCliVersionPin(v)) {
      setError(t("settings.cliChannel.invalidVersion"));
      return;
    }
    setError(null);
    setConfirm({ kind: "pin", version: v });
  };

  const confirmTitle =
    confirm?.kind === "switch"
      ? t("settings.cliChannel.switchConfirmTitle", {
          channel: t(cliChannelLabelKey(confirm.channel)),
        })
      : confirm?.kind === "pin"
        ? t("settings.cliChannel.pinConfirmTitle", {
            version: confirm.version,
          })
        : confirm?.kind === "app-behind"
          ? t("settings.cliUpdate.appBehindTitle")
          : t("settings.cliUpdate");

  const confirmBody =
    confirm?.kind === "switch"
      ? t("settings.cliChannel.switchConfirmMsg", {
          channel: t(cliChannelLabelKey(confirm.channel)),
        })
      : confirm?.kind === "pin"
        ? t("settings.cliChannel.pinConfirmMsg", {
            version: confirm.version,
          })
        : confirm?.kind === "app-behind"
          ? t("settings.cliUpdate.appBehindMsg", {
              app: String(result?.appVersion || "—"),
              latestApp: String(
                result?.latestAppVersion || result?.minAppVersion || "—",
              ),
              minApp: String(result?.minAppVersion || "—"),
              cli: String(
                result?.latestVersion || result?.latest || "—",
              ),
            })
          : "";

  return (
    <div
      className={
        compact
          ? "settings-row settings-row--stack settings-cli-update--compact"
          : "settings-row settings-row--stack"
      }
    >
      <div className="settings-row__text">
        <div className="settings-row__label">{t("settings.cliUpdate")}</div>
        <div className="settings-row__desc">{t("settings.cliUpdateDesc")}</div>
      </div>
      <div className="settings-cli-update">
        {status ? (
          <div className="settings-cli-update__meta" role="status">
            <span className="settings-cli-update__meta-item">
              {t("settings.cliChannel.versionLabel", {
                version: status.current,
              })}
            </span>
            <span
              className={
                "settings-cli-update__channel" +
                (channel === "alpha"
                  ? " is-alpha"
                  : channel === "stable"
                    ? " is-stable"
                    : " is-unknown")
              }
            >
              {t("settings.cliChannel.label", {
                channel: t(cliChannelLabelKey(channel)),
              })}
            </span>
          </div>
        ) : null}

        <div className="settings-cli-update__actions">
          <button
            type="button"
            className="btn btn--solid"
            disabled={busy !== null}
            onClick={() => void check()}
          >
            {busy === "check"
              ? t("settings.cliUpdateChecking")
              : t("settings.cliUpdateCheck")}
          </button>
          {result?.updateAvailable ? (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy !== null}
              onClick={() => void runInstall(null, "install")}
            >
              {busy === "install"
                ? t("settings.cliUpdateInstalling")
                : t("settings.cliUpdateInstall")}
            </button>
          ) : null}
        </div>

        {!compact ? (
          <>
            <div className="settings-cli-update__channel-actions">
              <span className="settings-cli-update__channel-hint">
                {t("settings.cliChannel.switchHint")}
              </span>
              <div className="settings-cli-update__actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={
                    busy !== null || !canSwitchCliChannel(channel, "alpha")
                  }
                  onClick={() => requestSwitch("alpha")}
                  title={t("settings.cliChannel.switchToAlpha")}
                >
                  {busy === "switch-alpha"
                    ? t("settings.cliUpdateInstalling")
                    : t("settings.cliChannel.switchToAlpha")}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={
                    busy !== null || !canSwitchCliChannel(channel, "stable")
                  }
                  onClick={() => requestSwitch("stable")}
                  title={t("settings.cliChannel.switchToStable")}
                >
                  {busy === "switch-stable"
                    ? t("settings.cliUpdateInstalling")
                    : t("settings.cliChannel.switchToStable")}
                </button>
              </div>
            </div>

            <div className="settings-cli-update__pin">
              <label className="settings-cli-update__pin-label" htmlFor="cli-version-pin">
                {t("settings.cliChannel.pinLabel")}
              </label>
              <div className="settings-cli-update__pin-row">
                <input
                  id="cli-version-pin"
                  className="settings-input settings-cli-update__pin-input"
                  value={pinInput}
                  placeholder={t("settings.cliChannel.pinPlaceholder")}
                  disabled={busy !== null}
                  onChange={(e) => setPinInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      requestPin();
                    }
                  }}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={
                    busy !== null || !isValidCliVersionPin(pinInput)
                  }
                  onClick={() => requestPin()}
                >
                  {busy === "pin"
                    ? t("settings.cliUpdateInstalling")
                    : t("settings.cliChannel.pinAction")}
                </button>
              </div>
              <div className="settings-cli-update__pin-hint">
                {t("settings.cliChannel.pinHint")}
              </div>
            </div>
          </>
        ) : null}

        {error ? (
          <div className="settings-cli-update__err" role="alert">
            {result?.updateAvailable || busy === "install"
              ? t("settings.cliUpdateInstallFailed", { error })
              : t("settings.cliUpdateFailed", { error })}
          </div>
        ) : null}
        {installMsg && !error ? (
          <div className="settings-cli-update__status" role="status">
            {installMsg}
          </div>
        ) : null}
        {needsRestart && !error ? (
          <div className="settings-cli-update__status" role="status">
            <span className="settings-cli-update__status-text">
              {t("settings.cliUpdateRestartHint")}
            </span>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={restarting}
              onClick={() => void restartSessions()}
            >
              {restarting
                ? t("settings.cliUpdateRestarting")
                : t("settings.cliUpdateRestartAction")}
            </button>
          </div>
        ) : null}
        {result && !error && !installMsg ? (
          <div
            className={
              "settings-cli-update__status" +
              (result.updateAvailable ? " is-available" : "")
            }
            role="status"
          >
            {result.updateAvailable
              ? t("settings.cliUpdateAvailable", {
                  latest: status?.latest ?? "—",
                  current: status?.current ?? "—",
                })
              : t("settings.cliUpdateLatest", {
                  version: status?.current ?? "—",
                })}
          </div>
        ) : null}
      </div>

      <GlassModal
        open={!!confirm}
        onClose={() => {
          if (busy === null) setConfirm(null);
        }}
        title={confirmTitle}
        size="sm"
        closeLabel={t("common.close")}
        closeOnOverlay={busy === null}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy !== null}
              onClick={() => setConfirm(null)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              disabled={busy !== null}
              onClick={() => {
                if (!confirm) return;
                if (confirm.kind === "switch") {
                  void runInstall(
                    { channel: confirm.channel },
                    confirm.channel === "alpha"
                      ? "switch-alpha"
                      : "switch-stable",
                  );
                } else if (confirm.kind === "pin") {
                  void runInstall(
                    { version: confirm.version },
                    "pin",
                  );
                } else if (confirm.kind === "app-behind") {
                  void runInstall(
                    confirm.opts ?? null,
                    confirm.busyKind ?? "install",
                    true,
                  );
                }
              }}
            >
              {confirm?.kind === "app-behind"
                ? t("settings.cliUpdate.appBehindConfirm")
                : t("settings.cliChannel.confirmAction")}
            </button>
          </>
        }
      >
        <p className="settings-row__desc" style={{ margin: 0 }}>
          {confirmBody}
        </p>
      </GlassModal>
    </div>
  );
}
