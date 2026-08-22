// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  benchmarkFileInputSelector,
  startBenchmark,
  waitForBenchmarkFileInput,
  waitForBenchmarkReady,
} from "../browser-scenario.mjs";

beforeEach(() => {
  document.body.replaceChildren();
});

describe("benchmark browser scenario", () => {
  it("waits for the stable file input contract", async () => {
    const input = document.createElement("input");
    input.dataset.benchmarkAction = "source-file-input";
    document.body.append(input);

    await expect(waitForBenchmarkFileInput()).resolves.toBe(true);
    expect(document.querySelector(benchmarkFileInputSelector)).toBe(input);
  });

  it("reports readiness from the app data contract", async () => {
    const shell = document.createElement("div");
    shell.className = "uq-shell";
    shell.dataset.sourceFile = "fixture.jsonl";
    shell.dataset.parseState = "complete";
    shell.dataset.agentSession = "false";
    shell.dataset.outputView = "json";
    shell.innerHTML = `
      <div id="record-1"></div>
      <div data-record-rail><div data-record-id="record-1"></div></div>
    `;
    document.body.append(shell);
    startBenchmark();

    await expect(
      waitForBenchmarkReady({ expectedFile: "fixture.jsonl", expectsAgentSession: false }),
    ).resolves.toMatchObject({
      agentSessionReadyMs: null,
      railRows: 1,
    });
  });

  it("rejects a fixture that does not produce the promised Agent session", async () => {
    const shell = document.createElement("div");
    shell.className = "uq-shell";
    shell.dataset.sourceFile = "agent.jsonl";
    shell.dataset.parseState = "complete";
    shell.dataset.agentSession = "false";
    shell.dataset.outputView = "json";
    shell.innerHTML = '<div id="record-1"></div>';
    document.body.append(shell);

    await expect(
      waitForBenchmarkReady({ expectedFile: "agent.jsonl", expectsAgentSession: true }),
    ).rejects.toThrow(/expected Agent Session/);
  });
});
