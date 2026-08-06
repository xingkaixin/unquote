import { parseInput } from "@unquote/core";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecordList } from "../src/components/record-list";
import { I18nProvider } from "../src/i18n/context";
import type { RecordViewModel } from "../src/lib/record-view";

afterEach(cleanup);

describe("RecordList", () => {
  it("selects a path only in its owning record", () => {
    const records = parseInput('{"value":1}\n{"value":2}', { forcedFormat: "jsonl" }).records;
    const selectedRecord = records[1]!;
    const recordView: RecordViewModel = {
      state: {
        recordInsights: new Map(),
        resolveRecord: (record) => record,
        expandedStringifiedPathsByRecord: new Map(),
        selectedPath: { recordId: selectedRecord.id, pathText: "$.value" },
      },
      actions: {
        togglePath: vi.fn(),
        copyRecord: vi.fn(),
        copyRawLine: vi.fn(),
        copyError: vi.fn(),
        selectNode: vi.fn(),
        requestFullRecord: vi.fn(),
      },
    };

    render(
      <I18nProvider>
        <RecordList
          records={records}
          recordView={recordView}
          searchMatches={[]}
          activeMatch={null}
          scrollIntent={null}
          onActiveRecordChange={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(document.getElementById(`${records[0]!.id}:$.value`)).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(document.getElementById(`${selectedRecord.id}:$.value`)).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("does not reread layout for every append after virtualization starts", () => {
    const records = parseInput(
      Array.from({ length: 162 }, (_, index) => JSON.stringify({ value: index })).join("\n"),
      { forcedFormat: "jsonl" },
    ).records;
    const recordView: RecordViewModel = {
      state: {
        recordInsights: new Map(),
        resolveRecord: (record) => record,
        expandedStringifiedPathsByRecord: new Map(),
        selectedPath: null,
      },
      actions: {
        togglePath: vi.fn(),
        copyRecord: vi.fn(),
        copyRawLine: vi.fn(),
        copyError: vi.fn(),
        selectNode: vi.fn(),
        requestFullRecord: vi.fn(),
      },
    };
    const view = (visibleRecords: typeof records) => (
      <I18nProvider>
        <RecordList
          records={visibleRecords}
          recordView={recordView}
          searchMatches={[]}
          activeMatch={null}
          scrollIntent={null}
          onActiveRecordChange={vi.fn()}
        />
      </I18nProvider>
    );
    const { container, rerender } = render(view(records.slice(0, 161)));
    const list = container.firstElementChild as HTMLElement;
    const getBoundingClientRect = vi.fn(() => new DOMRect(0, 100, 100, 100));
    Object.defineProperty(list, "getBoundingClientRect", {
      configurable: true,
      value: getBoundingClientRect,
    });

    rerender(view(records));

    expect(getBoundingClientRect).not.toHaveBeenCalled();
  });
});
