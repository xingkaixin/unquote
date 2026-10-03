import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { addAnalytics } from "../src/analytics";
import { renderChangelogPage } from "../src/changelog-page";
import { changelogLocales } from "../src/changelog-routes";
import { guides } from "../src/guide-content";
import { renderGuidePage } from "../src/guide-page";

const readWebFile = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");

const collectScriptSources = (html: string) =>
  [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']*)["']/gi)].map((match) => match[1] ?? "");

// Protocol-relative sources start with "//", so a leading slash alone is not same-origin.
const isCrossOrigin = (source: string) => !source.startsWith("/") || source.startsWith("//");

const parseContentSecurityPolicy = (headers: string) => {
  const marker = "Content-Security-Policy:";
  const line = headers.split("\n").find((entry) => entry.includes(marker));
  if (!line) {
    throw new Error("apps/web/public/_headers must declare a Content-Security-Policy");
  }

  return new Map(
    line
      .slice(line.indexOf(marker) + marker.length)
      .split(";")
      .map((directive) => directive.trim().split(/\s+/))
      .flatMap(([name, ...sources]) => (name ? [[name, sources] as const] : [])),
  );
};

describe("web privacy boundary", () => {
  it.each([
    ["home", readWebFile("index.html")],
    ...changelogLocales.map((locale) => [`changelog ${locale}`, renderChangelogPage(locale)]),
    ...Object.keys(guides).map((slug) => [slug, renderGuidePage(slug)]),
  ])(
    "scopes %s analytics to production without source hashes or session recording",
    (_page, source) => {
      const html = addAnalytics(source!);
      const sources = collectScriptSources(html);
      const { document } = new JSDOM(html).window;
      const tracker = document.querySelector('script[src="https://umami.xingkaixin.me/script.js"]');

      expect(sources.filter(isCrossOrigin)).toEqual(["https://umami.xingkaixin.me/script.js"]);
      expect(tracker?.hasAttribute("defer")).toBe(true);
      expect(tracker?.getAttribute("data-website-id")).toBe("65b7d2aa-b029-43fc-8a87-a62ca0f3f23d");
      expect(tracker?.getAttribute("data-domains")).toBe("unquote.xingkaixin.me");
      expect(tracker?.getAttribute("data-exclude-hash")).toBe("true");
      expect(tracker?.getAttribute("data-performance")).toBe("true");
      expect(tracker?.hasAttribute("data-replay")).toBe(false);
    },
  );

  it("allows only Umami and the Pages analytics endpoints for remote scripts and reporting", () => {
    const policy = parseContentSecurityPolicy(readWebFile("public/_headers"));

    expect(policy.get("script-src")).toEqual([
      "'self'",
      "https://umami.xingkaixin.me",
      "https://static.cloudflareinsights.com/beacon.min.js",
    ]);
    expect(policy.get("connect-src")).toEqual([
      "'self'",
      "https://umami.xingkaixin.me",
      "https://cloudflareinsights.com/cdn-cgi/rum",
    ]);
    expect(policy.get("style-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(policy.get("font-src")).toEqual(["'self'"]);
    expect(policy.get("worker-src")).toEqual(["'self'"]);
  });
});
