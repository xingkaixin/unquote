import type { ParseResult } from "@unquote/core";
import { parseInput } from "@unquote/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { describe, expect, it } from "vitest";
import { useRecordWorkspace } from "../src/hooks/use-record-workspace";
import { I18nProvider } from "../src/i18n/context";
import { createTextSourceRevision, projectSourceWork } from "../src/lib/published-source";
import type { RecordAppend } from "../src/lib/record-sequence";

const wrapper = ({ children }: PropsWithChildren) => <I18nProvider>{children}</I18nProvider>;

const resultPrefix = (result: ParseResult, count: number): ParseResult => {
  const records = result.records.slice(0, count);
  const success = records.filter((record) => record.status !== "failed").length;
  return {
    format: result.format,
    records,
    stats: { total: records.length, success, failed: records.length - success },
  };
};

interface WorkspaceInput {
  sourceRevision: number;
  resultRevision: number;
  sourceText: string;
  result: ParseResult;
  recordAppend: RecordAppend | null;
}

const useTestWorkspace = ({ sourceRevision, sourceText, ...input }: WorkspaceInput) =>
  useRecordWorkspace({
    ...input,
    source: projectSourceWork(createTextSourceRevision(sourceRevision, sourceText, "jsonl")),
    agentSession: null,
    translateError: (reason) => reason,
  });

describe("useRecordWorkspace", () => {
  it("projects the first visible Record before descendants commit", () => {
    const sourceText = '{"value":1}\n{"value":2}';
    const result = parseInput(sourceText, { forcedFormat: "jsonl" });
    const { result: workspace } = renderHook(
      () =>
        useTestWorkspace({
          sourceRevision: 0,
          resultRevision: 0,
          sourceText,
          result,
          recordAppend: null,
        }),
      { wrapper },
    );

    expect(workspace.current.model.active.id).toBe(result.records[0]!.id);
    expect(workspace.current.model.active.record).toBe(result.records[0]);
  });

  it("clears hidden selection without restoring it when the filter opens again", () => {
    const sourceText = '{"value":1}\n{"value":2}';
    const result = parseInput(sourceText, { forcedFormat: "jsonl" });
    const { result: workspace } = renderHook(
      () =>
        useTestWorkspace({
          sourceRevision: 0,
          resultRevision: 0,
          sourceText,
          result,
          recordAppend: null,
        }),
      { wrapper },
    );

    act(() => workspace.current.model.intent.selectRecord(result.records[1]!));
    expect(workspace.current.detailSelection).toEqual({
      kind: "record",
      recordId: result.records[1]!.id,
    });

    act(() => workspace.current.query.intent.setFilter("errors"));
    expect(workspace.current.model.active.record).toBeNull();
    expect(workspace.current.detailSelection).toBeNull();

    act(() => workspace.current.query.intent.setFilter("all"));
    expect(workspace.current.model.active.record).toBe(result.records[0]);
    expect(workspace.current.detailSelection).toBeNull();
  });

  it("preserves selection references across an authenticated stream append", () => {
    const sourceText = '{"value":1}\n{"value":2}\n{"value":3}';
    const fullResult = parseInput(sourceText, { forcedFormat: "jsonl" });
    const initialResult = resultPrefix(fullResult, 2);
    const initialProps: WorkspaceInput = {
      sourceRevision: 0,
      resultRevision: 0,
      sourceText,
      result: initialResult,
      recordAppend: null,
    };
    const { result: workspace, rerender } = renderHook(
      (input: WorkspaceInput) => useTestWorkspace(input),
      {
        initialProps,
        wrapper,
      },
    );

    act(() => workspace.current.model.intent.selectRecord(initialResult.records[1]!));
    const detailSelection = workspace.current.detailSelection;
    const scrollIntent = workspace.current.model.scrollIntent;

    rerender({
      sourceRevision: 0,
      resultRevision: 0,
      sourceText,
      result: fullResult,
      recordAppend: { previousRecords: initialResult.records },
    });

    expect(workspace.current.model.active.id).toBe(initialResult.records[1]!.id);
    expect(workspace.current.detailSelection).toBe(detailSelection);
    expect(workspace.current.model.scrollIntent).toBe(scrollIntent);
  });

  it("keeps Collapse All authoritative until the search window changes", async () => {
    const sourceText = JSON.stringify({ payload: JSON.stringify({ target: true }) });
    const result = parseInput(sourceText, { forcedFormat: "jsonl" });
    const { result: workspace, rerender } = renderHook(
      (input: WorkspaceInput) => useTestWorkspace(input),
      {
        initialProps: {
          sourceRevision: 0,
          resultRevision: 0,
          sourceText,
          result,
          recordAppend: null,
        },
        wrapper,
      },
    );

    act(() => workspace.current.query.intent.changeToolbarQuery("target"));
    await waitFor(() => expect(workspace.current.expandedNestedCount).toBe(1));

    act(() => workspace.current.model.intent.collapseAll());
    expect(workspace.current.expandedNestedCount).toBe(0);

    rerender({
      sourceRevision: 0,
      resultRevision: 0,
      sourceText,
      result,
      recordAppend: null,
    });
    expect(workspace.current.expandedNestedCount).toBe(0);
  });
});
