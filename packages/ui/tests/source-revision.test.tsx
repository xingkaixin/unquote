import { parseInput } from "@unquote/core";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useMemo } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useParser } from "../src/hooks/use-parser";
import { useRecordPipeline } from "../src/hooks/use-record-pipeline";
import { useSearchWorker } from "../src/hooks/use-search-worker";
import { I18nProvider } from "../src/i18n/context";
import { createLocalFileAccess } from "../src/lib/local-file-source";
import { shareSourceRevision } from "../src/lib/source-revision";
import type { SearchMatch } from "../src/lib/record-search";

const options = { regex: false, caseSensitive: false, jq: false };

const match = (): SearchMatch => ({
  recordId: "record-1",
  pathText: "$.value",
  keyRanges: [],
  valueRanges: [],
  pathRanges: [],
  stringifiedPathChain: [],
});

class ControlledWorker {
  static parserWorkers: ControlledWorker[] = [];
  static searchWorkers: ControlledWorker[] = [];
  listener: ((event: MessageEvent) => void) | null = null;
  messages: Array<{ type: string; requestId: number }> = [];

  constructor(url: URL) {
    if (String(url).includes("search-worker")) {
      ControlledWorker.searchWorkers.push(this);
    } else {
      ControlledWorker.parserWorkers.push(this);
    }
  }

  addEventListener(_type: string, listener: (event: MessageEvent) => void) {
    this.listener = listener;
  }

  removeEventListener(_type: string, listener: (event: MessageEvent) => void) {
    if (this.listener === listener) {
      this.listener = null;
    }
  }

  terminate() {
    this.listener = null;
  }

  postMessage(message: { type: string; requestId: number }) {
    this.messages.push(message);
  }

  respond(data: unknown) {
    this.listener?.({ data } as MessageEvent);
  }
}

interface CommitSnapshot {
  sourceRevision: number;
  parserRevision: number;
  searchRevision: number;
  records: string;
  matches: number;
}

let commits: CommitSnapshot[] = [];

interface ProbeProps {
  sourceRevision: number;
  text: string;
  forcedFormat?: "json" | "jsonl";
  sourceFile?: File | null;
}

const RevisionProbe = ({
  sourceRevision,
  text,
  forcedFormat = "json",
  sourceFile = null,
}: ProbeProps) => {
  const sourceAccess = useMemo(
    () => (sourceFile ? createLocalFileAccess(sourceFile) : null),
    [sourceFile],
  );
  const parser = useParser({ input: text, forcedFormat, sourceAccess, sourceRevision });
  const search = useSearchWorker({
    text,
    forcedFormat,
    sourceAccess,
    sourceRevision,
    query: "needle",
    options,
  });
  const aligned = shareSourceRevision(sourceRevision, parser, search);
  const pipeline = useRecordPipeline({
    sourceRevision,
    result: parser.result,
    searchMatches: aligned ? search.matches : null,
    recordFilter: "all",
  });
  const records = pipeline.visibleRecords.map((record) => record.summary).join(",");
  commits.push({
    sourceRevision,
    parserRevision: parser.sourceRevision,
    searchRevision: search.sourceRevision,
    records,
    matches: pipeline.matchCount,
  });

  return (
    <div>
      <div data-testid="records">{records}</div>
      <div data-testid="matches">{pipeline.matchCount}</div>
    </div>
  );
};

const Probe = (props: ProbeProps) => (
  <I18nProvider>
    <RevisionProbe {...props} />
  </I18nProvider>
);

const completeParser = (worker: ControlledWorker, requestId: number, text: string) => {
  const result = parseInput(text, { forcedFormat: "json" });
  worker.respond({
    type: "complete-result",
    requestId,
    result,
    agentSession: null,
    progress: {
      processedLines: result.stats.total,
      success: result.stats.success,
      failed: result.stats.failed,
      elapsedMs: 1,
      done: true,
    },
  });
};

describe("Source Revision", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    commits = [];
    ControlledWorker.parserWorkers = [];
    ControlledWorker.searchWorkers = [];
    Object.assign(globalThis, { Worker: ControlledWorker });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    Reflect.deleteProperty(globalThis, "Worker");
  });

  it("commits parser and search derivations only within the active revision", async () => {
    const first = '{"value":"old needle"}';
    const second = '{"value":"new needle"}';
    const third = '{"value":"latest needle"}';
    const { rerender } = render(<Probe sourceRevision={1} text={first} />);
    await act(() => vi.advanceTimersByTimeAsync(121));

    const parserWorker = ControlledWorker.parserWorkers[0]!;
    const firstSearchWorker = ControlledWorker.searchWorkers[0]!;
    act(() => completeParser(parserWorker, 1, first));
    act(() => firstSearchWorker.respond({ type: "result", requestId: 1, matches: [match()] }));
    expect(screen.getByTestId("records")).toHaveTextContent("value:old needle");
    expect(screen.getByTestId("matches")).toHaveTextContent("1");

    rerender(<Probe sourceRevision={2} text={second} />);
    await act(() => vi.advanceTimersByTimeAsync(121));
    const secondSearchWorker = ControlledWorker.searchWorkers.at(-1)!;
    act(() => secondSearchWorker.respond({ type: "result", requestId: 2, matches: [match()] }));
    act(() => completeParser(parserWorker, 1, first));
    expect(screen.getByTestId("records")).toHaveTextContent("");
    expect(screen.getByTestId("matches")).toHaveTextContent("0");
    act(() => completeParser(parserWorker, 2, second));
    expect(screen.getByTestId("records")).toHaveTextContent("value:new needle");
    expect(screen.getByTestId("matches")).toHaveTextContent("1");

    rerender(<Probe sourceRevision={3} text={third} />);
    await act(() => vi.advanceTimersByTimeAsync(121));
    const thirdSearchWorker = ControlledWorker.searchWorkers.at(-1)!;
    act(() => completeParser(parserWorker, 3, third));
    expect(screen.getByTestId("records")).toHaveTextContent("value:latest needle");
    expect(screen.getByTestId("matches")).toHaveTextContent("0");
    act(() => thirdSearchWorker.respond({ type: "result", requestId: 3, matches: [match()] }));
    expect(screen.getByTestId("matches")).toHaveTextContent("1");

    expect(
      commits.every(
        (entry) =>
          entry.sourceRevision === entry.parserRevision &&
          entry.sourceRevision === entry.searchRevision,
      ),
    ).toBe(true);
    expect(
      commits
        .filter((entry) => entry.sourceRevision >= 2)
        .some((entry) => entry.records.includes("old needle")),
    ).toBe(false);
  });

  it("invalidates committed derivations for mode and text-to-file revisions", async () => {
    const text = '{"value":"needle"}';
    const { rerender } = render(<Probe sourceRevision={1} text={text} />);
    await act(() => vi.advanceTimersByTimeAsync(121));
    const parserWorker = ControlledWorker.parserWorkers[0]!;
    act(() => completeParser(parserWorker, 1, text));
    act(() =>
      ControlledWorker.searchWorkers[0]!.respond({
        type: "result",
        requestId: 1,
        matches: [match()],
      }),
    );
    expect(screen.getByTestId("matches")).toHaveTextContent("1");

    rerender(<Probe sourceRevision={2} text={text} forcedFormat="jsonl" />);
    expect(screen.getByTestId("records")).toHaveTextContent("");
    expect(screen.getByTestId("matches")).toHaveTextContent("0");

    const file = new File(['{"value":"file needle"}\n'], "source.jsonl");
    rerender(<Probe sourceRevision={3} text="" forcedFormat="jsonl" sourceFile={file} />);
    expect(screen.getByTestId("records")).toHaveTextContent("");
    expect(screen.getByTestId("matches")).toHaveTextContent("0");
  });
});
