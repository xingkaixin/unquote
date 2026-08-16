import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentCanonicalSelection } from "../src/lib/agent-session/types";
import type {
  AgentTrajectoryItem,
  AgentTrajectoryStatus,
  AgentTrajectoryTurn,
  AgentTrajectoryWarning,
} from "../src/lib/agent-session";
import type {
  AgentTrajectoryLedgerRow,
  AgentTrajectoryPresentationGroup,
  AgentTrajectoryPresentationItem,
} from "../src/lib/agent-session/trajectory-presentation";
import { formatClockTime } from "../src/lib/format";
import {
  formatTrajectoryDuration,
  trajectoryWarningMessageKey,
} from "../src/components/agent-trajectory-format";

const scrollToIndex = vi.fn();
let latestGetItemKey: ((index: number) => unknown) | undefined;
let latestEstimateSize: ((index: number) => number) | undefined;

vi.mock("@tanstack/react-virtual", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-virtual")>();
  return {
    ...actual,
    useVirtualizer: ((options: Parameters<typeof actual.useVirtualizer>[0]) => {
      latestGetItemKey = options.getItemKey;
      latestEstimateSize = options.estimateSize;
      const virtualizer = actual.useVirtualizer(options);
      return new Proxy(virtualizer, {
        get: (target, property, receiver) =>
          property === "scrollToIndex" ? scrollToIndex : Reflect.get(target, property, receiver),
      });
    }) as typeof actual.useVirtualizer,
  };
});

const {
  AgentTrajectoryLedger,
  trajectoryLedgerRowEstimateSize,
  trajectoryLedgerVirtualizationThreshold,
} = await import("../src/components/agent-trajectory-ledger");
const { I18nProvider } = await import("../src/i18n/context");

const selectionFor = (id: string): AgentCanonicalSelection => ({
  kind: "event",
  id: `event-${id}`,
  recordId: `record-${id}`,
});

interface ItemOptions {
  readonly kind?: AgentTrajectoryItem["kind"];
  readonly status?: AgentTrajectoryStatus;
  readonly lineNumber?: number;
  readonly timestamp?: number;
  readonly turnIndex?: number;
  readonly step?: number;
  readonly durationMs?: number;
  readonly toolName?: string;
  readonly callId?: string;
}

const itemFor = (id: string, options: ItemOptions = {}): AgentTrajectoryItem => {
  const kind = options.kind ?? "assistant";
  const status = options.status ?? "completed";

  return {
    id,
    kind,
    status,
    recordId: `record-${id}`,
    lineNumber: options.lineNumber ?? 1,
    selection: selectionFor(id),
    ...(options.timestamp === undefined ? {} : { timestamp: options.timestamp }),
    ...(options.turnIndex === undefined ? {} : { turnIndex: options.turnIndex }),
    ...(options.step === undefined ? {} : { step: { index: options.step, source: "derived" } }),
    ...(options.durationMs === undefined ? {} : { durationMs: options.durationMs }),
    ...(options.toolName === undefined ? {} : { toolName: options.toolName }),
    ...(options.callId === undefined ? {} : { callId: options.callId }),
  } as AgentTrajectoryItem;
};

const laneFor = (kind: AgentTrajectoryItem["kind"]): AgentTrajectoryPresentationItem["lane"] => {
  switch (kind) {
    case "user":
    case "system":
    case "compaction":
      return "activity";
    case "assistant":
    case "reasoning":
      return "model";
    case "tool":
    case "subagent":
      return "tool";
  }
};

const groupFor = (
  id: string,
  sourceItems: readonly AgentTrajectoryItem[],
  options: {
    readonly hasTurn?: boolean;
    readonly turnIndex?: number;
    readonly summary?: (item: AgentTrajectoryItem) => string;
    readonly turnStatus?: AgentTrajectoryStatus;
    readonly turnDurationMs?: number;
  } = {},
): AgentTrajectoryPresentationGroup => {
  const hasTurn = options.hasTurn ?? options.turnIndex !== undefined;
  const turn: AgentTrajectoryTurn | null = !hasTurn
    ? null
    : {
        id: `turn-${id}`,
        status: options.turnStatus ?? "completed",
        items: sourceItems,
        ...(options.turnIndex === undefined ? {} : { turnIndex: options.turnIndex }),
        ...(options.turnDurationMs === undefined ? {} : { durationMs: options.turnDurationMs }),
      };

  return {
    ordinal: 0,
    id,
    turn,
    items: sourceItems.map((item) => ({
      ordinal: 0,
      item,
      detail: null,
      summary: options.summary?.(item) ?? `Summary ${item.id}`,
      searchText: "",
      lane: laneFor(item.kind),
      interval:
        item.timestamp === undefined ? null : { start: item.timestamp, end: item.timestamp },
      warningGroups: [],
      turn,
      groupId: id,
    })),
  };
};

const rowsFor = (
  ...groups: readonly AgentTrajectoryPresentationGroup[]
): AgentTrajectoryLedgerRow[] => {
  let groupOrdinal = 0;
  let itemOrdinal = 0;
  const indexedGroups = groups.map((group) => ({
    ...group,
    ordinal: groupOrdinal++,
    items: group.items.map((item) => ({ ...item, ordinal: itemOrdinal++ })),
  }));
  const setSize = indexedGroups.reduce((count, group) => count + group.items.length, 0);
  const rows: AgentTrajectoryLedgerRow[] = [];
  let positionInSet = 0;
  for (const group of indexedGroups) {
    rows.push({ type: "turn-header", group });
    for (const item of group.items) {
      positionInSet += 1;
      rows.push({ type: "item", group, item, positionInSet, setSize });
    }
  }
  return rows;
};

const renderLedger = (
  rows: readonly AgentTrajectoryLedgerRow[],
  selectedItemId: string | undefined = undefined,
  onSelectItem = vi.fn(),
) => {
  const renderView = (
    nextRows: readonly AgentTrajectoryLedgerRow[],
    nextSelected: string | undefined,
  ) => (
    <I18nProvider>
      <AgentTrajectoryLedger
        rows={nextRows}
        selectedItemId={nextSelected}
        onSelectItem={onSelectItem}
      />
    </I18nProvider>
  );
  const view = render(renderView(rows, selectedItemId));

  return {
    ...view,
    onSelectItem,
    rerenderLedger: (
      nextRows: readonly AgentTrajectoryLedgerRow[] = rows,
      nextSelected: string | undefined = selectedItemId,
    ) => view.rerender(renderView(nextRows, nextSelected)),
  };
};

const largeRowsFor = () => {
  const groups = Array.from({ length: 556 }, (_, groupIndex) => {
    const itemCount = groupIndex === 555 ? 10 : 9;
    const items = Array.from({ length: itemCount }, (_, itemIndex) =>
      itemFor(`item-${groupIndex}-${itemIndex}`, {
        lineNumber: groupIndex * 10 + itemIndex + 1,
        turnIndex: groupIndex + 1,
      }),
    );
    return groupFor(`group-${groupIndex}`, items, { turnIndex: groupIndex + 1 });
  });

  return rowsFor(...groups);
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("unquote-locale", "en");
  scrollToIndex.mockClear();
  vi.mocked(HTMLElement.prototype.scrollIntoView).mockClear();
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.hasAttribute("data-index") ? trajectoryLedgerRowEstimateSize : 600;
    },
  );
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const height =
      this instanceof HTMLElement && this.hasAttribute("data-index")
        ? trajectoryLedgerRowEstimateSize
        : 600;
    return {
      width: 400,
      height,
      top: 0,
      left: 0,
      right: 400,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => {},
    } as DOMRect;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AgentTrajectoryLedger", () => {
  it("renders selectable rows with factual metadata and leaves its input unchanged", async () => {
    const timestamp = Date.UTC(2026, 0, 2, 3, 4, 5);
    const assistant = itemFor("item-assistant", {
      lineNumber: 41,
      timestamp,
      turnIndex: 3,
      step: 12,
    });
    const tool = itemFor("item-tool", {
      kind: "tool",
      lineNumber: 42,
      timestamp,
      turnIndex: 3,
      durationMs: 1_500,
      toolName: "shell",
      callId: " call-42 ",
    });
    const rows = rowsFor(
      groupFor("turn-three", [assistant, tool], {
        turnIndex: 3,
        summary: (item) => (item.id === assistant.id ? "Assistant summary" : "Tool summary"),
      }),
    );
    const beforeInteraction = JSON.stringify(rows);
    const user = userEvent.setup();
    const { onSelectItem } = renderLedger(rows, tool.id);
    const toolButton = screen.getByRole("button", { name: "Tool: Tool summary" });
    const expectedMetadata = [
      "Line 42",
      "Turn 3",
      formatClockTime(timestamp, "en"),
      `Duration: ${formatTrajectoryDuration(1_500, "en")}`,
      "Call ID:  call-42 ",
    ].join(" · ");

    expect(screen.getByRole("list", { name: "Event ledger" })).toBeInTheDocument();
    expect(toolButton).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("≈ derived step 12")).toHaveAttribute(
      "title",
      "Derived from available session data; not a source step.",
    );
    expect(
      screen.getByText((_, element) => element?.textContent === expectedMetadata),
    ).toBeInTheDocument();
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenLastCalledWith({
      block: "center",
      behavior: "smooth",
    });

    await user.click(toolButton);
    toolButton.focus();
    await user.keyboard("{Enter}");

    expect(onSelectItem).toHaveBeenNthCalledWith(1, tool.id);
    expect(onSelectItem).toHaveBeenNthCalledWith(2, tool.id);
    expect(JSON.stringify(rows)).toBe(beforeInteraction);
  });

  it("uses localized kinds for empty summaries and accessible labels", () => {
    localStorage.setItem("unquote-locale", "zh-CN");
    const rows = rowsFor(
      groupFor(
        "localized-empty",
        [
          itemFor("one", { kind: "system" }),
          itemFor("two", { kind: "assistant" }),
          itemFor("three", { kind: "compaction" }),
          itemFor("four", { kind: "tool" }),
        ],
        { turnIndex: 1, summary: () => "" },
      ),
    );

    renderLedger(rows);

    expect(screen.getByRole("button", { name: "系统: 系统" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "助手: 助手" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上下文压缩: 上下文压缩" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "工具: 工具" })).toBeInTheDocument();
    const ledger = screen.getByRole("list", { name: "事件账本" });
    expect(ledger.textContent).not.toContain("system");
    expect(ledger.textContent).not.toContain("assistant");
    expect(ledger.textContent).not.toContain("compaction");
    expect(ledger.textContent).not.toContain("tool");
  });

  it("uses the presentation-provided filtered set position without turning headers into controls", () => {
    const onlyItem = itemFor("item-only", { lineNumber: 7 });
    const rows = rowsFor(groupFor("only", [onlyItem], { turnIndex: 7 }));
    renderLedger(rows);

    expect(screen.getByRole("heading", { name: "Turn 7" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Turn 7" })).not.toBeInTheDocument();
    expect(screen.getByRole("listitem")).toHaveAttribute("aria-setsize", "1");
    expect(screen.getByRole("listitem")).toHaveAttribute("aria-posinset", "1");
  });

  it("uses one global list position across nonvirtual turn groups", () => {
    const rows = rowsFor(
      groupFor("first", [itemFor("first-1"), itemFor("first-2")], { turnIndex: 1 }),
      groupFor("second", [itemFor("second-1")], { turnIndex: 2 }),
    );
    renderLedger(rows);

    expect(document.querySelectorAll('[role="list"]')).toHaveLength(1);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(
      screen.getAllByRole("listitem").map((item) => ({
        positionInSet: item.getAttribute("aria-posinset"),
        setSize: item.getAttribute("aria-setsize"),
      })),
    ).toEqual([
      { positionInSet: "1", setSize: "3" },
      { positionInSet: "2", setSize: "3" },
      { positionInSet: "3", setSize: "3" },
    ]);
  });

  it("keeps global list positions across virtualized turn groups", () => {
    const rows = rowsFor(
      groupFor("first", [itemFor("first-1")], { turnIndex: 1 }),
      groupFor(
        "second",
        Array.from({ length: trajectoryLedgerVirtualizationThreshold - 1 }, (_, index) =>
          itemFor(`second-${index + 1}`),
        ),
        { turnIndex: 2 },
      ),
    );
    renderLedger(rows);

    const mountedItems = screen.getAllByRole("listitem");
    expect(document.querySelectorAll('[role="list"]')).toHaveLength(1);
    expect(document.querySelector("[data-trajectory-ledger-virtual]")).toBeInTheDocument();
    expect(mountedItems.map((item) => item.dataset.index)).toContain("1");
    expect(mountedItems.map((item) => item.dataset.index)).toContain("3");
    for (const item of mountedItems) {
      const row = rows[Number(item.dataset.index)];
      expect(row?.type).toBe("item");
      if (row?.type === "item") {
        expect(item).toHaveAttribute("aria-setsize", "160");
        expect(item).toHaveAttribute("aria-posinset", String(row.positionInSet));
      }
    }
  });

  it("uses stable ordinal keys when opaque source identifiers repeat", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const opaqueId = `opaque-${"x".repeat(64 * 1024)}`;
    const rows = rowsFor(
      groupFor("opaque-id", [itemFor(opaqueId), itemFor(opaqueId)], { turnIndex: 1 }),
    );
    renderLedger(rows);

    expect(latestGetItemKey?.(0)).toBe("turn-header:0");
    expect(latestGetItemKey?.(1)).toBe("item:0");
    expect(latestGetItemKey?.(2)).toBe("item:1");
    expect(latestGetItemKey?.(0)).not.toBe(latestGetItemKey?.(1));
    expect(document.querySelectorAll("[data-trajectory-item-token]")).toHaveLength(2);
    expect(screen.getByRole("list", { name: "Event ledger" }).innerHTML).not.toContain(opaqueId);
    expect(consoleError.mock.calls.flat().join(" ")).not.toContain("same key");
  });

  it("bounds opaque fields and source identities before rendering a 160-row ledger", () => {
    const opaqueField = `😀${"x".repeat(65_534)}`;
    const rows = rowsFor(
      groupFor(
        "opaque-fields",
        Array.from({ length: trajectoryLedgerVirtualizationThreshold - 1 }, (_, index) =>
          itemFor(`opaque-${index}-${opaqueField}`, {
            kind: "tool",
            toolName: opaqueField,
            callId: opaqueField,
          }),
        ),
        { turnIndex: 1 },
      ),
    );

    const { onSelectItem } = renderLedger(rows);

    const ledger = screen.getByRole("list", { name: "Event ledger" });
    const tokens = [...document.querySelectorAll("[data-trajectory-item-token]")].map((node) =>
      node.getAttribute("data-trajectory-item-token"),
    );

    expect(ledger.textContent?.length ?? 0).toBeLessThan(130_000);
    expect(ledger.textContent).not.toContain(opaqueField);
    expect(tokens).toEqual(
      Array.from({ length: trajectoryLedgerVirtualizationThreshold - 1 }, (_, index) =>
        String(index),
      ),
    );
    expect(tokens.every((token) => (token?.length ?? 0) < 4)).toBe(true);

    fireEvent.click(document.querySelector('[data-trajectory-item-token="0"]')!);
    expect(onSelectItem).toHaveBeenCalledWith(`opaque-0-${opaqueField}`);
  });

  it("uses a generic turn label when a turn has no source index", () => {
    const rows = rowsFor(groupFor("without-index", [itemFor("item-no-index")], { hasTurn: true }));
    renderLedger(rows);

    expect(screen.getByRole("heading", { name: "Turn" })).toBeInTheDocument();
    expect(screen.queryByText("Turn ?")).not.toBeInTheDocument();
    expect(screen.queryByText("Turns")).not.toBeInTheDocument();
  });

  it("shows turn status, duration, and event count in the header", () => {
    const rows = rowsFor(
      groupFor("facts", [itemFor("first"), itemFor("second")], {
        turnIndex: 3,
        turnStatus: "failed",
        turnDurationMs: 65_000,
      }),
    );
    renderLedger(rows);

    expect(screen.getByRole("heading", { name: "Turn 3" })).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(
      screen.getByText(`${formatTrajectoryDuration(65_000, "en")} · 2 events`),
    ).toBeInTheDocument();
  });

  it("omits the turn duration fact when it is unknown", () => {
    const rows = rowsFor(groupFor("no-duration", [itemFor("only")], { turnIndex: 1 }));
    renderLedger(rows);

    expect(screen.getByText("1 events")).toBeInTheDocument();
  });

  it("renders assigned and unassigned groups plus textual states", () => {
    const rows = rowsFor(
      groupFor(
        "assigned",
        [
          itemFor("completed"),
          itemFor("running", { kind: "tool", status: "running" }),
          itemFor("failed", { kind: "tool", status: "failed" }),
          itemFor("aborted", { kind: "subagent", status: "aborted" }),
        ],
        { turnIndex: 2 },
      ),
      groupFor("unassigned", [itemFor("unassigned-item")]),
    );
    renderLedger(rows);

    expect(screen.getByRole("heading", { name: "Turn 2" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Unassigned" })).toBeInTheDocument();
    expect(screen.getAllByText("Completed")).not.toHaveLength(0);
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Aborted")).toBeInTheDocument();
    expect(screen.getByText("Running")).toHaveClass("text-warning");
    expect(screen.getByText("Failed")).toHaveClass("text-error");
    expect(screen.getByText("Aborted")).toHaveClass("text-error");
  });

  it("renders the empty state inside the ledger list", () => {
    renderLedger([]);

    expect(screen.getByRole("list", { name: "Event ledger" })).toHaveTextContent(
      "No trajectory items",
    );
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("maps every trajectory warning kind to its localized message key", () => {
    const base = {
      recordId: "record-warning",
      lineNumber: 1,
      selection: selectionFor("warning"),
    };
    const warnings: readonly AgentTrajectoryWarning[] = [
      { ...base, kind: "missing-timestamp", subject: "tool", endpoint: "call" },
      { ...base, kind: "missing-turn-start", turnId: "turn-1" },
      { ...base, kind: "reversed-timestamp", subject: "tool" },
      { ...base, kind: "unpaired-tool-call" },
      { ...base, kind: "unpaired-tool-result" },
      { ...base, kind: "unpaired-tool-completion" },
      { ...base, kind: "duplicate-tool-call-id", callId: "call-1" },
      { ...base, kind: "duplicate-tool-result-id", callId: "call-1" },
      { ...base, kind: "duplicate-tool-completion-id", callId: "call-1" },
      { ...base, kind: "open-turn", turnId: "turn-1" },
      { ...base, kind: "unattached-token-usage" },
    ];

    expect(warnings.map(trajectoryWarningMessageKey)).toEqual([
      "trajectory.warning.missingTimestamp",
      "trajectory.warning.missingTurnStart",
      "trajectory.warning.reversedTimestamp",
      "trajectory.warning.unpairedCall",
      "trajectory.warning.unpairedResult",
      "trajectory.warning.unpairedCompletion",
      "trajectory.warning.duplicateCall",
      "trajectory.warning.duplicateResult",
      "trajectory.warning.duplicateCompletion",
      "trajectory.warning.openTurn",
      "trajectory.warning.unattachedTokens",
    ]);
  });

  it("formats only finite nonnegative tool durations", () => {
    expect(formatTrajectoryDuration(undefined, "en")).toBe("");
    expect(formatTrajectoryDuration(-1, "en")).toBe("");
    expect(formatTrajectoryDuration(Number.NaN, "en")).toBe("");
    expect(formatTrajectoryDuration(Number.POSITIVE_INFINITY, "en")).toBe("");
    expect(formatTrajectoryDuration(999, "en")).not.toBe("");
    expect(formatTrajectoryDuration(1_500, "en")).not.toBe("");
    expect(formatTrajectoryDuration(60_000, "en")).not.toBe("");
  });

  it("keeps exactly 160 flat rows nonvirtual and virtualizes at 161 rows", () => {
    const rowsAtThreshold = rowsFor(
      groupFor(
        "at-threshold",
        Array.from({ length: trajectoryLedgerVirtualizationThreshold - 1 }, (_, index) =>
          itemFor(`threshold-item-${index}`),
        ),
        { turnIndex: 1 },
      ),
    );

    expect(rowsAtThreshold).toHaveLength(trajectoryLedgerVirtualizationThreshold);
    renderLedger(rowsAtThreshold);
    expect(document.querySelector("[data-trajectory-ledger-virtual]")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(
      trajectoryLedgerVirtualizationThreshold - 1,
    );

    cleanup();

    const rowsAboveThreshold = rowsFor(
      groupFor(
        "above-threshold",
        Array.from({ length: trajectoryLedgerVirtualizationThreshold }, (_, index) =>
          itemFor(`above-threshold-item-${index}`),
        ),
        { turnIndex: 1 },
      ),
    );

    expect(rowsAboveThreshold).toHaveLength(trajectoryLedgerVirtualizationThreshold + 1);
    renderLedger(rowsAboveThreshold);
    expect(document.querySelector("[data-trajectory-ledger-virtual]")).toBeInTheDocument();
    const mountedItems = screen.getAllByRole("listitem");
    expect(mountedItems.length).toBeGreaterThan(0);
    expect(mountedItems.length).toBeLessThan(trajectoryLedgerVirtualizationThreshold);
  });

  it("uses a bounded virtual window above the row threshold and retains full group semantics", () => {
    const itemCount = trajectoryLedgerVirtualizationThreshold + 1;
    const rows = rowsFor(
      groupFor(
        "virtual-group",
        Array.from({ length: itemCount }, (_, index) => itemFor(`item-${index}`)),
        { turnIndex: 1 },
      ),
    );
    renderLedger(rows);

    const mountedItems = screen.getAllByRole("listitem");
    expect(document.querySelector("[data-trajectory-ledger-virtual]")).toBeInTheDocument();
    expect(mountedItems.length).toBeGreaterThan(0);
    expect(mountedItems.length).toBeLessThan(itemCount);
    for (const item of mountedItems) {
      const index = Number(item.dataset.index);
      expect(item).toHaveAttribute("aria-setsize", String(itemCount));
      expect(item).toHaveAttribute("aria-posinset", String(index));
    }
  });

  it("keeps a 5005-item, 556-header ledger bounded and scrolls a selected virtual item", () => {
    const rows = largeRowsFor();
    const selectedItemId = "item-555-9";
    const { rerenderLedger } = renderLedger(rows, selectedItemId);
    const virtualContainer = document.querySelector<HTMLElement>(
      "[data-trajectory-ledger-virtual]",
    );
    const mountedItems = screen.getAllByRole("listitem");

    expect(rows).toHaveLength(5_561);
    expect(virtualContainer).toHaveStyle({
      height: `${rows.length * trajectoryLedgerRowEstimateSize}px`,
    });
    expect(mountedItems.length).toBeGreaterThan(0);
    expect(mountedItems.length).toBeLessThan(100);
    expect(latestGetItemKey?.(0)).toBe("turn-header:0");
    expect(latestGetItemKey?.(1)).toBe("item:0");
    expect(latestGetItemKey?.(rows.length - 1)).toBe("item:5004");
    expect(latestEstimateSize?.(0)).toBe(trajectoryLedgerRowEstimateSize);
    expect(scrollToIndex).toHaveBeenLastCalledWith(rows.length - 1, { align: "center" });

    for (const mountedItem of mountedItems) {
      const row = rows[Number(mountedItem.dataset.index)];
      expect(row?.type).toBe("item");
      if (row?.type === "item") {
        expect(mountedItem).toHaveAttribute("aria-setsize", "5005");
        expect(mountedItem).toHaveAttribute("aria-setsize", String(row.setSize));
        expect(mountedItem).toHaveAttribute("aria-posinset", String(row.positionInSet));
      }
    }

    scrollToIndex.mockClear();
    const rebuiltRows = rows.map((row) => ({ ...row }));
    rerenderLedger(rebuiltRows, selectedItemId);
    expect(scrollToIndex).not.toHaveBeenCalled();

    rerenderLedger(rebuiltRows, "item-0-0");
    expect(scrollToIndex).toHaveBeenLastCalledWith(1, { align: "center" });
  });

  it("does not repeat centering when a rebuilt nonvirtual list keeps the same selection", () => {
    const rows = rowsFor(
      groupFor("stable", [itemFor("item-first"), itemFor("item-second")], { turnIndex: 1 }),
    );
    const { rerenderLedger } = renderLedger(rows, "item-second");

    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    vi.mocked(HTMLElement.prototype.scrollIntoView).mockClear();
    const rebuiltRows = rows.map((row) => ({ ...row }));
    rerenderLedger(rebuiltRows, "item-second");

    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
    rerenderLedger(rebuiltRows, "item-first");
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenLastCalledWith({
      block: "center",
      behavior: "smooth",
    });
  });

  it("recenters a selected item after filtering hides and restores it", () => {
    const rows = rowsFor(
      groupFor("filter", [itemFor("item-visible"), itemFor("item-hidden")], { turnIndex: 1 }),
    );
    const { rerenderLedger } = renderLedger(rows, "item-hidden");
    const filteredRows = rows.filter(
      (row) => row.type === "turn-header" || row.item.item.id !== "item-hidden",
    );

    vi.mocked(HTMLElement.prototype.scrollIntoView).mockClear();
    rerenderLedger(filteredRows, "item-hidden");
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();

    rerenderLedger(
      rows.map((row) => ({ ...row })),
      "item-hidden",
    );
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenLastCalledWith({
      block: "center",
      behavior: "smooth",
    });
  });
});
