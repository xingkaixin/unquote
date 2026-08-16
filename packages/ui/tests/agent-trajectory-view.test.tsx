import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentTrajectoryView } from "../src/components/agent-trajectory-view";
import { trajectoryLedgerVirtualizationThreshold } from "../src/components/agent-trajectory-ledger";
import { I18nProvider } from "../src/i18n/context";
import type { AgentCanonicalSelection } from "../src/lib/agent-session/types";
import type {
  AgentSessionDetail,
  AgentSessionModel,
  AgentTimelineEvent,
  AgentTrajectoryItem,
  AgentTrajectoryModel,
  AgentTrajectoryTurn,
  AgentTrajectoryWarning,
} from "../src/lib/agent-session";

interface ItemOptions {
  readonly kind?: AgentTrajectoryItem["kind"];
  readonly status?: AgentTrajectoryItem["status"];
  readonly recordId?: string;
  readonly eventId?: string;
  readonly lineNumber?: number;
  readonly timestamp?: number;
  readonly startedAt?: number;
  readonly endedAt?: number;
  readonly toolName?: string;
  readonly callId?: string;
  readonly callSelection?: AgentCanonicalSelection;
  readonly resultSelection?: AgentCanonicalSelection;
  readonly completionSelection?: AgentCanonicalSelection;
}

const eventSelection = (id: string, recordId = `record-${id}`): AgentCanonicalSelection => ({
  kind: "event",
  id,
  recordId,
});

const itemFor = (id: string, options: ItemOptions = {}): AgentTrajectoryItem => {
  const recordId = options.recordId ?? `record-${id}`;
  const eventId = options.eventId ?? `event-${id}`;
  const kind = options.kind ?? "assistant";
  const status = options.status ?? "completed";

  return {
    id,
    kind,
    status,
    recordId,
    lineNumber: options.lineNumber ?? 1,
    selection: eventSelection(eventId, recordId),
    ...(options.timestamp === undefined ? {} : { timestamp: options.timestamp }),
    ...(options.startedAt === undefined ? {} : { startedAt: options.startedAt }),
    ...(options.endedAt === undefined ? {} : { endedAt: options.endedAt }),
    ...(options.toolName === undefined ? {} : { toolName: options.toolName }),
    ...(options.callId === undefined ? {} : { callId: options.callId }),
    ...(options.callSelection === undefined ? {} : { callSelection: options.callSelection }),
    ...(options.resultSelection === undefined ? {} : { resultSelection: options.resultSelection }),
    ...(options.completionSelection === undefined
      ? {}
      : { completionSelection: options.completionSelection }),
  } as AgentTrajectoryItem;
};

const eventFor = (item: AgentTrajectoryItem, preview = item.id): AgentTimelineEvent => ({
  id: item.selection.kind === "record" ? `event-${item.id}` : item.selection.id,
  recordId: item.recordId,
  lineNumber: item.lineNumber,
  category: item.kind === "tool" ? "tool" : "assistant",
  kind: "event",
  label: `${item.id} label`,
  preview,
  conversationItems: [],
  ...(item.timestamp === undefined ? {} : { timestamp: item.timestamp }),
});

const turnFor = (
  id: string,
  items: readonly AgentTrajectoryItem[],
  options: {
    readonly durationMs?: number;
    readonly startedAt?: number;
    readonly endedAt?: number;
    readonly turnIndex?: number;
  } = {},
): AgentTrajectoryTurn => ({
  id,
  status: "completed",
  items,
  ...(options.durationMs === undefined ? {} : { durationMs: options.durationMs }),
  ...(options.startedAt === undefined ? {} : { startedAt: options.startedAt }),
  ...(options.endedAt === undefined ? {} : { endedAt: options.endedAt }),
  ...(options.turnIndex === undefined ? {} : { turnIndex: options.turnIndex }),
});

const modelFor = (
  items: readonly AgentTrajectoryItem[],
  options: {
    readonly events?: readonly AgentTimelineEvent[];
    readonly turns?: readonly AgentTrajectoryTurn[];
    readonly warnings?: readonly AgentTrajectoryWarning[];
    readonly tokenUsage?: AgentTrajectoryModel["stats"]["tokenUsage"];
  } = {},
): AgentSessionModel => {
  const events = options.events ?? items.map((item) => eventFor(item));
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const eventsByRecordId = new Map(events.map((event) => [event.recordId, event]));
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const turns = options.turns ?? [turnFor("turn-1", items, { turnIndex: 1 })];
  const trajectory: AgentTrajectoryModel = {
    items,
    turns,
    warnings: options.warnings ?? [],
    stats: {
      turnCount: turns.length,
      itemCount: items.length,
      toolCount: items.filter((item) => item.kind === "tool").length,
      failedToolCount: items.filter((item) => item.kind === "tool" && item.status === "failed")
        .length,
      tokenUsage: options.tokenUsage ?? {},
    },
  };
  const detailFor = (selection: AgentCanonicalSelection): AgentSessionDetail | null => {
    const event =
      selection.kind === "record"
        ? eventsByRecordId.get(selection.recordId)
        : eventsById.get(selection.id);
    return event ? { event, recordId: event.recordId } : null;
  };

  return {
    events,
    conversation: [],
    integrityIssues: [],
    trajectory,
    resolveDetail: (selection) => {
      if (!selection) {
        const event = events[0];
        return event ? { event, recordId: event.recordId } : null;
      }
      if (selection.kind === "trajectory") {
        const item = itemsById.get(selection.id);
        return item ? detailFor(item.selection) : null;
      }
      return detailFor(selection);
    },
    selectEvent: (id) => {
      const event = eventsById.get(id);
      return event ? eventSelection(event.id, event.recordId) : null;
    },
    selectConversation: () => null,
    selectTrajectory: (id) => {
      const item = itemsById.get(id);
      return item ? { kind: "trajectory", id: item.id, recordId: item.recordId } : null;
    },
    resolveToolStatus: () => "pending",
    resolveToolName: () => undefined,
  };
};

const deepFreeze = <T,>(value: T): T => {
  if (typeof value !== "object" || value === null) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return value;
};

const itemButton = (token: number) => {
  const item = document.querySelector(`[data-trajectory-item-token="${token}"]`);
  if (!item) {
    throw new Error(`Missing trajectory item token ${token}`);
  }
  const button = item instanceof HTMLButtonElement ? item : item.querySelector("button");
  if (!button) {
    throw new Error(`Missing trajectory button token ${token}`);
  }
  return button;
};

const renderView = (overrides: Partial<ComponentProps<typeof AgentTrajectoryView>> = {}) => {
  const callbacks = {
    onDetailSelectionChange: vi.fn(),
    onOpenRecord: vi.fn(),
  };
  const props: ComponentProps<typeof AgentTrajectoryView> = {
    model: modelFor([itemFor("default", { timestamp: 10 })]),
    isDesktop: true,
    detailSelection: null,
    onDetailSelectionChange: callbacks.onDetailSelectionChange,
    onOpenRecord: callbacks.onOpenRecord,
    ...overrides,
  };
  const renderTree = (nextProps: ComponentProps<typeof AgentTrajectoryView>) => (
    <I18nProvider>
      <AgentTrajectoryView {...nextProps} />
    </I18nProvider>
  );
  const view = render(renderTree(props));

  return {
    ...view,
    callbacks,
    props,
    rerenderView: (nextProps: Partial<ComponentProps<typeof AgentTrajectoryView>>) => {
      const mergedProps = { ...props, ...nextProps };
      view.rerender(renderTree(mergedProps));
      return mergedProps;
    },
  };
};

afterEach(cleanup);

describe("AgentTrajectoryView", () => {
  it("builds its presentation once for a stable model", () => {
    const sourceModel = modelFor([
      itemFor("first", { timestamp: 10 }),
      itemFor("second", { timestamp: 20 }),
    ]);
    const resolveDetail = vi.fn(sourceModel.resolveDetail);
    const model = { ...sourceModel, resolveDetail };
    const { callbacks, rerenderView } = renderView({ model });

    expect(resolveDetail).toHaveBeenCalledTimes(2);

    rerenderView({
      detailSelection: { kind: "trajectory", id: "first", recordId: "record-first" },
      onDetailSelectionChange: callbacks.onDetailSelectionChange,
    });

    expect(resolveDetail).toHaveBeenCalledTimes(2);
  });

  it("shows all six summary facts and marks an unknown duration as missing", () => {
    const items = [
      itemFor("assistant", { timestamp: 10 }),
      itemFor("failed-tool", { kind: "tool", status: "failed", timestamp: 20 }),
    ];
    const model = modelFor(items, {
      turns: [turnFor("turn-1", items, { turnIndex: 1 })],
      tokenUsage: { inputTokens: 13, outputTokens: 8 },
    });

    renderView({ model });

    const summary = document.querySelector("[data-trajectory-summary]");
    expect(summary).toHaveTextContent("Turns");
    expect(summary).toHaveTextContent("Events");
    expect(summary).toHaveTextContent("Tools");
    expect(summary).toHaveTextContent("Failures");
    expect(summary).toHaveTextContent("Duration");
    expect(summary).toHaveTextContent("Tokens");
    expect(summary).toHaveTextContent("Input");
    expect(summary).toHaveTextContent("Output");
    expect(summary).toHaveTextContent("—");
    expect(summary).not.toHaveTextContent("Cache read");
    expect(summary).not.toHaveTextContent("Cache write");
  });

  it("shows cache and reasoning token components when the session reports them", () => {
    const items = [itemFor("assistant", { timestamp: 10 })];
    const model = modelFor(items, {
      turns: [turnFor("turn-1", items, { turnIndex: 1 })],
      tokenUsage: {
        inputTokens: 13,
        outputTokens: 8,
        cacheReadInputTokens: 400,
        cacheCreationInputTokens: 50,
        reasoningOutputTokens: 6,
      },
    });

    renderView({ model });

    const summary = document.querySelector("[data-trajectory-summary]");
    expect(summary).toHaveTextContent("Cache read 400");
    expect(summary).toHaveTextContent("Cache write 50");
    expect(summary).toHaveTextContent("Reasoning 6");
  });

  it("shows the total warning count and opens an unattached warning Record without an item", async () => {
    const user = userEvent.setup();
    const selection: AgentCanonicalSelection = {
      kind: "event",
      id: "warning-terminal",
      recordId: "record-warning-terminal",
    };
    const warning: AgentTrajectoryWarning = {
      kind: "unattached-token-usage",
      recordId: selection.recordId,
      lineNumber: 77,
      selection,
    };
    const { callbacks } = renderView({ model: modelFor([], { turns: [], warnings: [warning] }) });

    const summary = document.querySelector("[data-trajectory-summary]");
    expect(summary).toHaveTextContent("Warnings");
    expect(summary).toHaveTextContent("1");
    expect(screen.getByText("Unattached token usage · 1 · Line 77")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open Record: Line 77" }));

    expect(callbacks.onOpenRecord).toHaveBeenCalledWith(selection, selection.recordId);
  });

  it("keeps the selected trajectory token when opening an unattached warning Record", async () => {
    const user = userEvent.setup();
    const selectedItem = itemFor("item-7", { timestamp: 10 });
    const warningSelection: AgentCanonicalSelection = {
      kind: "event",
      id: "warning-terminal",
      recordId: "record-warning-terminal",
    };
    const warning: AgentTrajectoryWarning = {
      kind: "unattached-token-usage",
      recordId: warningSelection.recordId,
      lineNumber: 77,
      selection: warningSelection,
    };
    const model = modelFor([selectedItem], { warnings: [warning] });
    const selected = model.selectTrajectory(selectedItem.id);
    if (!selected || selected.kind !== "trajectory") {
      throw new Error("Expected trajectory selection");
    }
    const { callbacks } = renderView({ model, detailSelection: selected });

    await user.click(screen.getByRole("button", { name: "Open Record: Line 77" }));

    expect(callbacks.onOpenRecord).toHaveBeenCalledWith(selected, warningSelection.recordId);
  });

  it("falls back to the warning selection when the selected trajectory token is stale", async () => {
    const user = userEvent.setup();
    const warningSelection: AgentCanonicalSelection = {
      kind: "event",
      id: "warning-terminal",
      recordId: "record-warning-terminal",
    };
    const warning: AgentTrajectoryWarning = {
      kind: "unattached-token-usage",
      recordId: warningSelection.recordId,
      lineNumber: 77,
      selection: warningSelection,
    };
    const { callbacks } = renderView({
      model: modelFor([itemFor("item-7", { timestamp: 10 })], { warnings: [warning] }),
      detailSelection: {
        kind: "trajectory",
        id: "missing-item",
        recordId: "record-missing-item",
      },
    });

    await user.click(screen.getByRole("button", { name: "Open Record: Line 77" }));

    expect(callbacks.onOpenRecord).toHaveBeenCalledWith(
      warningSelection,
      warningSelection.recordId,
    );
  });

  it("falls back to the warning selection when the selected item no longer resolves", async () => {
    const user = userEvent.setup();
    const selectedItem = itemFor("item-7", { timestamp: 10 });
    const warningSelection: AgentCanonicalSelection = {
      kind: "event",
      id: "warning-terminal",
      recordId: "record-warning-terminal",
    };
    const warning: AgentTrajectoryWarning = {
      kind: "unattached-token-usage",
      recordId: warningSelection.recordId,
      lineNumber: 77,
      selection: warningSelection,
    };
    const sourceModel = modelFor([selectedItem], { warnings: [warning] });
    const model: AgentSessionModel = {
      ...sourceModel,
      selectTrajectory: () => null,
    };
    const { callbacks } = renderView({
      model,
      detailSelection: {
        kind: "trajectory",
        id: selectedItem.id,
        recordId: selectedItem.recordId,
      },
    });

    await user.click(screen.getByRole("button", { name: "Open Record: Line 77" }));

    expect(callbacks.onOpenRecord).toHaveBeenCalledWith(
      warningSelection,
      warningSelection.recordId,
    );
  });

  it("intersects query, kind, and time filters while retaining untimed items, then clears them", async () => {
    const user = userEvent.setup();
    const items = [
      itemFor("tool-hit", {
        kind: "tool",
        timestamp: 20,
        toolName: "needle-hit",
      }),
      itemFor("tool-outside", {
        kind: "tool",
        timestamp: 40,
        toolName: "needle-outside",
      }),
      itemFor("tool-untimed", { kind: "tool", toolName: "needle-untimed" }),
      itemFor("assistant-hit", { timestamp: 20 }),
    ];
    renderView({ model: modelFor(items) });

    await user.type(screen.getByLabelText("Search trajectory"), "needle");
    await user.selectOptions(screen.getByLabelText("Kind"), "tool");
    fireEvent.change(screen.getByLabelText("Range start"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Range end"), { target: { value: "5" } });

    await waitFor(() => {
      expect(screen.getByText("2 of 4 visible")).toBeInTheDocument();
    });
    expect(itemButton(0)).toBeInTheDocument();
    expect(itemButton(2)).toBeInTheDocument();
    expect(document.querySelector('[data-trajectory-item-token="1"]')).toBeNull();
    expect(document.querySelector('[data-trajectory-item-token="3"]')).toBeNull();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));

    await waitFor(() => {
      expect(screen.getByText("4 of 4 visible")).toBeInTheDocument();
    });
    expect(itemButton(1)).toBeInTheDocument();
    expect(itemButton(3)).toBeInTheDocument();
  });

  it("lists, filters, and selects system activity", async () => {
    const user = userEvent.setup();
    const system = itemFor("system-activity", { kind: "system", timestamp: 10 });
    const assistant = itemFor("assistant-activity", { kind: "assistant", timestamp: 20 });
    const { callbacks } = renderView({ model: modelFor([system, assistant]) });

    expect(screen.getByRole("option", { name: "System" })).toHaveValue("system");

    await user.selectOptions(screen.getByLabelText("Kind"), "system");

    expect(screen.getByText("1 of 2 visible")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "System: system-activity" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Assistant: assistant-activity" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "System: system-activity" }));

    expect(callbacks.onDetailSelectionChange).toHaveBeenCalledWith({
      kind: "trajectory",
      id: system.id,
      recordId: system.recordId,
    });
  });

  it("enables clear when only a time range is active", async () => {
    const user = userEvent.setup();
    renderView({
      model: modelFor([itemFor("early", { timestamp: 10 }), itemFor("late", { timestamp: 20 })]),
    });

    fireEvent.change(screen.getByLabelText("Range start"), { target: { value: "10" } });

    const clearButton = screen.getByRole("button", { name: "Clear filters" });
    expect(clearButton).toBeEnabled();

    await user.click(clearButton);

    expect(screen.getByLabelText("Range start")).toHaveValue("0");
  });

  it("ignores a kind value outside the closed filter set", async () => {
    const user = userEvent.setup();
    renderView({
      model: modelFor([
        itemFor("tool", { kind: "tool", timestamp: 10 }),
        itemFor("assistant", { timestamp: 20 }),
      ]),
    });

    const kindSelect = screen.getByLabelText("Kind");
    await user.selectOptions(kindSelect, "tool");
    const invalidOption = document.createElement("option");
    invalidOption.value = "unexpected";
    kindSelect.append(invalidOption);
    fireEvent.change(kindSelect, { target: { value: "unexpected" } });

    await waitFor(() => {
      expect(kindSelect).toHaveValue("tool");
    });
    expect(itemButton(0)).toBeInTheDocument();
    expect(document.querySelector('[data-trajectory-item-token="1"]')).toBeNull();
  });

  it("retains a hidden trajectory token and restores the selected row after clearing filters", async () => {
    const user = userEvent.setup();
    const selectedItem = itemFor("selected", { timestamp: 10 });
    const otherItem = itemFor("other", { timestamp: 20 });
    const model = modelFor([selectedItem, otherItem]);
    const selected = model.selectTrajectory(selectedItem.id);
    if (!selected || selected.kind !== "trajectory") {
      throw new Error("Expected trajectory selection");
    }
    const { callbacks } = renderView({ model, detailSelection: selected });

    await user.type(screen.getByLabelText("Search trajectory"), "other");

    await waitFor(() => {
      expect(document.querySelector('[data-trajectory-item-token="0"]')).toBeNull();
    });
    expect(callbacks.onDetailSelectionChange).not.toHaveBeenCalled();
    expect(screen.getByText("selected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));

    await waitFor(() => {
      expect(itemButton(0)).toHaveAttribute("aria-current", "true");
    });
  });

  it("uses each exact trajectory token when one event produces multiple evidence items", () => {
    const first = itemFor("evidence-1", {
      eventId: "event-shared",
      recordId: "record-shared",
      timestamp: 10,
    });
    const second = itemFor("evidence-2", {
      eventId: "event-shared",
      recordId: "record-shared",
      timestamp: 20,
    });
    const { callbacks } = renderView({ model: modelFor([first, second]) });

    const firstButton = itemButton(0);
    const secondButton = itemButton(1);
    expect(firstButton).toHaveAttribute("data-trajectory-item-token", "0");
    expect(secondButton).toHaveAttribute("data-trajectory-item-token", "1");

    fireEvent.click(firstButton);
    fireEvent.click(secondButton);

    expect(callbacks.onDetailSelectionChange).toHaveBeenNthCalledWith(1, {
      kind: "trajectory",
      id: first.id,
      recordId: "record-shared",
    });
    expect(callbacks.onDetailSelectionChange).toHaveBeenNthCalledWith(2, {
      kind: "trajectory",
      id: second.id,
      recordId: "record-shared",
    });
  });

  it("keeps ordinal tokens stable across filters when source item identities repeat", async () => {
    const user = userEvent.setup();
    const opaqueId = `opaque-${"x".repeat(64 * 1024)}`;
    const first = itemFor(opaqueId, {
      kind: "tool",
      recordId: "record-opaque",
      timestamp: 10,
    });
    const second = itemFor(opaqueId, {
      kind: "assistant",
      recordId: "record-opaque",
      timestamp: 20,
    });
    const { callbacks } = renderView({ model: modelFor([first, second]) });

    expect(itemButton(0)).toHaveAttribute("data-trajectory-item-token", "0");
    expect(itemButton(1)).toHaveAttribute("data-trajectory-item-token", "1");

    fireEvent.click(itemButton(0));
    fireEvent.click(itemButton(1));
    expect(callbacks.onDetailSelectionChange).toHaveBeenNthCalledWith(1, {
      kind: "trajectory",
      id: opaqueId,
      recordId: "record-opaque",
    });
    expect(callbacks.onDetailSelectionChange).toHaveBeenNthCalledWith(2, {
      kind: "trajectory",
      id: opaqueId,
      recordId: "record-opaque",
    });

    await user.selectOptions(screen.getByLabelText("Kind"), "tool");
    expect(itemButton(0)).toBeInTheDocument();
    expect(document.querySelector('[data-trajectory-item-token="1"]')).toBeNull();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(itemButton(0)).toHaveAttribute("data-trajectory-item-token", "0");
    expect(itemButton(1)).toHaveAttribute("data-trajectory-item-token", "1");
    expect(document.querySelector("[data-trajectory-ready]")?.innerHTML).not.toContain(opaqueId);
  });

  it("opens each tool endpoint with the selected trajectory token and endpoint record", async () => {
    const user = userEvent.setup();
    const tool = itemFor("tool-triple", {
      kind: "tool",
      recordId: "record-primary",
      eventId: "event-primary",
      toolName: "shell",
      callSelection: { kind: "conversation", id: "call", recordId: "record-call" },
      resultSelection: { kind: "conversation", id: "result", recordId: "record-result" },
      completionSelection: { kind: "event", id: "completion", recordId: "record-completion" },
    });
    const model = modelFor([tool]);
    const selected = model.selectTrajectory(tool.id);
    if (!selected || selected.kind !== "trajectory") {
      throw new Error("Expected trajectory selection");
    }
    const staleSelection = { ...selected, recordId: "record-stale" };
    const { callbacks } = renderView({ model, detailSelection: staleSelection });

    await user.click(screen.getByRole("button", { name: "Open call Record" }));
    await user.click(screen.getByRole("button", { name: "Open result Record" }));
    await user.click(screen.getByRole("button", { name: "Open completion Record" }));

    expect(callbacks.onOpenRecord).toHaveBeenNthCalledWith(1, selected, "record-call");
    expect(callbacks.onOpenRecord).toHaveBeenNthCalledWith(2, selected, "record-result");
    expect(callbacks.onOpenRecord).toHaveBeenNthCalledWith(3, selected, "record-completion");
    expect(callbacks.onDetailSelectionChange).not.toHaveBeenCalled();
  });

  it("clears local filters when the model changes", async () => {
    const user = userEvent.setup();
    const firstModel = modelFor([
      itemFor("first-tool", { kind: "tool", timestamp: 20, toolName: "needle" }),
    ]);
    const secondModel = modelFor([itemFor("second-assistant", { timestamp: 1 })]);
    const { rerenderView } = renderView({ model: firstModel });

    await user.type(screen.getByLabelText("Search trajectory"), "needle");
    await user.selectOptions(screen.getByLabelText("Kind"), "tool");
    fireEvent.change(screen.getByLabelText("Range start"), { target: { value: "20" } });

    rerenderView({ model: secondModel });

    await waitFor(() => {
      expect(screen.getByLabelText("Search trajectory")).toHaveValue("");
      expect(screen.getByLabelText("Kind")).toHaveValue("all");
      expect(itemButton(0)).toBeInTheDocument();
    });
  });

  it("keeps the detail pane behind the shared mobile disclosure", () => {
    renderView({ isDesktop: false });

    expect(document.querySelector("details")).toHaveTextContent("Detail");
    expect(screen.getByText("Search trajectory")).toBeInTheDocument();
  });

  it("keeps mobile summary, overview, and ledger independently reachable", () => {
    renderView({ isDesktop: false });

    const summary = document.querySelector("[data-trajectory-summary]");
    const overview = document.querySelector("[data-trajectory-overview]");
    const center = summary?.parentElement;
    const ledger = screen.getByRole("list", { name: "Event ledger" }).parentElement;

    expect(center).toHaveClass("overflow-y-auto");
    expect(summary).toHaveClass("shrink-0");
    expect(overview).toHaveClass("shrink-0");
    expect(ledger).toHaveClass("h-72", "shrink-0");
  });

  it("keeps the desktop ledger as the flexible center pane", () => {
    renderView({ isDesktop: true });

    const summary = document.querySelector("[data-trajectory-summary]");
    const overview = document.querySelector("[data-trajectory-overview]");
    const center = summary?.parentElement;
    const ledger = screen.getByRole("list", { name: "Event ledger" }).parentElement;

    expect(center).toHaveClass("overflow-hidden");
    expect(summary).not.toHaveClass("shrink-0");
    expect(overview).not.toHaveClass("shrink-0");
    expect(ledger).toHaveClass("min-h-0", "flex-1");
  });

  it("keeps the ledger DOM bounded for 5,005 items across 556 turns", () => {
    const itemCount = 5_005;
    const turnCount = 556;
    const items = Array.from({ length: itemCount }, (_, index) =>
      itemFor(`large-${index}`, { timestamp: index }),
    );
    const turnItems = Array.from({ length: turnCount }, () => [] as AgentTrajectoryItem[]);
    for (const [index, item] of items.entries()) {
      turnItems[index % turnCount]!.push(item);
    }
    const turns = turnItems.map((itemsForTurn, index) =>
      turnFor(`turn-${index}`, itemsForTurn, {
        startedAt: index * 10,
        endedAt: index * 10 + 1,
        turnIndex: index + 1,
      }),
    );

    renderView({ model: modelFor(items, { turns }), isDesktop: false });

    expect(document.querySelector("[data-trajectory-ledger-virtual]")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-trajectory-item-token]").length).toBeLessThan(
      trajectoryLedgerVirtualizationThreshold,
    );
  });

  it("reads only the immutable model projection and never a raw source payload", () => {
    const model = modelFor([itemFor("immutable", { timestamp: 10 })]) as AgentSessionModel & {
      rawJsonl?: string;
    };
    Object.defineProperty(model, "rawJsonl", {
      get() {
        throw new Error("The view must not read raw JSONL");
      },
    });

    expect(() => renderView({ model: deepFreeze(model) })).not.toThrow();
    expect(document.querySelector("[data-trajectory-ready]")).toBeInTheDocument();
  });
});
