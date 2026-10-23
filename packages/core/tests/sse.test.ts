import { describe, expect, it } from "vitest";
import { formatResult, isFullRecord, isLikelySse, parseInput, stringifyJsonNode } from "../src";
import type { JsonlRecord } from "../src";
import { createSseRecordReader } from "../src/ingestion";

const recordJson = (record: JsonlRecord | undefined) => {
  if (!record || !isFullRecord(record)) {
    throw new Error("Expected a Full Record");
  }
  return JSON.parse(stringifyJsonNode(record.node));
};

const openAiStream = [
  'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hi"}}]}',
  "",
  'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"!"}}]}',
  "",
  "data: [DONE]",
  "",
  "",
].join("\n");

const anthropicStream = [
  "retry: 3000",
  "",
  "event: message_start",
  'data: {"type":"message_start","message":{"usage":{"input_tokens":12}}}',
  "",
  ": keep-alive",
  "",
  ": ping comment",
  "event: content_block_delta",
  "id: evt-2",
  'data: {"type":"content_block_delta",',
  'data: "delta":{"text":"Hello"}}',
  "",
].join("\n");

describe("SSE Records", () => {
  it("turns each dispatched event into a Record linked to its first line", () => {
    const result = parseInput(openAiStream);

    expect(result.format).toBe("sse");
    expect(result.stats).toEqual({ total: 3, success: 3, failed: 0 });
    expect(result.records.map(({ id, lineNumber }) => ({ id, lineNumber }))).toEqual([
      { id: "record-1", lineNumber: 1 },
      { id: "record-3", lineNumber: 3 },
      { id: "record-5", lineNumber: 5 },
    ]);
    expect(recordJson(result.records[0])).toEqual({
      data: { id: "chatcmpl-1", choices: [{ delta: { content: "Hi" } }] },
    });
    expect(result).toEqual(parseInput(openAiStream, { forcedFormat: "sse" }));
  });

  it("keeps a non-JSON data payload as a string", () => {
    const record = parseInput(openAiStream).records[2];

    expect(record?.status).toBe("full");
    expect(recordJson(record)).toEqual({ data: "[DONE]" });
  });

  it("expands data as Stringified JSON and keeps the SSE text", () => {
    const record = parseInput(openAiStream).records[0];
    if (
      !record ||
      !isFullRecord(record) ||
      record.node.kind !== "object" ||
      !record.node.children
    ) {
      throw new Error("Expected an object Record");
    }

    expect(record.node.children.data).toMatchObject({
      kind: "object",
      rawString: '{"id":"chatcmpl-1","choices":[{"delta":{"content":"Hi"}}]}',
    });
  });

  it("follows the WHATWG field, comment, and dispatch rules", () => {
    const result = parseInput(anthropicStream);

    expect(result.records.map((record) => record.lineNumber)).toEqual([3, 8]);
    expect(recordJson(result.records[0])).toEqual({
      event: "message_start",
      data: { type: "message_start", message: { usage: { input_tokens: 12 } } },
    });
    expect(recordJson(result.records[1])).toEqual({
      event: "content_block_delta",
      id: "evt-2",
      data: { type: "content_block_delta", delta: { text: "Hello" } },
    });
  });

  it.each([
    ["no space after the colon", "data:x", { data: "x" }],
    ["one leading space removed", "data:  x", { data: " x" }],
    ["a field line without a colon", "data", { data: "" }],
    ["an unknown field", "data: x\nfoo: bar", { data: "x" }],
    ["a numeric retry", "retry: 1500\ndata: x", { retry: 1500, data: "x" }],
    ["a non-numeric retry", "retry: soon\ndata: x", { data: "x" }],
    ["an id containing NULL", "id: a\0b\ndata: x", { data: "x" }],
    ["the last event field", "event: a\nevent: b\ndata: x", { event: "b", data: "x" }],
  ])("parses %s", (_label, input, expected) => {
    expect(recordJson(parseInput(input, { forcedFormat: "sse" }).records[0])).toEqual(expected);
  });

  it("dispatches an event left open at end of input", () => {
    const result = parseInput("data: 1\n\ndata: 2", { forcedFormat: "sse" });

    expect(result.records.map(recordJson)).toEqual([{ data: 1 }, { data: 2 }]);
  });

  it("does not treat a whitespace-only line as a dispatch", () => {
    const result = parseInput("data: a\n \ndata: b\n", { forcedFormat: "sse" });

    expect(result.records.map(recordJson)).toEqual([{ data: "a\nb" }]);
  });

  it("handles CRLF line endings and a leading BOM", () => {
    const result = parseInput("﻿event: ping\r\ndata: {}\r\n\r\ndata: 2\r\n");

    expect(result.format).toBe("sse");
    expect(result.records.map(recordJson)).toEqual([{ event: "ping", data: {} }, { data: 2 }]);
  });

  it("preserves number lexemes inside expanded data", () => {
    const result = parseInput('data: {"price":1.10,"id":12345678901234567890}\n');

    expect(formatResult(result)).toBe('{"data":{"price":1.10,"id":12345678901234567890}}');
  });

  it("assembles the same Records when fed line by line", () => {
    const reader = createSseRecordReader();
    const records = [
      ...anthropicStream.split("\n").map((line, index) => reader.pushLine(line, index + 1)),
      reader.finish(),
    ].filter((record) => record !== null);

    expect(records).toEqual(parseInput(anthropicStream).records);
  });
});

describe("isLikelySse", () => {
  it.each([
    ["an OpenAI stream", openAiStream],
    ["an Anthropic stream", anthropicStream],
    ["a stream with a BOM", "﻿data: {}\n\n"],
  ])("recognizes %s", (_label, input) => {
    expect(isLikelySse(input)).toBe(true);
  });

  it.each([
    ["JSONL", '{"a":1}\n{"a":2}'],
    ["a JSON document", '{\n  "data": 1\n}'],
    ["fields without data", "event: ping\nid: 1\n"],
    ["a data line followed by other text", "data: 1\nhello world"],
    ["an indented field", "  data: 1"],
    ["a field whose name only starts with data", "database: x"],
  ])("rejects %s", (_label, input) => {
    expect(isLikelySse(input)).toBe(false);
  });
});
