import { parseInput } from "@unquote/core";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useMemo } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useParser } from "../src/hooks/use-parser";
import { useRecordPipeline } from "../src/hooks/use-record-pipeline";
import { useSearchWorker } from "../src/hooks/use-search-worker";
import { I18nProvider } from "../src/i18n/context";
import { createLocalFileAccess } from "../src/lib/local-file-source";
import {
  createStreamingFileSourceRevision,
  createTextSourceRevision,
} from "../src/lib/published-source";
import { shareSourceRevision } from "../src/lib/source-revision";
import type { SearchMatch, SearchResultSet } from "../src/lib/record-search";
import { MockWorkerEvents } from "./helpers/mock-worker-events";

const options = { syntax: "text", caseSensitive: false } as const;

const match = (): SearchMatch => ({
  recordId: "record-1",
  pathText: "$.value",
  keyRanges: [],
  valueRanges: [],
  pathRanges: [],
  stringifiedPathChain: [],
});

const searchResult = (): SearchResultSet => ({
  total: 1,
  matchLineNumbers: Float64Array.from([1]),
  window: { matchIndexes: Float64Array.from([0]), matches: [match()] },
});

class ControlledWorker extends MockWorkerEvents {
  static parserWorkers: ControlledWorker[] = [];
  static searchWorkers: ControlledWorker[] = [];
  messages: Array<{ type: string; requestId: number }> = [];

  constructor(url: URL) {
    super();
    if (String(url).includes("search-worker")) {
      ControlledWorker.searchWorkers.push(this);
    } else {
      ControlledWorker.parserWorkers.push(this);
    }
  }

  terminate() {
    this.clearListeners();
  }

  postMessage(message: { type: string; requestId: number }) {
    this.messages.push(message);
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
  query?: string;
}

const RevisionProbe = ({
  sourceRevision,
  text,
  forcedFormat = "json",
  sourceFile = null,
  query = "needle",
}: ProbeProps) => {
  const source = useMemo(
    () =>
      sourceFile
        ? createStreamingFileSourceRevision(
            sourceRevision,
            createLocalFileAccess(sourceFile),
            "jsonl",
          )
        : createTextSourceRevision(sourceRevision, text, forcedFormat),
    [forcedFormat, sourceFile, sourceRevision, text],
  );
  const parser = useParser({ source });
  const search = useSearchWorker({
    source,
    query,
    options,
  });
  const aligned = shareSourceRevision(sourceRevision, parser, search);
  const pipeline = useRecordPipeline({
    sourceRevision,
    result: parser.result,
    searchResult: aligned ? search.result : null,
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

const renderAfterMount = (props: ProbeProps) => {
  const rendered = render(<Probe sourceRevision={0} text="" query="" />);
  rendered.rerender(<Probe {...props} />);
  return rendered;
};

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
    const { rerender } = renderAfterMount({ sourceRevision: 1, text: first });
    await act(() => vi.advanceTimersByTimeAsync(121));

    const parserWorker = ControlledWorker.parserWorkers[0]!;
    const firstSearchWorker = ControlledWorker.searchWorkers[0]!;
    act(() => completeParser(parserWorker, 1, first));
    act(() => firstSearchWorker.respond({ type: "result", requestId: 2, result: searchResult() }));
    expect(screen.getByTestId("records")).toHaveTextContent("value:old needle");
    expect(screen.getByTestId("matches")).toHaveTextContent("1");

    rerender(<Probe sourceRevision={2} text={second} />);
    await act(() => vi.advanceTimersByTimeAsync(121));
    const secondSearchWorker = ControlledWorker.searchWorkers.at(-1)!;
    act(() => secondSearchWorker.respond({ type: "result", requestId: 3, result: searchResult() }));
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
    act(() => thirdSearchWorker.respond({ type: "result", requestId: 4, result: searchResult() }));
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
    const { rerender } = renderAfterMount({ sourceRevision: 1, text });
    await act(() => vi.advanceTimersByTimeAsync(121));
    const parserWorker = ControlledWorker.parserWorkers[0]!;
    act(() => completeParser(parserWorker, 1, text));
    act(() =>
      ControlledWorker.searchWorkers[0]!.respond({
        type: "result",
        requestId: 2,
        result: searchResult(),
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
