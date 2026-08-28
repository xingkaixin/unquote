import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../check-ui-bundle-budget.mjs", import.meta.url));
const temporaryRoots: string[] = [];

const createBuild = (webHtml: string) => {
  const root = mkdtempSync(join(tmpdir(), "unquote-bundle-budget-"));
  temporaryRoots.push(root);
  const files = {
    "dist/web/index.html": webHtml,
    "dist/web/assets/index.js": "export {};",
    "dist/web/assets/index.css": "body {}",
    "dist/extension/options.html": '<script src="./chunks/options.js"></script>',
    "dist/extension/chunks/options.js": "export {};",
    "dist/extension/assets/options.css": "body {}",
  };

  for (const [relativePath, contents] of Object.entries(files)) {
    const file = join(root, relativePath);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, contents);
  }
  return root;
};

const runBudgetCheck = (cwd: string) =>
  spawnSync(process.execPath, [script], { cwd, encoding: "utf8" });

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("UI bundle budget", () => {
  it("measures local assets once without reading remote script URLs", () => {
    const root = createBuild(`
      <script src="/assets/index.js"></script>
      <link rel="modulepreload" href="/assets/index.js">
      <script src="https://analytics.example/script.js"></script>
      <script src="//analytics.example/script.js"></script>
      <script src="data:text/javascript,void 0;//inline.js"></script>
    `);

    const result = runBudgetCheck(root);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("web: initial JS 10 bytes");
    expect(result.stdout).toContain("extension: initial JS 10 bytes");
  });

  it("still rejects local bundles that exceed the initial JavaScript budget", () => {
    const root = createBuild('<script src="/assets/index.js"></script>');
    writeFileSync(join(root, "dist/web/assets/index.js"), "a".repeat(620_001));

    const result = runBudgetCheck(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("web initial JS 620001 bytes");
    expect(result.stderr).toContain("exceeds 620000 bytes");
  });
});
