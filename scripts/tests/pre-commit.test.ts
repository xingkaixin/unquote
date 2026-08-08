import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const temporaryRepositories: string[] = [];

const run = (cwd: string, command: string, args: string[], env = process.env) => {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error([result.stdout, result.stderr].filter(Boolean).join("\n"));
  }
  return result;
};

const createRepository = () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "unquote-pre-commit-"));
  temporaryRepositories.push(temporaryRoot);
  const root = join(temporaryRoot, "repository");
  const bin = join(temporaryRoot, "bin");
  const hook = join(temporaryRoot, "pre-commit");
  const log = join(temporaryRoot, "pnpm.log");
  mkdirSync(root);
  mkdirSync(bin);
  copyFileSync(join(projectRoot, ".githooks/pre-commit"), hook);
  chmodSync(hook, 0o755);
  const pnpm = join(bin, "pnpm");
  writeFileSync(
    pnpm,
    '#!/usr/bin/env node\nrequire("node:fs").appendFileSync(process.env.PNPM_LOG, `${JSON.stringify(process.argv.slice(2))}\\n`);\n',
  );
  chmodSync(pnpm, 0o755);
  run(root, "git", ["init", "--quiet"]);
  run(root, "git", ["config", "user.email", "test@example.com"]);
  run(root, "git", ["config", "user.name", "Test"]);

  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    PNPM_LOG: log,
  };
  return { root, hook, log, env };
};

const write = (root: string, path: string, content = "export {};\n") => {
  const absolutePath = join(root, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
};

const stagedPaths = (root: string) =>
  run(root, "git", ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"])
    .stdout.split("\0")
    .filter(Boolean);

const calls = (log: string): string[][] =>
  existsSync(log)
    ? readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[])
    : [];

afterEach(() => {
  for (const root of temporaryRepositories.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("pre-commit hook", () => {
  it("passes staged TypeScript paths to tools byte-for-byte", () => {
    const repository = createRepository();
    const files = [
      "plain.ts",
      "example file.ts",
      "glob[probe].tsx",
      "line\nbreak.ts",
      "--option.ts",
    ];
    files.forEach((path) => write(repository.root, path));
    run(repository.root, "git", ["add", "--", ...files]);
    const paths = stagedPaths(repository.root);

    run(repository.root, repository.hook, [], repository.env);

    expect(calls(repository.log)).toEqual([
      ["exec", "oxfmt", "--check", "--", ...paths],
      ["exec", "oxlint", "--", ...paths],
      ["typecheck"],
    ]);
  });

  it("skips oxlint for CSS and JSON-only changes", () => {
    const repository = createRepository();
    const files = ["style sheet.css", "config[local].json"];
    files.forEach((path) => write(repository.root, path, "{}\n"));
    run(repository.root, "git", ["add", "--", ...files]);
    const paths = stagedPaths(repository.root);

    run(repository.root, repository.hook, [], repository.env);

    expect(calls(repository.log)).toEqual([
      ["exec", "oxfmt", "--check", "--", ...paths],
      ["typecheck"],
    ]);
  });

  it("exits without tools when no supported file is staged", () => {
    const repository = createRepository();
    write(repository.root, "notes with spaces.md", "notes\n");
    run(repository.root, "git", ["add", "--", "notes with spaces.md"]);

    run(repository.root, repository.hook, [], repository.env);

    expect(calls(repository.log)).toEqual([]);
  });

  it("includes additions and renames while excluding deletions", () => {
    const repository = createRepository();
    write(repository.root, "old name.ts");
    write(repository.root, "deleted.ts");
    run(repository.root, "git", ["add", "--", "old name.ts", "deleted.ts"]);
    run(repository.root, "git", ["commit", "--quiet", "--no-verify", "-m", "fixture"]);
    run(repository.root, "git", ["mv", "old name.ts", "renamed file.ts"]);
    write(repository.root, "copy[target].ts");
    rmSync(join(repository.root, "deleted.ts"));
    run(repository.root, "git", ["add", "-A"]);
    const paths = stagedPaths(repository.root);

    run(repository.root, repository.hook, [], repository.env);

    expect(paths).toContain("renamed file.ts");
    expect(paths).toContain("copy[target].ts");
    expect(paths).not.toContain("old name.ts");
    expect(paths).not.toContain("deleted.ts");
    expect(calls(repository.log)).toEqual([
      ["exec", "oxfmt", "--check", "--", ...paths],
      ["exec", "oxlint", "--", ...paths],
      ["typecheck"],
    ]);
  });
});
