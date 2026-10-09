/**
 * Soft CLI update notice bar (#238) with App-behind gate (#1009).
 * Owns its own check/busy state so AppWorkbench does not grow.
 */

import { useEffect, useState } from "react";
import type { MessageKey } from "@/i18n";
import * as api from "@/lib/api";
import {
  dismissCliUpdateNotice,
  shouldOfferCliUpdateNotice,
} from "@/lib/cliUpdateNotice";
import {
  isAppBehindInstallError,
  isCliUpdateAppBehind,
  stripAppBehindErrorPrefix,
} from "@/lib/cliUpdateAppBehind";
import type { AppDialog } from "@/lib/app/appDialogTypes";
import { isMirrorClient } from "@/lib/mirrorTransport";

type Offer = {
  current: string;
  latest: string;
  appBehind: boolean;
  appVersion: string;
  latestAppVersion: string;
  minAppVersion: string;
};

export function CliUpdateOfferBar({
  active,
  t,
  setAppDialog,
  showToast,
}: {
  /** When false, hide and do not probe. */
  active: boolean;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  setAppDialog: (dialog: AppDialog | null) => void;
  showToast: (msg: string, ms?: number) => void;
}) {
  const [offer, setOffer] = useState<Offer | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!active || !api.isTauri() || isMirrorClient()) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const r = await api.cliUpdateCheck();
          if (cancelled || r.error || !r.updateAvailable) return;
          const current = String(
            r.currentVersion || r.current || r.version || "",
          ).trim();
          const latest = String(r.latestVersion || r.latest || "").trim();
          if (!latest || !shouldOfferCliUpdateNotice(latest)) return;
          setOffer({
            current: current || "—",
            latest,
            appBehind: isCliUpdateAppBehind(r),
            appVersion: String(r.appVersion || "—"),
            latestAppVersion: String(
              r.latestAppVersion || r.minAppVersion || "—",
            ),
            minAppVersion: String(r.minAppVersion || "—"),
          });
        } catch {
          /* network / CLI missing: silent */
        }
      })();
    }, 4500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active]);

  if (!active || !offer) return null;

  const appBehindDialog = (onConfirm: () => void) => {
    setAppDialog({
      kind: "confirm",
      title: t("settings.cliUpdate.appBehindTitle"),
      message: t("settings.cliUpdate.appBehindMsg", {
        app: offer.appVersion,
        latestApp: offer.latestAppVersion,
        minApp: offer.minAppVersion,
        cli: offer.latest,
      }),
      confirmLabel: t("settings.cliUpdate.appBehindConfirm"),
      onConfirm,
    });
  };

  const doInstall = (acknowledgeAppBehind: boolean) => {
    void (async () => {
      setBusy(true);
      try {
        const r = await api.cliUpdateInstall({ acknowledgeAppBehind });
        if (!r.ok) {
          const failMsg = r.message || "failed";
          if (isAppBehindInstallError(failMsg) && !acknowledgeAppBehind) {
            appBehindDialog(() => doInstall(true));
            return;
          }
          showToast(
            t("settings.cliUpdateInstallFailed", {
              error: isAppBehindInstallError(failMsg)
                ? stripAppBehindErrorPrefix(failMsg)
                : failMsg,
            }),
            4500,
          );
          return;
        }
        dismissCliUpdateNotice(offer.latest);
        setOffer(null);
        try {
          await api.agentsRecycleAll();
        } catch {
          /* soft */
        }
      } catch (e) {
        if (isAppBehindInstallError(e) && !acknowledgeAppBehind) {
          appBehindDialog(() => doInstall(true));
          return;
        }
        showToast(
          t("settings.cliUpdateInstallFailed", {
            error: isAppBehindInstallError(e)
              ? stripAppBehindErrorPrefix(e)
              : String(e),
          }),
          4500,
        );
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <div className="conn-bar cli-update-notice" role="status">
      <span style={{ fontSize: 12, flex: 1 }}>
        {t("cliUpdate.notice", {
          current: offer.current,
          latest: offer.latest,
        })}
      </span>
      <button
        type="button"
        className="btn btn--primary"
        style={{ height: 24, fontSize: 11 }}
        disabled={busy}
        onClick={() => {
          if (offer.appBehind) {
            appBehindDialog(() => doInstall(true));
            return;
          }
          doInstall(false);
        }}
      >
        {busy ? t("settings.cliUpdateInstalling") : t("cliUpdate.action")}
      </button>
      <button
        type="button"
        className="btn btn--ghost"
        style={{ height: 24, fontSize: 11 }}
        disabled={busy}
        onClick={() => {
          dismissCliUpdateNotice(offer.latest);
          setOffer(null);
        }}
      >
        {t("cliUpdate.later")}
      </button>
    </div>
  );
}
