import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
) as { private?: boolean; files?: string[]; exports?: unknown };

// The repository once described this package as a publishable library while no
// such package existed on any registry. See docs/core-distribution.md.
describe("core distribution contract", () => {
  it("is a repository-internal package that registries refuse", () => {
    expect(manifest.private).toBe(true);
  });

  it("packs only build output, so the tarball contents are explainable", () => {
    expect(manifest.files).toEqual(["dist"]);
  });

  it("still exposes the entry the workspace consumes", () => {
    expect(manifest.exports).toEqual({
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
        require: "./dist/index.cjs",
      },
    });
  });
});
