import { describe, expect, it, vi } from "vitest";
import {
  CHATCUT_CODEX_INSTALL_SOURCE,
  OPENAI_PLUGINS_MARKETPLACE_URL,
  ensureOpenaiPluginsMarketplace,
  findChatCutInstalledPlugin,
  isChatCutInstalled,
  isOpenaiPluginsSource,
  isXApiInstalled,
  X_API_INSTALL_SOURCE,
  normalizeMarketplaceLocator,
  pickDefaultInstallableFilter,
  pluginDisplayName,
  resolveExtensionsTabId,
} from "./pluginRecommended";

describe("pluginRecommended", () => {
  it("exposes ChatCut #codex install source", () => {
    expect(CHATCUT_CODEX_INSTALL_SOURCE).toContain("ChatCut-Inc/agent-plugin");
    expect(CHATCUT_CODEX_INSTALL_SOURCE).toContain("#codex");
    expect(OPENAI_PLUGINS_MARKETPLACE_URL).toBe(
      "https://github.com/openai/plugins",
    );
  });

  it("normalizes marketplace locator variants", () => {
    expect(normalizeMarketplaceLocator("https://github.com/openai/plugins")).toBe(
      "github.com/openai/plugins",
    );
    expect(
      normalizeMarketplaceLocator("https://github.com/openai/plugins.git"),
    ).toBe("github.com/openai/plugins");
    expect(normalizeMarketplaceLocator("HTTPS://GITHUB.COM/OpenAI/Plugins/")).toBe(
      "github.com/openai/plugins",
    );
    expect(normalizeMarketplaceLocator("openai/plugins")).toBe(
      "github.com/openai/plugins",
    );
    expect(
      normalizeMarketplaceLocator("git@github.com:openai/plugins.git"),
    ).toBe("github.com/openai/plugins");
  });

  it("detects openai/plugins source by url/path/name", () => {
    expect(
      isOpenaiPluginsSource({
        name: "openai-plugins",
        url: "https://github.com/openai/plugins.git",
      }),
    ).toBe(true);
    expect(
      isOpenaiPluginsSource({ name: "OpenAI Plugins", path: null, url: null }),
    ).toBe(true);
    expect(
      isOpenaiPluginsSource({
        name: "xAI Official",
        url: "https://github.com/xai-org/something",
      }),
    ).toBe(false);
  });

  it("matches ChatCut installed as codex or chatcut or by source path", () => {
    expect(isChatCutInstalled([{ name: "codex" }])).toBe(true);
    expect(isChatCutInstalled([{ name: "ChatCut" }])).toBe(true);
    expect(
      isChatCutInstalled([
        {
          name: "other",
          path: "/plugins/ChatCut-Inc/agent-plugin/codex",
        },
      ]),
    ).toBe(true);
    expect(isChatCutInstalled([{ name: "vercel" }])).toBe(false);
    expect(findChatCutInstalledPlugin([{ name: "codex" }])?.name).toBe("codex");
  });

  it("matches x-api by name or RongleCat git source", () => {
    expect(isXApiInstalled([{ name: "x-api" }])).toBe(true);
    expect(
      isXApiInstalled([
        {
          name: "other",
          source: "https://github.com/RongleCat/x-api",
        },
      ]),
    ).toBe(true);
    expect(isXApiInstalled([{ name: "vercel" }])).toBe(false);
    expect(X_API_INSTALL_SOURCE).toBe("https://github.com/RongleCat/x-api");
  });

  it("pluginDisplayName maps codex/chatcut to ChatCut once", () => {
    expect(pluginDisplayName({ name: "codex" })).toBe("ChatCut");
    expect(pluginDisplayName({ name: "chatcut" })).toBe("ChatCut");
    expect(pluginDisplayName({ name: "vercel" })).toBe("vercel");
  });

  it("picks openai source name as default installable filter", () => {
    expect(
      pickDefaultInstallableFilter([
        { name: "xAI Official" },
        { name: "openai/plugins", url: "https://github.com/openai/plugins" } as never,
      ]),
    ).toBe("openai/plugins");
    // when sources lack openai marker, fall back to __all__
    expect(pickDefaultInstallableFilter([{ name: "xAI Official" }])).toBe(
      "__all__",
    );
    expect(pickDefaultInstallableFilter([])).toBe("__all__");
  });

  it("pickDefaultInstallableFilter prefers source that matches openai url", () => {
    expect(
      pickDefaultInstallableFilter([
        { name: "my-openai", url: "https://github.com/openai/plugins" } as never,
        { name: "other" },
      ]),
    ).toBe("my-openai");
  });

  it("ensureOpenaiPluginsMarketplace is idempotent when already present", async () => {
    const list = vi.fn().mockResolvedValue({
      sources: [
        { name: "openai/plugins", url: "https://github.com/openai/plugins" },
      ],
    });
    const add = vi.fn();
    const update = vi.fn().mockResolvedValue({});
    const res = await ensureOpenaiPluginsMarketplace({ list, add, update });
    expect(res.alreadyPresent).toBe(true);
    expect(res.added).toBe(false);
    expect(res.error).toBeNull();
    expect(add).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith("openai/plugins");
  });

  it("ensureOpenaiPluginsMarketplace adds when missing", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({ sources: [{ name: "xAI Official" }] })
      .mockResolvedValueOnce({
        sources: [
          { name: "xAI Official" },
          { name: "openai/plugins", url: OPENAI_PLUGINS_MARKETPLACE_URL },
        ],
      });
    const add = vi.fn().mockResolvedValue({});
    const res = await ensureOpenaiPluginsMarketplace({ list, add });
    expect(res.added).toBe(true);
    expect(res.alreadyPresent).toBe(false);
    expect(add).toHaveBeenCalledWith(OPENAI_PLUGINS_MARKETPLACE_URL);
    expect(res.sourceName).toBe("openai/plugins");
  });

  it("ensureOpenaiPluginsMarketplace soft-fails on add error", async () => {
    const list = vi.fn().mockResolvedValue({ sources: [] });
    const add = vi.fn().mockRejectedValue(new Error("network down"));
    const res = await ensureOpenaiPluginsMarketplace({ list, add });
    expect(res.added).toBe(false);
    expect(res.error).toMatch(/network down/);
  });

  it("resolveExtensionsTabId maps market → plugins", () => {
    expect(resolveExtensionsTabId("market")).toBe("plugins");
    expect(resolveExtensionsTabId("plugins")).toBe("plugins");
    expect(resolveExtensionsTabId("mcp")).toBe("mcp");
    expect(resolveExtensionsTabId("apps")).toBe("plugins");
    expect(resolveExtensionsTabId(null)).toBe("plugins");
  });
});
