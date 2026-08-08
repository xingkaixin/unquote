import { describe, expect, it } from "vitest";
import { createExtensionManifest } from "../src/distribution";
import {
  applyMarketingVersion,
  findMissingArtifacts,
  findSafariManifestProblems,
  requiredSafariArtifacts,
} from "../../../scripts/safari-distribution.mjs";

const safariManifest = (overrides: Record<string, unknown> = {}) => ({
  ...createExtensionManifest("safari"),
  manifest_version: 3,
  version: "0.12.0",
  ...overrides,
});

const projectWithVersions = (count: number) =>
  Array.from({ length: count }, () => "\t\t\t\tMARKETING_VERSION = 0.11.0;").join("\n");

describe("Safari marketing version sync", () => {
  it("rewrites every assignment and reports how many it touched", () => {
    const result = applyMarketingVersion(projectWithVersions(4), "0.12.0");

    expect(result.replacements).toBe(4);
    expect(result.project).not.toContain("0.11.0");
    expect(result.project.match(/MARKETING_VERSION = 0\.12\.0;/g)).toHaveLength(4);
  });

  it("fails instead of silently shipping the previous version", () => {
    expect(() => applyMarketingVersion("no version assignments here", "0.12.0")).toThrow(
      /No MARKETING_VERSION assignment found/,
    );
  });
});

describe("Safari artifact verification", () => {
  it("accepts a complete build output", () => {
    expect(findMissingArtifacts([...requiredSafariArtifacts, "icon16.png"])).toEqual([]);
  });

  it("names every missing artifact", () => {
    expect(findMissingArtifacts(["manifest.json"])).toEqual([
      "background.js",
      "options.html",
      "_locales/en/messages.json",
    ]);
  });
});

describe("Safari manifest verification", () => {
  it("accepts the manifest the Safari build produces", () => {
    expect(findSafariManifestProblems(safariManifest())).toEqual([]);
  });

  it.each([
    ["a Chrome manifest", { permissions: ["alarms", "contextMenus", "storage", "clipboardRead"] }],
    ["a missing version", { version: "" }],
    ["a manifest v2 build", { manifest_version: 2 }],
    ["a stripped permission", { permissions: ["storage"] }],
    ["a missing command", { commands: {} }],
    ["a different default locale", { default_locale: "zh_CN" }],
  ])("rejects %s", (_label, overrides) => {
    expect(findSafariManifestProblems(safariManifest(overrides)).length).toBeGreaterThan(0);
  });

  it("rejects an entirely absent manifest without throwing", () => {
    expect(findSafariManifestProblems(undefined).length).toBeGreaterThan(0);
  });
});
