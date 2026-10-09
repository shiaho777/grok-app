/**
 * Settings → Extensions → Plugins: install from a local folder, git URL, or owner/repo.
 */

import { useMemo, type KeyboardEvent, type RefObject } from "react";
import { createT, type Locale } from "@/i18n";
import { IconFolder } from "@/components/icons";
import {
  isLocalPluginPath,
  pluginValidateBadgeTone,
  pluginValidateHint,
  pluginValidateKindLabel,
  type PluginValidateKind,
  type PluginValidatePresentation,
} from "@/lib/pluginValidate";
import { normalizePluginInstallSource } from "@/lib/extensionsUi";

export type PluginPathInstallCardProps = {
  locale: Locale;
  source: string;
  onSourceChange: (next: string) => void;
  disabled: boolean;
  installing: boolean;
  validating: boolean;
  formError: string | null;
  validatePresentation: PluginValidatePresentation | null;
  kindLabels: Partial<Record<PluginValidateKind, string>>;
  kindHints: Partial<Record<PluginValidateKind, string>>;
  onBrowse: () => void;
  onValidate: () => void;
  onInstall: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
};

export function PluginPathInstallCard({
  locale,
  source,
  onSourceChange,
  disabled,
  installing,
  validating,
  formError,
  validatePresentation,
  kindLabels,
  kindHints,
  onBrowse,
  onValidate,
  onInstall,
  inputRef,
}: PluginPathInstallCardProps) {
  const tr = useMemo(() => createT(locale), [locale]);
  const normalized = normalizePluginInstallSource(source);
  const canSubmit = !!normalized && !disabled && !installing && !validating;
  const canValidate =
    !disabled && !installing && !validating && isLocalPluginPath(normalized);
  const busy = installing || validating;

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    if (e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (canSubmit) onInstall();
  };

  return (
    <div className="ext-plugin-install">
      <label
        className="ext-plugin-install__label"
        htmlFor="ext-plugin-source"
      >
        {tr("ext.plugins.installLabel")}
      </label>
      <p className="ext-plugin-install__lead">{tr("ext.plugins.installLead")}</p>
      <div className="ext-plugin-install__row">
        <input
          ref={inputRef}
          id="ext-plugin-source"
          type="text"
          className="settings-input ext-plugin-install__input"
          value={source}
          placeholder={tr("ext.plugins.installPlaceholder")}
          disabled={disabled || busy}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onSourceChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={disabled || busy}
          onClick={onBrowse}
          title={tr("ext.plugins.browseFolder")}
        >
          <IconFolder size={14} />
          <span>{tr("ext.plugins.browseFolder")}</span>
        </button>
      </div>
      <div className="ext-plugin-install__actions">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={!canValidate}
          onClick={onValidate}
          title={tr("ext.plugins.validateHint")}
        >
          {validating
            ? tr("ext.plugins.validating")
            : tr("ext.plugins.validate")}
        </button>
        <button
          type="button"
          className="btn btn--solid btn--sm"
          disabled={!canSubmit}
          onClick={onInstall}
        >
          {installing
            ? tr("ext.plugins.installing")
            : tr("ext.plugins.install")}
        </button>
      </div>
      <p className="ext-plugin-install__hint">{tr("ext.plugins.installHint")}</p>
      {formError ? (
        <p className="ext-plugin-install__error" role="alert">
          {formError}
        </p>
      ) : null}
      {validatePresentation ? (
        <div className="ext-plugin-result ext-plugin-result--inline">
          <div className="ext-plugin-result__meta">
            <span
              className={
                "ext-badge ext-badge--" +
                pluginValidateBadgeTone(validatePresentation.severity)
              }
            >
              {pluginValidateKindLabel(validatePresentation.kind, kindLabels)}
            </span>
            {validatePresentation.ok ? (
              <span className="ext-badge ext-badge--ok">
                {tr("ext.plugins.validateOk")}
              </span>
            ) : null}
          </div>
          <p
            className={
              "ext-plugin-result__summary" +
              (validatePresentation.severity === "ok"
                ? " ext-plugin-result__summary--ok"
                : validatePresentation.severity === "err"
                  ? " ext-plugin-result__summary--err"
                  : " ext-plugin-result__summary--warn")
            }
          >
            {validatePresentation.summary}
          </p>
          {pluginValidateHint(validatePresentation.kind, kindHints) ? (
            <p className="ext-plugin-result__hint">
              {pluginValidateHint(validatePresentation.kind, kindHints)}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
