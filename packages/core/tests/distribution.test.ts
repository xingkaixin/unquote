import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as core from "../src";
import * as ingestion from "../src/ingestion";

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

  it("exposes distinct primary and ingestion entries", () => {
    expect(manifest.exports).toEqual({
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
        require: "./dist/index.cjs",
      },
      "./ingestion": {
        types: "./dist/ingestion.d.ts",
        import: "./dist/ingestion.js",
        require: "./dist/ingestion.cjs",
      },
    });
  });

  it("keeps ingestion-specific parser variants out of the primary entry", () => {
    expect(core).not.toHaveProperty("parseInputForIngestion");
    expect(core).not.toHaveProperty("parseJsonlRecordLineForIngestion");
    expect(core).not.toHaveProperty("parseJsonlRecordLineWithValue");
    expect(core).not.toHaveProperty("parsePreviewJsonlRecordLineForIngestion");
    expect(core).not.toHaveProperty("parsePreviewJsonlRecordLineWithValue");
  });

  it("limits the ingestion entry to capabilities used by the ingestion pipeline", () => {
    expect(Object.keys(ingestion).sort()).toEqual([
      "parseInputForIngestion",
      "parseJsonlRecordLineWithValue",
      "parsePreviewJsonlRecordLineWithValue",
    ]);
  });
});
