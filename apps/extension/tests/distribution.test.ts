import { describe, expect, it } from "vitest";
import { createExtensionManifest } from "../src/distribution";
import baseConfig from "../wxt.config";
import devConfig from "../wxt.dev.config";
import safariConfig from "../wxt.safari.config";

const manifestFor = (config: typeof baseConfig, browser: string) => {
  const { manifest } = config;
  return typeof manifest === "function"
    ? manifest({ browser, manifestVersion: 3, mode: "production", command: "build" } as never)
    : manifest;
};

describe("extension manifest policy", () => {
  it.each(["chrome", "firefox", "edge"])("asks for clipboard access on %s", (browser) => {
    expect(createExtensionManifest(browser).permissions).toEqual([
      "alarms",
      "contextMenus",
      "storage",
      "clipboardRead",
    ]);
  });

  it("drops clipboardRead on Safari, which has no such permission", () => {
    expect(createExtensionManifest("safari").permissions).toEqual([
      "alarms",
      "contextMenus",
      "storage",
    ]);
  });

  it.each(["chrome", "safari"])("keeps commands, locale, and icons identical on %s", (browser) => {
    const manifest = createExtensionManifest(browser);

    expect(manifest.default_locale).toBe("en");
    expect(manifest.commands.open_unquote).toEqual({
      suggested_key: { default: "Ctrl+Shift+U", mac: "Command+Shift+U" },
      description: "__MSG_openUnquote__",
    });
    expect(manifest.icons).toEqual({
      "16": "icon16.png",
      "48": "icon48.png",
      "128": "icon128.png",
    });
    expect(manifest.options_ui).toEqual({ page: "options.html", open_in_tab: true });
  });
});

describe("build target configuration", () => {
  it("gives every target its own output directory", () => {
    expect(baseConfig.outDirTemplate).toBe("extension");
    expect(safariConfig.outDirTemplate).toBe("extension-safari");
    expect(devConfig.outDirTemplate).toBe("dev-extension");
  });

  it("derives the dev and Safari manifests from the shipping one", () => {
    // The output directory is the only difference a target is allowed to
    // declare; anything else would be drift.
    expect(manifestFor(devConfig, "chrome")).toEqual(createExtensionManifest("chrome"));
    expect(manifestFor(safariConfig, "safari")).toEqual(createExtensionManifest("safari"));
    expect(manifestFor(baseConfig, "chrome")).toEqual(createExtensionManifest("chrome"));
  });

  it("targets manifest v3 on every build", () => {
    expect(baseConfig.manifestVersion).toBe(3);
    expect(safariConfig.manifestVersion).toBe(3);
    expect(devConfig.manifestVersion).toBe(3);
  });
});
