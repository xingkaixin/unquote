// @vitest-environment jsdom
import { expect, it } from "vitest";
import { parsePreviewJsonlRecordLine } from "@unquote/core";
import { createAgentSessionModel } from "../src/lib/agent-session";
import { createJsonlIngestion } from "../src/lib/jsonl-ingestion";
import { createLocalFileAccess } from "../src/lib/local-file-source";
import {
  createStreamingFileSourceRevision,
  createTextSourceRevision,
} from "../src/lib/published-source";
import { buildTurnReport, type TurnReportOptions } from "../src/lib/turn-report";
import { createStreamFile } from "./helpers/stub-file";

const longCommand = "x".repeat(9000);

const claudeLines = [
  '{"type":"user","uuid":"u1","promptId":"p1","message":{"role":"user","content":"Fix the bug"}}',
  JSON.stringify({
    type: "assistant",
    uuid: "u2",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Private plan" },
        { type: "text", text: "Looking at it" },
        { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: longCommand } },
      ],
    },
  }).replace('"}}]', '","timeout":9007199254740993}}]'),
  '{"type":"user","uuid":"u3","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"ok output"}]}}',
  '{"type":"assistant","uuid":"u4","message":{"role":"assistant","stop_reason":"end_turn","content":[{"type":"text","text":"Done"}]}}',
  '{"type":"user","uuid":"u5","promptId":"p2","message":{"role":"user","content":"Second prompt"}}',
  '{"type":"assistant","uuid":"u6","message":{"role":"assistant","content":[{"type":"text","text":"Second reply"}]}}',
];

const ingest = (lines: readonly string[]) => {
  const ingestion = createJsonlIngestion("session.jsonl");
  const records = lines.map((line, index) => ingestion.ingestFullLine(line, index + 1));
  const session = ingestion.finishAgentSession();
  if (!session) throw new Error("fixture is not an Agent session");
  return { text: lines.join("\n"), records, session, model: createAgentSessionModel(session) };
};

const options = (overrides: Partial<TurnReportOptions> = {}): TurnReportOptions => ({
  redactions: "",
  notes: "",
  includeReasoning: false,
  ...overrides,
});

const build = (
  lines: readonly string[],
  turns: readonly number[],
  overrides: Partial<TurnReportOptions> = {},
) => {
  const { text, records, session, model } = ingest(lines);
  return buildTurnReport(
    createTextSourceRevision(1, text, "jsonl"),
    records,
    session.fileType,
    model,
    turns,
    options(overrides),
    new AbortController().signal,
  );
};

it("reports selected turns from full records with call/result line links", async () => {
  const report = await build(claudeLines, [1]);

  expect(report.lineNumbers).toEqual([1, 2, 3, 4]);
  expect(report.markdown).toContain("# Unquote turn report\n\nFormat: Claude Code");
  expect(report.markdown).toContain("## Turn 1\n\n### Line 1 · User\n\n```text\nFix the bug\n```");
  expect(report.markdown).toContain("### Line 2 · Assistant\n\n```text\nLooking at it\n```");
  expect(report.markdown).toContain(
    "<summary>Line 2 · Tool call · Bash · completed · result: line 3</summary>",
  );
  expect(report.markdown).toContain(
    "<summary>Line 3 · Tool result · Bash · completed · call: line 2</summary>\n\n```text\nok output\n```",
  );
  // The display text is bounded at 8,000 characters; the report reads the Record.
  expect(report.markdown).toContain(longCommand);
  expect(report.markdown).not.toContain("[truncated]");
  expect(report.markdown).toContain('"timeout": 9007199254740993');
  expect(report.markdown).not.toContain("Private plan");
  expect(report.markdown).not.toContain("Turn 2");
});

it("includes reasoning only on request and orders turns by number", async () => {
  const report = await build(claudeLines, [2, 1], { includeReasoning: true });

  expect(report.markdown).toContain(
    "<details>\n<summary>Line 2 · Reasoning</summary>\n\n```text\nPrivate plan\n```\n\n</details>",
  );
  expect(report.markdown.indexOf("## Turn 1")).toBeLessThan(report.markdown.indexOf("## Turn 2"));
});

it("expands Codex argument strings and marks encrypted reasoning", async () => {
  const report = await build(
    [
      '{"type":"turn_context","payload":{"turn_id":"t1","model":"gpt-5"}}',
      '{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_image"},{"type":"input_text","text":"Run it"}]}}',
      '{"type":"response_item","payload":{"type":"reasoning","encrypted_content":"opaque"}}',
      '{"type":"response_item","payload":{"type":"function_call","name":"shell","call_id":"c1","arguments":"{\\"cmd\\":[\\"ls\\"],\\"token\\":\\"secret\\"}"}}',
      '{"type":"response_item","payload":{"type":"function_call_output","call_id":"c1","output":"listing"}}',
    ],
    [1],
    { includeReasoning: true, redactions: "$.payload.arguments.token" },
  );

  expect(report.markdown).toContain("### Line 2 · User\n\n```text\nRun it\n```");
  expect(report.markdown).toContain(
    "<summary>Line 3 · Reasoning</summary>\n\n_No readable content in the log._",
  );
  expect(report.markdown).toContain('"cmd": [\n    "ls"\n  ]');
  expect(report.markdown).toContain('"token": "[REDACTED]"');
  expect(report.markdown).not.toContain("secret");
  expect(report.redacted).toBe(1);
  expect(report.markdown).toContain(
    "<summary>Line 5 · Tool result · shell · completed · call: line 4</summary>",
  );
});

it("keeps a selected turn whose only content is excluded reasoning", async () => {
  const report = await build(
    [
      '{"type":"turn_context","payload":{"turn_id":"t1","model":"gpt-5"}}',
      '{"type":"response_item","payload":{"type":"reasoning","summary":[{"text":"Plan"}]}}',
    ],
    [1],
  );

  expect(report.markdown).toContain("## Turn 1\n\n_No exported content in this turn._");
  expect(report.lineNumbers).toEqual([]);
});

it("applies redaction paths to rendered content and their ancestors", async () => {
  const field = await build(claudeLines, [1], {
    redactions: "$.message.content[2].input.command",
  });
  expect(field.redacted).toBe(1);
  expect(field.markdown).not.toContain(longCommand);
  expect(field.markdown).toContain('"command": "[REDACTED]"');

  const ancestor = await build(claudeLines, [1], { redactions: "$.message" });
  expect(ancestor.redacted).toBe(4);
  expect(ancestor.markdown).not.toContain("Fix the bug");
  expect(ancestor.markdown).toContain("### Line 1 · User\n\n```text\n[REDACTED]\n```");
});

it("rejects missing turns and content beyond the report limits", async () => {
  await expect(build(claudeLines, [3])).rejects.toThrow("missing-turns");
  await expect(build(claudeLines, [])).rejects.toThrow("missing-turns");

  const prompt = '{"type":"user","uuid":"u","promptId":"p1","message":{"content":"go"}}';
  const reply =
    '{"type":"assistant","uuid":"a","message":{"content":[{"type":"text","text":"."}]}}';
  await expect(build([prompt, ...Array.from({ length: 1000 }, () => reply)], [1])).rejects.toThrow(
    RangeError,
  );

  const huge = `{"type":"user","uuid":"u","promptId":"p1","message":{"content":"${"y".repeat(8 * 1024 * 1024)}"}}`;
  await expect(build([huge, reply], [1])).rejects.toThrow(RangeError);
});

it("rejects unhydrated records and streams local records without truncation", async () => {
  const { text, session, model } = ingest(claudeLines);
  const previews = claudeLines.map((line, index) => parsePreviewJsonlRecordLine(line, index + 1));
  const request = (source: Parameters<typeof buildTurnReport>[0]) =>
    buildTurnReport(
      source,
      previews,
      session.fileType,
      model,
      [1],
      options(),
      new AbortController().signal,
    );

  await expect(request(createTextSourceRevision(1, text, "jsonl"))).rejects.toThrow(
    "invalid-record",
  );

  const access = createLocalFileAccess(createStreamFile(text, "session.jsonl").file);
  try {
    const streamed = await request(createStreamingFileSourceRevision(1, access, "jsonl"));
    expect(streamed).toEqual(await build(claudeLines, [1]));
  } finally {
    access.dispose();
  }
});

it("stops when its work is cancelled", async () => {
  const { text, records, session, model } = ingest(claudeLines);
  const controller = new AbortController();
  controller.abort();
  await expect(
    buildTurnReport(
      createTextSourceRevision(1, text, "jsonl"),
      records,
      session.fileType,
      model,
      [1],
      options(),
      controller.signal,
    ),
  ).rejects.toThrow();
});
