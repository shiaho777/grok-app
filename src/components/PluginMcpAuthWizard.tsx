/**
 * Plugin MCP authorization (x-api): GlassModal, not ChatCut HTTP OAuth.
 * Four console tokens (shortest for the App-owner account) or OAuth 2 PKCE
 * localhost (one browser Allow). Secrets stay in Host invoke; never echo.
 */

import { useEffect, useMemo, useState } from "react";
import * as api from "@/lib/api";
import { createT, type Locale } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

export type PluginMcpAuthWizardProps = {
  open: boolean;
  locale: Locale;
  serverName: string;
  onClose: () => void;
  onChanged: (status: api.PluginMcpAuthStatus) => void;
};

type AuthMethod = "tokens" | "oauth2";

export function PluginMcpAuthWizard({
  open,
  locale,
  serverName,
  onClose,
  onChanged,
}: PluginMcpAuthWizardProps) {
  const tr = useMemo(() => createT(locale), [locale]);
  const [method, setMethod] = useState<AuthMethod>("tokens");
  const [status, setStatus] = useState<api.PluginMcpAuthStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [accessTokenSecret, setAccessTokenSecret] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  useEffect(() => {
    if (!open || !serverName.trim()) return;
    let cancelled = false;
    setError(null);
    void api
      .pluginMcpAuthStatus(serverName)
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [open, serverName]);

  const authorized = !!status?.authorized;
  const canSaveTokens =
    !!apiKey.trim() &&
    !!apiSecret.trim() &&
    !!accessToken.trim() &&
    !!accessTokenSecret.trim();

  const saveTokens = async () => {
    if (!canSaveTokens || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.pluginMcpAuthSaveTokens({
        name: serverName,
        apiKey: apiKey.trim(),
        apiSecret: apiSecret.trim(),
        accessToken: accessToken.trim(),
        accessTokenSecret: accessTokenSecret.trim(),
      });
      setApiKey("");
      setApiSecret("");
      setAccessToken("");
      setAccessTokenSecret("");
      setStatus(next);
      onChanged(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const startOauth2 = async () => {
    if (!clientId.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.pluginMcpAuthOauth2({
        name: serverName,
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
      });
      setStatus(next);
      onChanged(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.pluginMcpAuthLogout(serverName);
      setStatus(next);
      onChanged(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <GlassModal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={tr("ext.mcp.pluginAuthTitle", { name: serverName })}
      size="lg"
      closeLabel={tr("common.close")}
      wrapBody
      footer={
        <>
          {authorized ? (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => void logout()}
            >
              {tr("ext.mcp.pluginAuth.logout")}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy}
            onClick={onClose}
          >
            {tr("common.close")}
          </button>
          {method === "tokens" ? (
            <button
              type="button"
              className="btn btn--solid"
              disabled={busy || !canSaveTokens}
              onClick={() => void saveTokens()}
            >
              {busy
                ? tr("ext.mcp.pluginAuth.working")
                : tr("ext.mcp.pluginAuth.save")}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--solid"
              disabled={busy || !clientId.trim()}
              onClick={() => void startOauth2()}
            >
              {busy
                ? tr("ext.mcp.pluginAuth.waiting")
                : tr("ext.mcp.pluginAuth.startOauth")}
            </button>
          )}
        </>
      }
    >
      {authorized ? (
        <p className="ext-plugin-result__summary ext-plugin-result__summary--ok">
          {tr("ext.mcp.pluginAuth.signedIn", {
            user: status?.username ? `@${status.username}` : serverName,
          })}
        </p>
      ) : (
        <p className="ext-plugin-install__lead">
          {tr("ext.mcp.pluginAuthLead")}
        </p>
      )}
      <SegmentedControl
        ariaLabel={tr("ext.mcp.pluginAuth.methodLabel")}
        value={method}
        disabled={busy}
        onChange={(next) => setMethod(next)}
        options={[
          {
            value: "tokens",
            label: tr("ext.mcp.pluginAuth.method.tokens"),
          },
          {
            value: "oauth2",
            label: tr("ext.mcp.pluginAuth.method.oauth2"),
          },
        ]}
      />
      {method === "tokens" ? (
        <div className="ext-plugin-install" style={{ marginTop: 12 }}>
          <p className="ext-plugin-install__hint">
            {tr("ext.mcp.pluginAuth.tokensHint")}
          </p>
          <label className="ext-plugin-install__label" htmlFor="x-api-key">
            {tr("ext.mcp.pluginAuth.apiKey")}
          </label>
          <input
            id="x-api-key"
            type="password"
            autoComplete="off"
            className="settings-input"
            value={apiKey}
            disabled={busy}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <label className="ext-plugin-install__label" htmlFor="x-api-secret">
            {tr("ext.mcp.pluginAuth.apiSecret")}
          </label>
          <input
            id="x-api-secret"
            type="password"
            autoComplete="off"
            className="settings-input"
            value={apiSecret}
            disabled={busy}
            onChange={(e) => setApiSecret(e.target.value)}
          />
          <label className="ext-plugin-install__label" htmlFor="x-access-token">
            {tr("ext.mcp.pluginAuth.accessToken")}
          </label>
          <input
            id="x-access-token"
            type="password"
            autoComplete="off"
            className="settings-input"
            value={accessToken}
            disabled={busy}
            onChange={(e) => setAccessToken(e.target.value)}
          />
          <label
            className="ext-plugin-install__label"
            htmlFor="x-access-token-secret"
          >
            {tr("ext.mcp.pluginAuth.accessTokenSecret")}
          </label>
          <input
            id="x-access-token-secret"
            type="password"
            autoComplete="off"
            className="settings-input"
            value={accessTokenSecret}
            disabled={busy}
            onChange={(e) => setAccessTokenSecret(e.target.value)}
          />
        </div>
      ) : (
        <div className="ext-plugin-install" style={{ marginTop: 12 }}>
          <p className="ext-plugin-install__hint">
            {tr("ext.mcp.pluginAuth.oauth2Hint", {
              callback: "http://127.0.0.1:8787/callback",
            })}
          </p>
          <label className="ext-plugin-install__label" htmlFor="x-client-id">
            {tr("ext.mcp.pluginAuth.clientId")}
          </label>
          <input
            id="x-client-id"
            type="text"
            autoComplete="off"
            spellCheck={false}
            className="settings-input"
            value={clientId}
            disabled={busy}
            onChange={(e) => setClientId(e.target.value)}
          />
          <label className="ext-plugin-install__label" htmlFor="x-client-secret">
            {tr("ext.mcp.pluginAuth.clientSecret")}
          </label>
          <input
            id="x-client-secret"
            type="password"
            autoComplete="off"
            className="settings-input"
            value={clientSecret}
            disabled={busy}
            onChange={(e) => setClientSecret(e.target.value)}
          />
          <p className="ext-plugin-install__hint">
            {tr("ext.mcp.pluginAuth.clientSecretHint")}
          </p>
        </div>
      )}
      {error ? (
        <p className="ext-plugin-install__error" role="alert">
          {error}
        </p>
      ) : null}
    </GlassModal>
  );
}
