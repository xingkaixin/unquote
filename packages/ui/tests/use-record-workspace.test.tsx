import type { ParseResult } from "@unquote/core";
import { parseInput } from "@unquote/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { describe, expect, it } from "vitest";
import { useRecordWorkspace } from "../src/hooks/use-record-workspace";
import { useQueryInteraction } from "../src/hooks/use-query-interaction";
import { I18nProvider } from "../src/i18n/context";
import { createTextSourceRevision } from "../src/lib/published-source";
import { copyBytesLimit } from "../src/lib/record-export";
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

const useTestWorkspace = ({ sourceRevision, sourceText, ...input }: WorkspaceInput) => {
  const source = createTextSourceRevision(sourceRevision, sourceText, "jsonl");
  const query = useQueryInteraction({
    ...input,
    source,
    translateError: (reason) => reason,
  });
  return {
    ...useRecordWorkspace({ source, result: input.result, agentSession: null, query }),
    testQuery: query,
  };
};

describe("useRecordWorkspace", () => {
  it("does not block a small visible payload because the source text is large", () => {
    const result = parseInput('{"value":1}', { forcedFormat: "jsonl" });
    const { result: workspace } = renderHook(
      () =>
        useTestWorkspace({
          sourceRevision: 0,
          resultRevision: 0,
          sourceText: "x".repeat(copyBytesLimit + 1),
          result,
          recordAppend: null,
        }),
      { wrapper },
    );

    expect(workspace.current.toolbar.copyBlocked).toBe(false);
    expect(workspace.current.toolbar).not.toHaveProperty("copyText");
    expect(workspace.current.toolbar).not.toHaveProperty("onCopyRecord");
  });

  it("opens an existing endpoint Record without replacing trajectory detail", () => {
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
    const selection = {
      kind: "trajectory",
      id: "tool-call:evidence-0",
      recordId: result.records[0]!.id,
    } as const;

    let opened = false;
    act(() => {
      opened = workspace.current.agent.openEndpoint(selection, result.records[1]!.id);
    });

    expect(opened).toBe(true);
    expect(workspace.current.model.active.id).toBe(result.records[1]!.id);
    expect(workspace.current.agent.detailSelection).toBe(selection);
    expect(workspace.current.model.scrollIntent).toEqual({
      kind: "record",
      recordId: result.records[1]!.id,
    });
    expect(workspace.current.testQuery.snapshot.recordFilter).toBe("all");
  });

  it("reveals and selects a Record through the Agent capability", () => {
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

    act(() => workspace.current.testQuery.intent.setFilter("errors"));
    expect(workspace.current.model.active.record).toBeNull();

    let opened = false;
    act(() => {
      opened = workspace.current.agent.openRecord(result.records[1]!.id);
    });

    expect(opened).toBe(true);
    expect(workspace.current.testQuery.snapshot.recordFilter).toBe("all");
    expect(workspace.current.model.active.id).toBe(result.records[1]!.id);
    expect(workspace.current.agent.detailSelection).toEqual({
      kind: "record",
      recordId: result.records[1]!.id,
    });
  });

  it("does not change an existing filter while opening a visible endpoint Record", () => {
    const sourceText = "invalid-one\ninvalid-two";
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
    const selection = {
      kind: "trajectory",
      id: "tool-call:evidence-0",
      recordId: result.records[0]!.id,
    } as const;

    act(() => workspace.current.testQuery.intent.setFilter("errors"));
    act(() => workspace.current.agent.openEndpoint(selection, result.records[1]!.id));

    expect(workspace.current.testQuery.snapshot.recordFilter).toBe("errors");
    expect(workspace.current.model.active.id).toBe(result.records[1]!.id);
    expect(workspace.current.agent.detailSelection).toBe(selection);
  });

  it("reuses filtered Record IDs across selection changes", () => {
    const sourceText = "invalid-one\ninvalid-two\ninvalid-three";
    const result = parseInput(sourceText, { forcedFormat: "jsonl" });
    const trackedRecord = result.records[2]!;
    const trackedRecordId = trackedRecord.id;
    let idReads = 0;
    Object.defineProperty(trackedRecord, "id", {
      configurable: true,
      enumerable: true,
      get: () => {
        idReads += 1;
        return trackedRecordId;
      },
    });
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

    act(() => workspace.current.testQuery.intent.setFilter("errors"));
    idReads = 0;
    act(() => workspace.current.model.intent.selectRecord(result.records[1]!));

    expect(idReads).toBe(0);
  });

  it("does not update selection when an endpoint Record is absent", () => {
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
    const selection = {
      kind: "trajectory",
      id: "tool-call:evidence-0",
      recordId: result.records[0]!.id,
    } as const;
    const activeRecordId = workspace.current.model.active.id;
    const detailSelection = workspace.current.agent.detailSelection;
    const scrollIntent = workspace.current.model.scrollIntent;

    let opened = true;
    act(() => {
      opened = workspace.current.agent.openEndpoint(selection, "missing-record");
    });

    expect(opened).toBe(false);
    expect(workspace.current.model.active.id).toBe(activeRecordId);
    expect(workspace.current.agent.detailSelection).toBe(detailSelection);
    expect(workspace.current.model.scrollIntent).toBe(scrollIntent);
  });

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

  it("projects hidden selection away without destroying it", () => {
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
    expect(workspace.current.agent.detailSelection).toEqual({
      kind: "record",
      recordId: result.records[1]!.id,
    });

    act(() => workspace.current.testQuery.intent.setFilter("errors"));
    expect(workspace.current.model.active.record).toBeNull();
    expect(workspace.current.agent.detailSelection).toBeNull();

    act(() => workspace.current.testQuery.intent.setFilter("all"));
    expect(workspace.current.model.active.record).toBe(result.records[1]);
    expect(workspace.current.agent.detailSelection).toEqual({
      kind: "record",
      recordId: result.records[1]!.id,
    });
  });

  it("preserves trajectory detail when a Record filter hides its primary Record", () => {
    const sourceText = 'invalid\n{"value":2}';
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
    const endpointRecord = result.records[0]!;
    const selection = {
      kind: "trajectory",
      id: "item-1",
      recordId: result.records[1]!.id,
    } as const;

    act(() => workspace.current.agent.openEndpoint(selection, endpointRecord.id));
    act(() => workspace.current.testQuery.intent.setFilter("errors"));

    expect(workspace.current.testQuery.snapshot.recordFilter).toBe("errors");
    expect(workspace.current.model.active.id).toBe(endpointRecord.id);
    expect(workspace.current.model.active.record).toBe(endpointRecord);
    expect(workspace.current.agent.detailSelection).toBe(selection);
    expect(workspace.current.model.scrollIntent).toBeNull();
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
    const detailSelection = workspace.current.agent.detailSelection;
    const scrollIntent = workspace.current.model.scrollIntent;

    rerender({
      sourceRevision: 0,
      resultRevision: 0,
      sourceText,
      result: fullResult,
      recordAppend: { previousRecords: initialResult.records },
    });

    expect(workspace.current.model.active.id).toBe(initialResult.records[1]!.id);
    expect(workspace.current.agent.detailSelection).toBe(detailSelection);
    expect(workspace.current.model.scrollIntent).toBe(scrollIntent);
  });

  it("preserves a trajectory selection while its endpoint Record survives an append", () => {
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
      { initialProps, wrapper },
    );
    const selection = {
      kind: "trajectory",
      id: "tool-call:evidence-0",
      recordId: initialResult.records[0]!.id,
    } as const;

    act(() => workspace.current.agent.openEndpoint(selection, initialResult.records[1]!.id));
    const scrollIntent = workspace.current.model.scrollIntent;

    rerender({
      sourceRevision: 0,
      resultRevision: 0,
      sourceText,
      result: fullResult,
      recordAppend: { previousRecords: initialResult.records },
    });

    expect(workspace.current.model.active.id).toBe(initialResult.records[1]!.id);
    expect(workspace.current.agent.detailSelection).toBe(selection);
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

    act(() => workspace.current.testQuery.intent.changeToolbarQuery("target"));
    await waitFor(() => expect(workspace.current.model.active.expandedNestedCount).toBe(1));

    act(() => workspace.current.model.intent.collapseAll());
    expect(workspace.current.model.active.expandedNestedCount).toBe(0);

    rerender({
      sourceRevision: 0,
      resultRevision: 0,
      sourceText,
      result,
      recordAppend: null,
    });
    expect(workspace.current.model.active.expandedNestedCount).toBe(0);

    act(() => workspace.current.testQuery.intent.changeToolbarQuery("missing"));
    await waitFor(() => expect(workspace.current.testQuery.snapshot.searchStatus).toBe("complete"));

    act(() => workspace.current.testQuery.intent.changeToolbarQuery("target"));
    await waitFor(() => expect(workspace.current.model.active.expandedNestedCount).toBe(1));
  });
});
