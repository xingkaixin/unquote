import { cleanup } from "@testing-library/react";
import { parsePreviewJsonlRecordLine } from "@unquote/core";
import type { JsonlRecord, ParseResult } from "@unquote/core";
import { afterEach, vi } from "vitest";
import type { SearchOptions } from "../../src/lib/record-search";
import { MockWorkerEvents } from "./mock-worker-events";

const defaultMatchMedia = vi.mocked(window.matchMedia).getMockImplementation()!;
let initialSearchWindowIndexes: Float64Array | undefined;

export const setInitialSearchWindowIndexes = (indexes: Float64Array | undefined) => {
  initialSearchWindowIndexes = indexes;
};

// Mirrors parser-worker.ts's compactForTransfer branch: the worker builds
// Preview Records straight from the source lines via core, so this mock must
// too. Re-deriving the projection here once let the mock drift from the real
// Preview shape (children retained, no preview marker), which hid UQ-120.
const compactResultForTransfer = (input: string, stats: ParseResult["stats"]): ParseResult => {
  const records: JsonlRecord[] = [];
  input.split(/\r?\n/).forEach((line, index) => {
    if (line.trim()) {
      records.push(parsePreviewJsonlRecordLine(line, index + 1));
    }
  });

  return { format: "jsonl", records, stats };
};

const readMockFileText = (file: File) => {
  if (typeof file.text === "function") {
    return file.text();
  }

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsText(file);
  });
};

Object.assign(globalThis, {
  Worker: class extends MockWorkerEvents {
    chunks = "";
    isSearchWorker: boolean;
    searchSource: {
      sourceRevision: number;
      text: string;
      forcedFormat?: "json" | "jsonl";
    } | null = null;
    constructor(...args: unknown[]) {
      super();
      this.isSearchWorker = String(args[0]).includes("search-worker");
    }
    terminate() {
      this.clearListeners();
    }
    completeSearch(
      requestId: number,
      text: string,
      forcedFormat: "json" | "jsonl" | undefined,
      query: string,
      options: unknown,
      windowIndexes?: Float64Array,
    ) {
      Promise.all([import("../../src/lib/parse-text"), import("../../src/lib/record-search")]).then(
        ([{ parseTextResult }, { searchRecords }]) => {
          const parsed = parseTextResult(text, forcedFormat);
          const result = searchRecords(
            parsed.records,
            query,
            options as SearchOptions,
            windowIndexes ?? initialSearchWindowIndexes,
          );
          this.respond({ type: "result", requestId, result });
        },
      );
    }
    completeSearchFile(
      requestId: number,
      file: File,
      query: string,
      options: unknown,
      windowIndexes?: Float64Array,
    ) {
      import("../../src/lib/local-file-source").then(({ createLocalFileAccess }) => {
        createLocalFileAccess(file)
          .search(query, options as SearchOptions, new AbortController().signal, windowIndexes)
          .then((result) => {
            this.respond({ type: "result", requestId, result });
          })
          .catch(() => {
            this.respond({ type: "error", requestId, message: "search failed" });
          });
      });
    }
    complete(requestId: number, input: string, forcedFormat?: "json" | "jsonl", compact = false) {
      import("../../src/lib/parse-text").then(({ parseText }) => {
        const parsed = parseText(input, { forcedFormat });
        const result = compact
          ? compactResultForTransfer(input, parsed.result.stats)
          : parsed.result;
        this.respond({
          type: "complete-result",
          requestId,
          result,
          agentSession: parsed.agentSession,
          progress: parsed.progress,
        });
      });
    }
    postMessage(payload: {
      type?: "parse" | "start-jsonl" | "jsonl-chunk" | "file-jsonl" | "search-text" | "search-file";
      requestId: number;
      input?: string;
      forcedFormat?: "json" | "jsonl";
      chunk?: string;
      done?: boolean;
      file?: File;
      source?:
        | {
            kind: "content";
            sourceRevision: number;
            text: string;
            forcedFormat?: "json" | "jsonl";
          }
        | { kind: "cached"; sourceRevision: number };
      query?: string;
      options?: unknown;
      windowIndexes?: Float64Array;
    }) {
      if (payload.type === "search-text") {
        if (!this.isSearchWorker || !payload.source) {
          return;
        }
        if (payload.source.kind === "content") {
          this.searchSource = {
            sourceRevision: payload.source.sourceRevision,
            text: payload.source.text,
            ...(payload.source.forcedFormat ? { forcedFormat: payload.source.forcedFormat } : {}),
          };
        }
        if (this.searchSource?.sourceRevision !== payload.source.sourceRevision) {
          this.respond({ type: "error", requestId: payload.requestId, message: "search failed" });
          return;
        }
        this.completeSearch(
          payload.requestId,
          this.searchSource.text,
          this.searchSource.forcedFormat,
          payload.query ?? "",
          payload.options,
          payload.windowIndexes,
        );
        return;
      }

      if (payload.type === "search-file") {
        if (!this.isSearchWorker || !payload.file) {
          return;
        }
        this.completeSearchFile(
          payload.requestId,
          payload.file,
          payload.query ?? "",
          payload.options,
          payload.windowIndexes,
        );
        return;
      }

      if (this.isSearchWorker) {
        return;
      }

      if (payload.type === "start-jsonl") {
        this.chunks = "";
        return;
      }

      if (payload.type === "jsonl-chunk") {
        this.chunks += payload.chunk ?? "";
        if (payload.done) {
          this.complete(payload.requestId, this.chunks, "jsonl");
        }
        return;
      }

      if (payload.type === "file-jsonl") {
        if (payload.file) {
          if (payload.file.name === "worker-failure.jsonl") {
            this.respond({
              type: "error",
              requestId: payload.requestId,
              stats: { total: 0, success: 0, failed: 0 },
              progress: {
                elapsedMs: 1,
                done: true,
              },
            });
            return;
          }
          void readMockFileText(payload.file).then((text) =>
            this.complete(payload.requestId, text, "jsonl", true),
          );
        }
        return;
      }

      this.complete(payload.requestId, payload.input ?? "", payload.forcedFormat);
    }
  },
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  initialSearchWindowIndexes = undefined;
  vi.mocked(window.matchMedia).mockImplementation(defaultMatchMedia);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn() },
  });
  localStorage.clear();
});
