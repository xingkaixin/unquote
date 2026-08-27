import { parseJsonlRecordLine } from "@unquote/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecordParserRequest } from "../src/worker/record-parser-worker";

const loadWorker = async () => {
  const scope = {
    onmessage: null as ((event: MessageEvent<RecordParserRequest>) => void) | null,
    postMessage: vi.fn(),
  };
  vi.stubGlobal("self", scope);
  await import("../src/worker/record-parser-worker");
  return scope;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("record parser worker", () => {
  it("parses selected lines with their canonical ids, nested JSON, and numeric lexemes", async () => {
    const scope = await loadWorker();
    const lines = new Map([
      [3, '{"value":9007199254740993,"nested":"{\\"ok\\":true}"}'],
      [7, "invalid json"],
    ]);
    scope.onmessage?.({ data: { requestId: 9, lines } } as MessageEvent<RecordParserRequest>);
    expect(scope.postMessage).toHaveBeenCalledWith({
      type: "result",
      requestId: 9,
      records: new Map(
        [...lines].map(([number, line]) => [number, parseJsonlRecordLine(line, number)]),
      ),
    });
  });

  it("reports unexpected failures without posting source text or raw exceptions", async () => {
    const scope = await loadWorker();
    scope.postMessage.mockImplementationOnce(() => {
      throw new Error("private input");
    });
    scope.onmessage?.({
      data: { requestId: 5, lines: new Map() },
    } as MessageEvent<RecordParserRequest>);
    expect(scope.postMessage).toHaveBeenLastCalledWith({ type: "error", requestId: 5 });
  });
});
