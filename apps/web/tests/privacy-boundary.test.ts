import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
  it("loads no cross-origin script into the page", () => {
    const sources = collectScriptSources(readWebFile("index.html"));

    expect(sources).toContain("/src/main.tsx");
    expect(sources.filter(isCrossOrigin)).toEqual([]);
  });

  it("grants no remote script execution or reporting origin", () => {
    const policy = parseContentSecurityPolicy(readWebFile("public/_headers"));

    for (const directive of ["script-src", "connect-src", "worker-src"]) {
      expect(policy.get(directive)).toEqual(["'self'"]);
    }
  });
});
