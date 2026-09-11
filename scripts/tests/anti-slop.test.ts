import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

const directories: string[] = [];

const fixture = (source: string, rule: string, ruleOptions?: { allowUnknownValues: boolean }) => {
  const directory = mkdtempSync(join(tmpdir(), "unquote-anti-slop-"));
  directories.push(directory);
  const file = join(directory, "case.ts");
  const config = join(directory, ".oxlintrc.json");
  writeFileSync(file, source);
  writeFileSync(
    config,
    JSON.stringify({
      jsPlugins: [
        { name: "anti-slop", specifier: join(projectRoot, "tools/oxlint/anti-slop/index.ts") },
      ],
      options: { reportUnusedDisableDirectives: "error" },
      rules: { [rule]: ruleOptions ? ["error", ruleOptions] : "error" },
    }),
  );
  const lint = (...flags: string[]) =>
    spawnSync(
      process.execPath,
      [join(projectRoot, "node_modules/oxlint/bin/oxlint"), "-c", config, ...flags, file],
      { encoding: "utf8" },
    );
  return { file, lint };
};

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("anti-slop project policy", () => {
  it("limits a decoder dictionary exception to unknown values", () => {
    const source = "export type Payload = Record<string, unknown>;\n";
    expect(fixture(source, "anti-slop/no-unsafe-dictionary-type").lint().status).toBe(1);
    const { file, lint } = fixture(source, "anti-slop/no-unsafe-dictionary-type", {
      allowUnknownValues: true,
    });
    expect(lint().status).toBe(0);
    for (const valueType of ["any", "object", "{}", "unknown | any"]) {
      writeFileSync(file, `export type Payload = Record<string, ${valueType}>;\n`);
      expect(lint().status).toBe(1);
    }
    writeFileSync(file, "export interface Payload { [key: string]: unknown; }\n");
    expect(lint().status).toBe(0);
    writeFileSync(file, "export type Payload = { [key: string]: unknown; [key: number]: any; };\n");
    expect(lint().status).toBe(1);
  });

  it("accepts an explicit anonymous return contract without requiring a type alias", () => {
    const { lint } = fixture(
      "export const range = (): { start: number; end: number } => ({ start: 0, end: 1 });\n",
      "anti-slop/no-known-value-widening",
    );
    expect(lint().status).toBe(0);
  });

  it("still rejects erasing a known value into unknown", () => {
    const { lint } = fixture(
      'export const value: unknown = { id: "record-1" };\n',
      "anti-slop/no-known-value-widening",
    );
    const result = lint();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("no-known-value-widening");
  });

  it("still rejects erasing a known value into an empty object contract", () => {
    const { lint } = fixture(
      'export const value: {} = { id: "record-1" };\n',
      "anti-slop/no-known-value-widening",
    );
    expect(lint().status).toBe(1);
  });

  it("keeps short local control flow together", () => {
    const { lint } = fixture(
      "export const clamp = (value: number) => {\n  const result = value + 1;\n  if (result < 0) return 0;\n  return result;\n};\n",
      "anti-slop/require-readable-spacing",
    );
    expect(lint().status).toBe(0);
  });

  it("separates declarations without detaching documentation and stays stable after formatting", () => {
    const { file, lint } = fixture(
      "export const first = 1;\n/** The second value. */\nexport const second = 2;\n",
      "anti-slop/require-readable-spacing",
    );
    expect(lint().status).toBe(1);
    expect(lint("--fix").status).toBe(0);
    const format = () =>
      spawnSync(join(projectRoot, "node_modules/.bin/oxfmt"), [file, "--write"], {
        encoding: "utf8",
      });
    expect(format().status).toBe(0);
    const formatted = readFileSync(file, "utf8");
    expect(formatted).toBe(
      "export const first = 1;\n\n/** The second value. */\nexport const second = 2;\n",
    );
    expect(lint("--fix").status).toBe(0);
    expect(format().status).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(formatted);
  });

  it("limits an exception to its line and reports it when it becomes unused", () => {
    const comment =
      "// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This function normalizes arbitrary thrown values.\n";
    const { file, lint } = fixture(
      comment +
        "export const errorText = (error: unknown) => String(error);\n" +
        "export const unchecked = (value: unknown) => String(value);\n",
      "anti-slop/no-unknown-parameters",
    );
    expect(lint().status).toBe(1);
    writeFileSync(file, comment + "export const errorText = (error: unknown) => String(error);\n");
    expect(lint().status).toBe(0);
    writeFileSync(file, comment + "export const errorText = (error: string) => error;\n");
    expect(lint().status).toBe(1);
  });
});
