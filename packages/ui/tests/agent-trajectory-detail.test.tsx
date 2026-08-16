import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentTrajectoryDetail } from "../src/components/agent-trajectory-detail";
import { I18nProvider } from "../src/i18n/context";
import { formatClockTime } from "../src/lib/format";
import type {
  AgentCanonicalSelection,
  AgentSessionDetail,
  AgentTrajectoryItem,
  AgentTrajectoryTurn,
  AgentTrajectoryWarning,
} from "../src/lib/agent-session/types";
import type {
  AgentTrajectoryPresentationItem,
  AgentTrajectoryWarningGroup,
} from "../src/lib/agent-session/trajectory-presentation";

afterEach(cleanup);

const recordSelection = (recordId: string): AgentCanonicalSelection => ({
  kind: "record",
  recordId,
});

const detailFor = (label: string): AgentSessionDetail => ({
  recordId: "record-main",
  event: {
    id: "event-main",
    recordId: "record-main",
    lineNumber: 12,
    category: "assistant",
    kind: "message",
    label,
    preview: "",
    conversationItems: [],
  },
});

const presentationItem = (
  item: AgentTrajectoryItem,
  options: {
    ordinal?: number;
    summary?: string;
    detail?: AgentSessionDetail | null;
    warningGroups?: readonly AgentTrajectoryWarningGroup[];
    turn?: AgentTrajectoryTurn | null;
  } = {},
): AgentTrajectoryPresentationItem => ({
  ordinal: options.ordinal ?? 0,
  item,
  detail: options.detail ?? null,
  summary: options.summary ?? "Bounded summary",
  searchText: "bounded summary",
  lane: "model",
  interval: null,
  warningGroups: options.warningGroups ?? [],
  turn: options.turn ?? null,
  groupId: options.turn?.id ?? "unassigned",
});

const renderDetail = (
  item: AgentTrajectoryPresentationItem | null,
  unattachedWarningGroups: readonly AgentTrajectoryWarningGroup[] = [],
) => {
  const onOpenSelection = vi.fn();
  const onOpenUnattachedWarning = vi.fn();
  render(
    <I18nProvider>
      <AgentTrajectoryDetail
        item={item}
        unattachedWarningGroups={unattachedWarningGroups}
        onOpenSelection={onOpenSelection}
        onOpenUnattachedWarning={onOpenUnattachedWarning}
      />
    </I18nProvider>,
  );
  return { onOpenSelection, onOpenUnattachedWarning };
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

const warningGroupsFor = (warnings: readonly AgentTrajectoryWarning[]) =>
  warnings.map((warning) => ({ warning, count: 1 }));

const isWellFormed = (value: string) =>
  (String.prototype as unknown as { isWellFormed: (this: string) => boolean }).isWellFormed.call(
    value,
  );

describe("AgentTrajectoryDetail", () => {
  it("shows an empty detail state without an item", () => {
    renderDetail(null);

    expect(screen.getByRole("heading", { name: "Detail" })).toBeInTheDocument();
    expect(screen.getByText("Select an item to inspect")).toBeInTheDocument();
  });

  it("uses localized kinds when an item has no canonical summary", () => {
    localStorage.setItem("unquote-locale", "zh-CN");
    const examples: readonly [AgentTrajectoryItem["kind"], string][] = [
      ["system", "系统"],
      ["assistant", "助手"],
      ["compaction", "上下文压缩"],
      ["tool", "工具"],
    ];

    render(
      <I18nProvider>
        {examples.map(([kind]) => {
          const item: AgentTrajectoryItem = {
            id: `empty-${kind}`,
            kind,
            status: "completed",
            recordId: `record-${kind}`,
            lineNumber: 1,
            selection: recordSelection(`record-${kind}`),
          } as AgentTrajectoryItem;
          return (
            <AgentTrajectoryDetail
              key={kind}
              item={presentationItem(item, { summary: "" })}
              unattachedWarningGroups={[]}
              onOpenSelection={vi.fn()}
              onOpenUnattachedWarning={vi.fn()}
            />
          );
        })}
      </I18nProvider>,
    );
    localStorage.removeItem("unquote-locale");

    for (const [, label] of examples) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(document.body.textContent).not.toContain("system");
    expect(document.body.textContent).not.toContain("assistant");
    expect(document.body.textContent).not.toContain("compaction");
    expect(document.body.textContent).not.toContain("tool");
  });

  it("shows unattached warning groups without a selected item and opens their canonical Record", async () => {
    const user = userEvent.setup();
    const selection: AgentCanonicalSelection = {
      kind: "event",
      id: "terminal-event",
      recordId: "record-terminal",
    };
    const warning: AgentTrajectoryWarning = {
      kind: "reversed-timestamp",
      subject: "turn",
      turnId: "turn-1",
      recordId: selection.recordId,
      lineNumber: 88,
      selection,
    };
    const groups = deepFreeze([{ warning, count: 2 } satisfies AgentTrajectoryWarningGroup]);
    const beforeRender = JSON.stringify(groups);
    const { onOpenUnattachedWarning } = renderDetail(null, groups);

    expect(screen.getByText("Select an item to inspect")).toBeInTheDocument();
    expect(screen.getByText("Timestamp is out of order · 2 · Line 88")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open Record: Line 88" }));

    expect(onOpenUnattachedWarning).toHaveBeenCalledWith(selection);
    expect(JSON.stringify(groups)).toBe(beforeRender);
  });

  it("keeps unattached warning groups beside a selected item's warnings", () => {
    const itemSelection = recordSelection("record-item");
    const item: AgentTrajectoryItem = {
      id: "item-with-warning",
      kind: "assistant",
      status: "completed",
      recordId: itemSelection.recordId,
      lineNumber: 30,
      selection: itemSelection,
    };
    const itemWarning: AgentTrajectoryWarning = {
      kind: "unpaired-tool-call",
      recordId: itemSelection.recordId,
      lineNumber: 31,
      selection: itemSelection,
    };
    const warningSelection = recordSelection("record-unattached");
    const unattachedWarning: AgentTrajectoryWarning = {
      kind: "missing-timestamp",
      subject: "tool",
      endpoint: "result",
      recordId: warningSelection.recordId,
      lineNumber: 32,
      selection: warningSelection,
    };

    renderDetail(presentationItem(item, { warningGroups: warningGroupsFor([itemWarning]) }), [
      { warning: unattachedWarning, count: 3 },
    ]);

    expect(screen.getByText("Unpaired tool call · 1 · Line 31")).toBeInTheDocument();
    expect(screen.getByText("Missing timestamp · 3 · Line 32")).toBeInTheDocument();
  });

  it("renders one attached warning row for a 5,005-warning group", () => {
    const count = 5_005;
    const selection = recordSelection("record-grouped-warning");
    const item: AgentTrajectoryItem = {
      id: "grouped-warning-item",
      kind: "assistant",
      status: "completed",
      recordId: selection.recordId,
      lineNumber: 33,
      selection,
    };
    const warning: AgentTrajectoryWarning = {
      kind: "unpaired-tool-call",
      recordId: selection.recordId,
      lineNumber: 34,
      selection,
    };

    renderDetail(presentationItem(item, { warningGroups: [{ warning, count }] }));

    const warningSection = screen.getByRole("heading", { name: "Warnings" }).parentElement!;
    expect(within(warningSection).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("Unpaired tool call · 5005 · Line 34")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Record: Line 34" })).not.toBeInTheDocument();
  });

  it("synchronizes the detail root marker with the selected trajectory item", () => {
    const firstItem: AgentTrajectoryItem = {
      id: "first-detail-item",
      kind: "assistant",
      status: "completed",
      recordId: "record-first",
      lineNumber: 1,
      selection: recordSelection("record-first"),
    };
    const secondItem: AgentTrajectoryItem = {
      id: "second-detail-item",
      kind: "tool",
      status: "completed",
      recordId: "record-second",
      lineNumber: 2,
      selection: recordSelection("record-second"),
    };
    const onOpenSelection = vi.fn();
    const renderView = (item: AgentTrajectoryPresentationItem | null) => (
      <I18nProvider>
        <AgentTrajectoryDetail
          item={item}
          unattachedWarningGroups={[]}
          onOpenSelection={onOpenSelection}
          onOpenUnattachedWarning={vi.fn()}
        />
      </I18nProvider>
    );
    const view = render(renderView(presentationItem(firstItem, { ordinal: 7 })));
    const detailRoot = () => document.querySelector("[data-trajectory-detail-item-token]");

    expect(detailRoot()).toHaveAttribute("data-trajectory-detail-item-token", "7");

    view.rerender(renderView(presentationItem(secondItem, { ordinal: 8 })));
    expect(detailRoot()).toHaveAttribute("data-trajectory-detail-item-token", "8");

    view.rerender(renderView(null));
    expect(detailRoot()).toHaveAttribute("data-trajectory-detail-item-token", "");
  });

  it("keeps opaque source identity out of detail DOM while preserving its open action", async () => {
    const user = userEvent.setup();
    const opaqueField = `${"x".repeat(238)}🧪${"y".repeat(65_534)}`;
    const selection = recordSelection(`record-${opaqueField}`);
    const item: AgentTrajectoryItem = {
      id: `item-${opaqueField}`,
      kind: "tool",
      status: "completed",
      recordId: selection.recordId,
      lineNumber: 1,
      selection,
      toolName: opaqueField,
      callId: opaqueField,
    };
    const { onOpenSelection } = renderDetail(
      presentationItem(item, {
        ordinal: 42,
        summary: opaqueField,
        detail: detailFor(opaqueField),
      }),
    );
    const detailRoot = document.querySelector<HTMLElement>("[data-trajectory-detail-item-token]");

    expect(detailRoot).toHaveAttribute("data-trajectory-detail-item-token", "42");
    expect(detailRoot?.textContent?.length ?? 0).toBeLessThan(2_000);
    expect(detailRoot?.innerHTML).not.toContain(opaqueField);
    expect(detailRoot?.textContent).not.toContain("🧪");
    expect(isWellFormed(detailRoot?.textContent ?? "")).toBe(true);

    await user.click(screen.getByRole("button", { name: "Open Record" }));

    expect(onOpenSelection).toHaveBeenCalledWith(selection);
    expect(onOpenSelection.mock.calls[0]?.[0]).toBe(selection);
  });

  it("shows a bounded summary, canonical event label, and only present detail facts", () => {
    const timestamp = 1_704_067_200_000;
    const item: AgentTrajectoryItem = {
      id: "assistant-1",
      kind: "assistant",
      status: "completed",
      recordId: "record-main",
      lineNumber: 12,
      selection: recordSelection("record-main"),
      timestamp,
      turnIndex: 4,
      step: { index: 3, source: "derived" },
    };

    renderDetail(
      presentationItem(item, {
        summary: "Bounded assistant summary",
        detail: detailFor("Canonical assistant event"),
      }),
    );

    expect(screen.getByText("Bounded assistant summary")).toBeInTheDocument();
    expect(screen.getByText("Canonical assistant event")).toBeInTheDocument();
    expect(screen.getByText("Assistant")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Line 12")).toBeInTheDocument();
    expect(screen.getByText("Turn 4")).toBeInTheDocument();
    expect(screen.getByText(formatClockTime(timestamp, "en"))).toBeInTheDocument();
    expect(screen.getByText("≈ derived step 3")).toBeInTheDocument();
    expect(
      screen.getByText("Derived from available session data; not a source step."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Call ID")).not.toBeInTheDocument();

    const detail = screen.getByRole("heading", { name: "Detail" }).parentElement!;
    expect(detail).not.toHaveTextContent("Line 1212");
    expect(within(detail).queryByText("12", { selector: "dd" })).not.toBeInTheDocument();
  });

  it("shows every token-usage component for an assistant item", () => {
    const item: AgentTrajectoryItem = {
      id: "assistant-tokens",
      kind: "assistant",
      status: "completed",
      recordId: "record-main",
      lineNumber: 13,
      selection: recordSelection("record-main"),
      tokenUsage: {
        inputTokens: 10,
        outputTokens: 11,
        cacheCreationInputTokens: 12,
        cacheReadInputTokens: 13,
        reasoningOutputTokens: 14,
      },
    };

    renderDetail(presentationItem(item));

    expect(screen.getByText("Input")).toBeInTheDocument();
    expect(screen.getByText("Output")).toBeInTheDocument();
    expect(screen.getByText("Cache write")).toBeInTheDocument();
    expect(screen.getByText("Cache read")).toBeInTheDocument();
    expect(screen.getByText("Reasoning")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("11")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("13")).toBeInTheDocument();
    expect(screen.getByText("14")).toBeInTheDocument();
  });

  it("hides token components that do not exist", () => {
    const item: AgentTrajectoryItem = {
      id: "reasoning-tokens",
      kind: "reasoning",
      status: "completed",
      recordId: "record-main",
      lineNumber: 14,
      selection: recordSelection("record-main"),
      tokenUsage: { outputTokens: 8 },
    };

    renderDetail(presentationItem(item));

    expect(screen.getByText("Output")).toBeInTheDocument();
    expect(screen.queryByText("Input")).not.toBeInTheDocument();
    expect(screen.queryByText("Cache write")).not.toBeInTheDocument();
    expect(screen.queryByText("Cache read")).not.toBeInTheDocument();
    expect(screen.queryByText("Reasoning", { selector: "dt" })).not.toBeInTheDocument();
    expect(screen.queryByText("undefined")).not.toBeInTheDocument();
  });

  it("shows the tool's start and end moments when they are known", () => {
    const startedAt = 1_704_067_200_000;
    const endedAt = startedAt + 90_000;
    const item: AgentTrajectoryItem = {
      id: "tool-timed",
      kind: "tool",
      status: "completed",
      recordId: "record-primary",
      lineNumber: 20,
      selection: recordSelection("record-primary"),
      timestamp: startedAt,
      toolName: "shell",
      startedAt,
      endedAt,
      durationMs: 90_000,
    };
    renderDetail(presentationItem(item));

    expect(screen.getByText("Started")).toBeInTheDocument();
    expect(screen.getByText("Ended")).toBeInTheDocument();
    expect(screen.getByText(formatClockTime(endedAt, "en"))).toBeInTheDocument();
  });

  it("omits start and end facts for a tool without endpoint timestamps", () => {
    const item: AgentTrajectoryItem = {
      id: "tool-untimed",
      kind: "tool",
      status: "running",
      recordId: "record-primary",
      lineNumber: 21,
      selection: recordSelection("record-primary"),
      toolName: "shell",
    };
    renderDetail(presentationItem(item));

    expect(screen.queryByText("Started")).not.toBeInTheDocument();
    expect(screen.queryByText("Ended")).not.toBeInTheDocument();
  });

  it("opens every tool endpoint with its exact canonical selection", async () => {
    const user = userEvent.setup();
    const callSelection: AgentCanonicalSelection = {
      kind: "conversation",
      id: "conversation-call",
      recordId: "record-shared",
    };
    const resultSelection: AgentCanonicalSelection = {
      kind: "conversation",
      id: "conversation-result",
      recordId: "record-shared",
    };
    const completionSelection: AgentCanonicalSelection = {
      kind: "event",
      id: "event-completion",
      recordId: "record-completion",
    };
    const timestamp = 1_704_067_200_000;
    const item: AgentTrajectoryItem = {
      id: "tool-endpoints",
      kind: "tool",
      status: "failed",
      recordId: "record-primary",
      lineNumber: 15,
      selection: recordSelection("record-primary"),
      timestamp,
      toolName: "shell",
      callId: "call-42",
      callSelection,
      resultSelection,
      completionSelection,
      durationMs: 1_500,
    };
    const { onOpenSelection } = renderDetail(presentationItem(item));

    expect(screen.getByText("shell")).toBeInTheDocument();
    expect(screen.getByText("Call ID")).toBeInTheDocument();
    expect(screen.getByText("call-42")).toBeInTheDocument();
    expect(screen.getByText(formatClockTime(timestamp, "en"))).toBeInTheDocument();
    expect(screen.getByText("1.5s")).toBeInTheDocument();

    await user.tab();
    expect(screen.getByRole("button", { name: "Open call Record" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Open result Record" }));
    await user.click(screen.getByRole("button", { name: "Open completion Record" }));

    expect(onOpenSelection).toHaveBeenNthCalledWith(1, callSelection);
    expect(onOpenSelection).toHaveBeenNthCalledWith(2, resultSelection);
    expect(onOpenSelection).toHaveBeenNthCalledWith(3, completionSelection);
  });

  it("keeps distinct endpoint controls when two endpoints share one canonical selection", async () => {
    const user = userEvent.setup();
    const sharedSelection: AgentCanonicalSelection = {
      kind: "conversation",
      id: "conversation-shared",
      recordId: "record-shared",
    };
    const item: AgentTrajectoryItem = {
      id: "tool-shared-endpoint",
      kind: "tool",
      status: "completed",
      recordId: "record-primary",
      lineNumber: 15,
      selection: recordSelection("record-primary"),
      callSelection: sharedSelection,
      resultSelection: sharedSelection,
    };
    const { onOpenSelection } = renderDetail(presentationItem(item));

    await user.click(screen.getByRole("button", { name: "Open call Record" }));
    await user.click(screen.getByRole("button", { name: "Open result Record" }));

    expect(onOpenSelection).toHaveBeenNthCalledWith(1, sharedSelection);
    expect(onOpenSelection).toHaveBeenNthCalledWith(2, sharedSelection);
  });

  it("falls back to the primary selection when a tool has no endpoint selection", async () => {
    const user = userEvent.setup();
    const primarySelection = recordSelection("record-primary");
    const item: AgentTrajectoryItem = {
      id: "tool-primary",
      kind: "tool",
      status: "running",
      recordId: "record-primary",
      lineNumber: 16,
      selection: primarySelection,
    };
    const { onOpenSelection } = renderDetail(presentationItem(item));

    expect(screen.getByRole("button", { name: "Open Record" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open call Record" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open Record" }));
    expect(onOpenSelection).toHaveBeenCalledWith(primarySelection);
  });

  it("keeps a warning jump when canonical identities contain delimiter characters", async () => {
    const user = userEvent.setup();
    const callSelection: AgentCanonicalSelection = {
      kind: "event",
      recordId: "record\u0000fragment",
      id: "tail",
    };
    const warningSelection: AgentCanonicalSelection = {
      kind: "event",
      recordId: "record",
      id: "fragment\u0000tail",
    };
    const warning: AgentTrajectoryWarning = {
      kind: "unpaired-tool-call",
      recordId: warningSelection.recordId,
      lineNumber: 99,
      selection: warningSelection,
    };
    const item: AgentTrajectoryItem = {
      id: "tool-collision",
      kind: "tool",
      status: "running",
      recordId: "record-primary",
      lineNumber: 17,
      selection: recordSelection("record-primary"),
      callSelection,
    };
    const { onOpenSelection } = renderDetail(
      presentationItem(item, { warningGroups: warningGroupsFor([warning]) }),
    );

    await user.click(screen.getByRole("button", { name: "Open Record: Line 99" }));
    expect(onOpenSelection).toHaveBeenCalledWith(warningSelection);
  });

  it("shows a call id with its original leading and trailing whitespace", () => {
    const callId = "  call id  ";
    const item: AgentTrajectoryItem = {
      id: "tool-spaced-call-id",
      kind: "tool",
      status: "completed",
      recordId: "record-primary",
      lineNumber: 18,
      selection: recordSelection("record-primary"),
      callId,
    };

    renderDetail(presentationItem(item));

    expect(screen.getByText((_, element) => element?.textContent === callId)).toBeInTheDocument();
  });

  it("renders every typed warning mapping with its line number", () => {
    const selection = recordSelection("warning-record");
    const warningCases: readonly { warning: AgentTrajectoryWarning; label: string }[] = [
      {
        warning: {
          kind: "missing-timestamp",
          subject: "tool",
          endpoint: "call",
          recordId: "warning-record",
          lineNumber: 101,
          selection,
        },
        label: "Missing timestamp",
      },
      {
        warning: {
          kind: "missing-turn-start",
          turnId: "turn-1",
          recordId: "warning-record",
          lineNumber: 102,
          selection,
        },
        label: "Missing turn start",
      },
      {
        warning: {
          kind: "reversed-timestamp",
          subject: "tool",
          recordId: "warning-record",
          lineNumber: 103,
          selection,
        },
        label: "Timestamp is out of order",
      },
      {
        warning: {
          kind: "unpaired-tool-call",
          recordId: "warning-record",
          lineNumber: 104,
          selection,
        },
        label: "Unpaired tool call",
      },
      {
        warning: {
          kind: "unpaired-tool-result",
          recordId: "warning-record",
          lineNumber: 105,
          selection,
        },
        label: "Unpaired tool result",
      },
      {
        warning: {
          kind: "unpaired-tool-completion",
          recordId: "warning-record",
          lineNumber: 106,
          selection,
        },
        label: "Unpaired tool completion",
      },
      {
        warning: {
          kind: "duplicate-tool-call-id",
          callId: "call-1",
          recordId: "warning-record",
          lineNumber: 107,
          selection,
        },
        label: "Duplicate tool call",
      },
      {
        warning: {
          kind: "duplicate-tool-result-id",
          callId: "call-1",
          recordId: "warning-record",
          lineNumber: 108,
          selection,
        },
        label: "Duplicate tool result",
      },
      {
        warning: {
          kind: "duplicate-tool-completion-id",
          callId: "call-1",
          recordId: "warning-record",
          lineNumber: 109,
          selection,
        },
        label: "Duplicate tool completion",
      },
      {
        warning: {
          kind: "open-turn",
          turnId: "turn-1",
          recordId: "warning-record",
          lineNumber: 110,
          selection,
        },
        label: "Turn still open",
      },
      {
        warning: {
          kind: "unattached-token-usage",
          recordId: "warning-record",
          lineNumber: 111,
          selection,
        },
        label: "Unattached token usage",
      },
    ];
    const item: AgentTrajectoryItem = {
      id: "warning-source",
      kind: "user",
      status: "completed",
      recordId: "record-main",
      lineNumber: 19,
      selection: recordSelection("record-main"),
    };

    renderDetail(
      presentationItem(item, {
        warningGroups: warningGroupsFor(warningCases.map(({ warning }) => warning)),
      }),
    );

    for (const { label, warning } of warningCases) {
      expect(screen.getByText(`${label} · 1 · Line ${warning.lineNumber}`)).toBeInTheDocument();
    }
  });

  it.each([
    {
      item: {
        id: "user-status",
        kind: "user",
        status: "completed",
        recordId: "record-user",
        lineNumber: 20,
        selection: recordSelection("record-user"),
      } satisfies AgentTrajectoryItem,
      kind: "User",
      status: "Completed",
      tone: "text-success",
    },
    {
      item: {
        id: "assistant-status",
        kind: "assistant",
        status: "completed",
        recordId: "record-assistant",
        lineNumber: 21,
        selection: recordSelection("record-assistant"),
      } satisfies AgentTrajectoryItem,
      kind: "Assistant",
      status: "Completed",
      tone: "text-success",
    },
    {
      item: {
        id: "reasoning-status",
        kind: "reasoning",
        status: "completed",
        recordId: "record-reasoning",
        lineNumber: 22,
        selection: recordSelection("record-reasoning"),
      } satisfies AgentTrajectoryItem,
      kind: "Reasoning",
      status: "Completed",
      tone: "text-success",
    },
    {
      item: {
        id: "tool-running-status",
        kind: "tool",
        status: "running",
        recordId: "record-tool-running",
        lineNumber: 23,
        selection: recordSelection("record-tool-running"),
      } satisfies AgentTrajectoryItem,
      kind: "Tool",
      status: "Running",
      tone: "text-warning",
    },
    {
      item: {
        id: "tool-failed-status",
        kind: "tool",
        status: "failed",
        recordId: "record-tool-failed",
        lineNumber: 24,
        selection: recordSelection("record-tool-failed"),
      } satisfies AgentTrajectoryItem,
      kind: "Tool",
      status: "Failed",
      tone: "text-error",
    },
    {
      item: {
        id: "subagent-status",
        kind: "subagent",
        status: "aborted",
        recordId: "record-subagent",
        lineNumber: 25,
        selection: recordSelection("record-subagent"),
      } satisfies AgentTrajectoryItem,
      kind: "Subagent",
      status: "Aborted",
      tone: "text-error",
    },
    {
      item: {
        id: "compaction-status",
        kind: "compaction",
        status: "completed",
        recordId: "record-compaction",
        lineNumber: 26,
        selection: recordSelection("record-compaction"),
      } satisfies AgentTrajectoryItem,
      kind: "Compaction",
      status: "Completed",
      tone: "text-success",
    },
  ])(
    "shows the $kind $status state in text and with its semantic tone",
    ({ item, kind, status, tone }) => {
      renderDetail(presentationItem(item));

      expect(screen.getByText(kind)).toBeInTheDocument();
      expect(screen.getByText(status)).toHaveClass(tone);
    },
  );

  it("opens a non-tool item's full canonical selection without modifying readonly input", async () => {
    const user = userEvent.setup();
    const selection: AgentCanonicalSelection = {
      kind: "conversation",
      id: "conversation-1",
      recordId: "record-main",
    };
    const item: AgentTrajectoryItem = {
      id: "assistant-readonly",
      kind: "assistant",
      status: "completed",
      recordId: "record-main",
      lineNumber: 27,
      selection,
      tokenUsage: { inputTokens: 1 },
    };
    const readonlyPresentation = deepFreeze(presentationItem(item));
    const beforeRender = JSON.stringify(readonlyPresentation);
    const { onOpenSelection } = renderDetail(readonlyPresentation);

    await user.click(screen.getByRole("button", { name: "Open Record" }));

    expect(onOpenSelection).toHaveBeenCalledWith(selection);
    expect(JSON.stringify(readonlyPresentation)).toBe(beforeRender);
  });

  it("renders detail content directly without creating a local disclosure control", () => {
    const item: AgentTrajectoryItem = {
      id: "subagent-detail",
      kind: "subagent",
      status: "running",
      recordId: "record-subagent",
      lineNumber: 28,
      selection: recordSelection("record-subagent"),
    };

    renderDetail(presentationItem(item));

    expect(screen.getByText("Bounded summary")).toBeVisible();
    expect(screen.queryByRole("button", { name: /expand|collapse/i })).not.toBeInTheDocument();
    expect(document.querySelector("[aria-expanded]")).toBeNull();
  });
});
