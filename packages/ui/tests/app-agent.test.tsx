import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UnquoteApp } from "../src/app";
import { I18nProvider } from "../src/i18n/context";
import * as agentSession from "../src/lib/agent-session/model";
import {
  createInitialWorkspaceSelectionState,
  reduceWorkspaceSelection,
} from "../src/lib/workspace-selection";
import {
  codexRolloutSource,
  getToolbarInput,
  renderClaudeAgentView,
  renderCodexAgentView,
  useDesktopViewport,
} from "./app-test-helpers";

describe("UnquoteApp", () => {
  describe("Agent and Trajectory", { timeout: 10_000 }, () => {
    it("shows the Agent view for Codex rollout logs", async () => {
      await renderCodexAgentView();

      expect(screen.getAllByText("Codex").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Timeline").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Session overview").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Tool call").length).toBeGreaterThan(0);
    });

    it("opens an Agent parse warning Record even when filters hide it", async () => {
      const user = userEvent.setup();
      useDesktopViewport();
      render(
        <I18nProvider>
          <UnquoteApp initialInput={`${codexRolloutSource}\nnot-json`} />
        </I18nProvider>,
      );

      await screen.findByRole("button", { name: "Open Record: Line 5" });
      await user.click(screen.getByRole("tab", { name: "JSONL" }));
      await user.click(screen.getByRole("button", { name: "Messages" }));
      expect(document.querySelector('[data-record-id="record-5"]')).toBeNull();

      await user.click(screen.getByRole("tab", { name: "Agent" }));
      await user.click(await screen.findByRole("button", { name: "Open Record: Line 5" }));

      await waitFor(() => expect(document.getElementById("record-5")).toBeInTheDocument());
      expect(document.querySelector(".uq-shell")).toHaveAttribute("data-output-view", "json");
      expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    });

    it("does not show Agent output tabs without a recognized session", async () => {
      render(
        <I18nProvider>
          <UnquoteApp initialInput='{"ok":true}' />
        </I18nProvider>,
      );

      await waitFor(() => expect(document.getElementById("record-1")).toBeInTheDocument());
      expect(screen.queryByRole("tab", { name: "Agent" })).not.toBeInTheDocument();
      expect(screen.queryByRole("tab", { name: "Trajectory" })).not.toBeInTheDocument();
      expect(document.querySelector(".uq-shell")).toHaveAttribute("data-output-view", "json");
    });

    it("switches the three output tabs with keyboard navigation", async () => {
      const user = await renderCodexAgentView();

      const shell = document.querySelector(".uq-shell");
      const agentTab = screen.getByRole("tab", { name: "Agent" });
      const trajectoryTab = screen.getByRole("tab", { name: "Trajectory" });
      const jsonTab = screen.getByRole("tab", { name: "JSONL" });

      expect(shell).toHaveAttribute("data-output-view", "agent");

      agentTab.focus();
      await user.keyboard("{ArrowRight}");
      expect(trajectoryTab).toHaveAttribute("tabindex", "0");
      trajectoryTab.focus();
      await user.keyboard("{Enter}");
      await waitFor(() => expect(shell).toHaveAttribute("data-output-view", "trajectory"));
      expect(trajectoryTab).toHaveAttribute("data-active");

      await user.keyboard("{ArrowRight}");
      expect(jsonTab).toHaveAttribute("tabindex", "0");
      jsonTab.focus();
      await user.keyboard("{Enter}");
      await waitFor(() => expect(shell).toHaveAttribute("data-output-view", "json"));
      expect(jsonTab).toHaveAttribute("data-active");
    });

    it("shares one session model while switching Agent and Trajectory", async () => {
      const measureName = "unquote:agentTrajectory:build";
      performance.clearMeasures(measureName);

      const user = await renderCodexAgentView();
      expect(performance.getEntriesByName(measureName)).toHaveLength(0);

      await user.click(screen.getByRole("tab", { name: "Trajectory" }));
      await waitFor(() =>
        expect(document.querySelector("[data-trajectory-ready]")).toBeInTheDocument(),
      );
      expect(performance.getEntriesByName(measureName)).toHaveLength(1);

      await user.click(screen.getByRole("tab", { name: "Agent" }));
      await screen.findAllByText("Timeline");
      expect(performance.getEntriesByName(measureName)).toHaveLength(1);

      performance.clearMeasures(measureName);
    });

    it("updates Agent timestamps across every surface when locale changes", async () => {
      const user = await renderCodexAgentView();
      const timestamp = Date.parse("2026-06-06T13:44:08.000Z");
      const fullTimestamp = (locale: "en" | "zh-CN") =>
        new Intl.DateTimeFormat(locale, {
          dateStyle: "medium",
          timeStyle: "medium",
        }).format(timestamp);
      const clockTime = (locale: "en" | "zh-CN") =>
        new Intl.DateTimeFormat(locale, { timeStyle: "medium" }).format(timestamp);
      // Held across the locale switch: the timeline aria-label is localized too,
      // so re-querying by the English name would not find the same row.
      const timelineToolCall = (
        await screen.findAllByRole("button", { name: /^Timeline: tool · tool_use exec_command/ })
      )[0]!;

      await user.click(timelineToolCall);

      // The 250px timeline rail prints the clock time only; the conversation,
      // which has the width for it, prints the full date and time.
      expect(timelineToolCall).toHaveTextContent(clockTime("en"));
      expect(timelineToolCall).not.toHaveTextContent(fullTimestamp("en"));
      expect(screen.getAllByText(new RegExp(fullTimestamp("en"))).length).toBeGreaterThan(0);

      await user.click(screen.getByRole("button", { name: "Change language" }));
      await user.click(await screen.findByRole("menuitemradio", { name: "Chinese (Simplified)" }));

      expect(timelineToolCall).toHaveTextContent(clockTime("zh-CN"));
      expect(screen.getAllByText(new RegExp(fullTimestamp("zh-CN"))).length).toBeGreaterThan(0);
      expect(screen.queryAllByText(new RegExp(fullTimestamp("en")))).toHaveLength(0);
    });

    it("resolves Full Records for streamed Agent files", async () => {
      const user = userEvent.setup();
      const writeText = vi.fn();
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });
      const fullValueMarker = "visible-in-full-record";
      const fullOutput = `${"a".repeat(256)}${fullValueMarker}${"b".repeat(1_000_000)}`;
      const fileContents = [
        JSON.stringify({
          timestamp: "2026-06-06T13:44:06.579Z",
          type: "session_meta",
          payload: { session_id: "streamed-session", cwd: "/repo" },
        }),
        JSON.stringify({
          timestamp: "2026-06-06T13:44:06.581Z",
          type: "event_msg",
          payload: { type: "task_started", turn_id: "turn-1" },
        }),
        JSON.stringify({
          timestamp: "2026-06-06T13:44:07.964Z",
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "call_streamed",
            output: fullOutput,
          },
        }),
      ].join("\n");
      const file = new File([fileContents], "streamed-rollout.jsonl", {
        type: "application/jsonl",
      });

      render(
        <I18nProvider>
          <UnquoteApp />
        </I18nProvider>,
      );

      fireEvent.paste(
        screen.getAllByPlaceholderText("Paste JSON / JSONL, or drop a file here.")[0]!,
        { clipboardData: { files: [file], items: [], types: ["Files"] } },
      );

      const timelineToolResult = (
        await screen.findAllByRole("button", {
          name: /^Timeline: tool · tool_result/,
        })
      )[0]!;
      await user.click(timelineToolResult);

      // The turn's own JSONL link activates its record; the JSON tab's tree pane
      // is what then requests and renders the Full Record behind the Preview stub.
      await user.click(screen.getByRole("button", { name: "View in JSONL" }));
      const treePane = await waitFor(() => {
        const pane = document.getElementById("record-3");
        expect(pane).toBeInTheDocument();
        return pane!;
      });
      await waitFor(() =>
        expect(within(treePane).getByText(new RegExp(fullValueMarker))).toBeInTheDocument(),
      );

      await user.click(screen.getByRole("button", { name: "Copy record" }));
      await waitFor(() =>
        expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining(fullValueMarker)),
      );
    });

    it("keeps Agent detail selection aligned across navigation sources", async () => {
      const user = await renderCodexAgentView();
      const timelineToolCalls = await screen.findAllByRole("button", {
        name: /^Timeline: tool · tool_use exec_command/,
      });
      const timelineTaskStarted = screen.getAllByRole("button", {
        name: /^Timeline: meta · task_started/,
      });
      const conversationToolCalls = screen.getAllByRole("button", {
        name: /^Conversation: Tool call/,
      });
      const expectCurrent = (buttons: HTMLElement[], current: boolean) => {
        for (const button of buttons) {
          const item = button.closest("[role='listitem']");
          if (current) {
            expect(item).toHaveAttribute("aria-current", "true");
          } else {
            expect(item).not.toHaveAttribute("aria-current");
          }
        }
      };
      // task_started carries no conversation item, so line 2 selects the Event
      // itself while line 4 selects through its Tool call.
      const expectSelection = async (selectedLine: 2 | 4) => {
        await waitFor(() => expectCurrent(timelineToolCalls, selectedLine === 4));
        expectCurrent(timelineTaskStarted, selectedLine === 2);
        expectCurrent(conversationToolCalls, selectedLine === 4);
      };

      await user.click(timelineToolCalls[0]!);
      await expectSelection(4);
      // Selecting the tool call is what expands its argument fields.
      expect(screen.getAllByText("cmd").length).toBeGreaterThan(0);
      expect(screen.getAllByText("rg --files").length).toBeGreaterThan(0);

      await user.click(timelineTaskStarted[0]!);
      await expectSelection(2);
      expect(screen.queryByText("cmd")).not.toBeInTheDocument();

      await user.click(conversationToolCalls[0]!);
      await expectSelection(4);
    });

    it("keeps the Agent selection after opening its record in the JSONL view", async () => {
      const user = await renderCodexAgentView();
      const conversationToolCall = (
        await screen.findAllByRole("button", { name: /^Conversation: Tool call/ })
      )[0]!;

      await user.click(conversationToolCall);
      await waitFor(() => expect(conversationToolCall).toHaveAttribute("aria-pressed", "true"));

      const openInJsonl = screen.getAllByRole("button", { name: "View in JSONL" });
      await user.click(openInJsonl[openInJsonl.length - 1]!);

      const treePane = await waitFor(() => {
        const pane = document.getElementById("record-4");
        expect(pane).toBeInTheDocument();
        return pane!;
      });
      expect(within(treePane).getAllByText("call_id").length).toBeGreaterThan(0);
      expect(within(treePane).getAllByText('"call_1"').length).toBeGreaterThan(0);

      await user.click(screen.getAllByRole("tab", { name: "Agent" })[0]!);
      await waitFor(() =>
        expect(
          screen.getAllByRole("button", { name: /^Conversation: Tool call/ })[0]!,
        ).toHaveAttribute("aria-pressed", "true"),
      );
    });

    it("opens a Codex trajectory tool endpoint without discarding the shared selection or query", async () => {
      const user = await renderCodexAgentView();

      await user.click(screen.getByRole("tab", { name: "JSONL" }));
      await user.type(getToolbarInput(), "exec_command");
      await user.click(screen.getByRole("button", { name: "Commands" }));
      await user.click(await screen.findByRole("button", { name: /jq syntax/i }));
      await user.click(screen.getByRole("button", { name: /^Case sensitive$/i }));
      await user.keyboard("{Escape}");

      const messagesFilter = screen.getByRole("button", { name: "Messages" });
      await user.click(messagesFilter);
      expect(messagesFilter).toHaveAttribute("aria-pressed", "true");
      expect(document.querySelector('[data-record-id="record-4"]')).toBeNull();

      await user.click(screen.getByRole("tab", { name: "Trajectory" }));
      await waitFor(() =>
        expect(document.querySelector("[data-trajectory-ready]")).toBeInTheDocument(),
      );

      const tool = screen.getAllByRole("button", { name: /^Tool:/ })[0]!;
      const toolToken = tool.dataset.trajectoryItemToken;
      await user.click(tool);
      expect(toolToken).toBeTruthy();

      const scrollIntoView = vi.mocked(HTMLElement.prototype.scrollIntoView);
      scrollIntoView.mockClear();
      await user.click(screen.getByRole("button", { name: "Open call Record" }));

      const treePane = await waitFor(() => {
        const pane = document.getElementById("record-4");
        expect(pane).toBeInTheDocument();
        return pane!;
      });
      expect(within(treePane).getAllByText("call_id").length).toBeGreaterThan(0);
      expect(
        document.querySelector('[data-record-id="record-4"]')?.closest("[role='listitem']"),
      ).toHaveAttribute("aria-current", "true");
      expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
      expect(getToolbarInput()).toHaveValue("exec_command");

      await new Promise((resolve) => requestAnimationFrame(resolve));
      expect(
        scrollIntoView.mock.instances.some(
          (element) => (element as HTMLElement).dataset.recordId === "record-4",
        ),
      ).toBe(true);

      await user.click(screen.getByRole("button", { name: "Commands" }));
      expect(screen.getByRole("button", { name: /jq syntax/i })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByRole("button", { name: /^Case sensitive$/i })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByRole("button", { name: /^Regex$/i })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      await user.keyboard("{Escape}");

      await user.click(screen.getByRole("tab", { name: "Trajectory" }));
      await waitFor(() =>
        expect(
          document.querySelector(`[data-trajectory-item-token="${toolToken}"]`),
        ).toHaveAttribute("aria-current", "true"),
      );
    });

    it("keeps a trajectory item selected after opening an unattached warning Record", async () => {
      const createModel = agentSession.createAgentSessionModel;
      const modelSpy = vi
        .spyOn(agentSession, "createAgentSessionModel")
        .mockImplementation((session) => {
          const model = createModel(session);
          const warning = {
            kind: "unattached-token-usage" as const,
            recordId: "record-2",
            lineNumber: 2,
            selection: { kind: "event" as const, id: "line-2", recordId: "record-2" },
          };

          return {
            ...model,
            trajectory: {
              ...model.trajectory,
              warnings: [...model.trajectory.warnings, warning],
            },
          };
        });

      try {
        const user = await renderCodexAgentView();

        await user.click(screen.getByRole("tab", { name: "Trajectory" }));
        await waitFor(() =>
          expect(document.querySelector("[data-trajectory-ready]")).toBeInTheDocument(),
        );

        const selectedItem = screen.getAllByRole("button", { name: /^Tool:/ })[0]!;
        const selectedToken = selectedItem.dataset.trajectoryItemToken;
        expect(selectedToken).toBeTruthy();
        await user.click(selectedItem);
        expect(selectedItem).toHaveAttribute("aria-current", "true");

        const warningItem = screen.getByText(/Unattached token usage/).closest("li");
        if (!warningItem) {
          throw new Error("Expected an unattached warning");
        }
        await user.click(within(warningItem).getByRole("button", { name: "Open Record: Line 2" }));
        await waitFor(() => expect(document.getElementById("record-2")).toBeInTheDocument());
        expect(document.querySelector(".uq-shell")).toHaveAttribute("data-output-view", "json");

        await user.click(screen.getByRole("tab", { name: "Trajectory" }));
        await waitFor(() =>
          expect(
            document.querySelector(`[data-trajectory-item-token="${selectedToken}"]`),
          ).toHaveAttribute("aria-current", "true"),
        );
      } finally {
        modelSpy.mockRestore();
      }
    });

    it("opens a Claude trajectory tool result without discarding the shared selection or query", async () => {
      const user = await renderClaudeAgentView();

      await user.click(screen.getByRole("tab", { name: "JSONL" }));
      await user.type(getToolbarInput(), "toolu_repository");
      await user.click(screen.getByRole("button", { name: "Commands" }));
      await user.click(screen.getByRole("button", { name: /jq syntax/i }));
      await user.click(screen.getByRole("button", { name: /^Case sensitive$/i }));
      await user.click(screen.getByRole("option", { name: /Errors/ }));
      expect(document.querySelector('[data-record-id="record-3"]')).toBeNull();

      await user.click(screen.getByRole("tab", { name: "Trajectory" }));
      await waitFor(() =>
        expect(document.querySelector("[data-trajectory-ready]")).toBeInTheDocument(),
      );

      const tool = screen.getAllByRole("button", { name: /^Tool:/ })[0]!;
      const toolToken = tool.dataset.trajectoryItemToken;
      await user.click(tool);
      expect(toolToken).toBeTruthy();

      const scrollIntoView = vi.mocked(HTMLElement.prototype.scrollIntoView);
      scrollIntoView.mockClear();
      await user.click(screen.getByRole("button", { name: "Open result Record" }));

      const treePane = await waitFor(() => {
        const pane = document.getElementById("record-3");
        expect(pane).toBeInTheDocument();
        return pane!;
      });
      expect(within(treePane).getAllByText("tool_use_id").length).toBeGreaterThan(0);
      expect(
        document.querySelector('[data-record-id="record-3"]')?.closest("[role='listitem']"),
      ).toHaveAttribute("aria-current", "true");
      expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
      expect(getToolbarInput()).toHaveValue("toolu_repository");

      await new Promise((resolve) => requestAnimationFrame(resolve));
      expect(
        scrollIntoView.mock.instances.some(
          (element) => (element as HTMLElement).dataset.recordId === "record-3",
        ),
      ).toBe(true);

      await user.click(screen.getByRole("button", { name: "Commands" }));
      expect(screen.getByRole("button", { name: /jq syntax/i })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByRole("button", { name: /^Case sensitive$/i })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByRole("button", { name: /^Regex$/i })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      await user.keyboard("{Escape}");

      await user.click(screen.getByRole("tab", { name: "Trajectory" }));
      await waitFor(() =>
        expect(
          document.querySelector(`[data-trajectory-item-token="${toolToken}"]`),
        ).toHaveAttribute("aria-current", "true"),
      );
    });

    it("keeps a trajectory endpoint Record active when its search finishes after the open", async () => {
      interface SearchWorkerPrototype {
        completeSearch(
          requestId: number,
          text: string,
          forcedFormat: "json" | "jsonl" | undefined,
          query: string,
          options: unknown,
          windowIndexes?: Float64Array,
        ): void;
      }

      const searchWorker = (globalThis.Worker as unknown as { prototype: SearchWorkerPrototype })
        .prototype;
      const completeSearch = searchWorker.completeSearch;
      const delayedSearches: Array<() => void> = [];
      const deferredSearch = vi.spyOn(searchWorker, "completeSearch").mockImplementation(function (
        this: SearchWorkerPrototype,
        ...args: Parameters<SearchWorkerPrototype["completeSearch"]>
      ) {
        delayedSearches.push(() => completeSearch.apply(this, args));
      });

      try {
        const user = await renderCodexAgentView();
        const shell = document.querySelector<HTMLElement>(".uq-shell")!;

        await user.click(screen.getByRole("tab", { name: "JSONL" }));
        await user.click(screen.getByRole("button", { name: "Commands" }));
        await user.click(screen.getByRole("button", { name: /jq syntax/i }));
        await user.click(screen.getByRole("button", { name: /^Case sensitive$/i }));
        await user.keyboard("{Escape}");

        const messagesFilter = screen.getByRole("button", { name: "Messages" });
        await user.click(messagesFilter);
        expect(messagesFilter).toHaveAttribute("aria-pressed", "true");

        await user.type(getToolbarInput(), "task_started");
        await waitFor(() => expect(delayedSearches).toHaveLength(1));

        await user.click(screen.getByRole("tab", { name: "Trajectory" }));
        await waitFor(() =>
          expect(document.querySelector("[data-trajectory-ready]")).toBeInTheDocument(),
        );
        await user.click(screen.getAllByRole("button", { name: /^Tool:/ })[0]!);
        await user.click(screen.getByRole("button", { name: "Open call Record" }));

        await waitFor(() => expect(document.getElementById("record-4")).toBeInTheDocument());
        await act(async () => {
          delayedSearches.forEach((complete) => complete());
          await Promise.resolve();
        });
        await waitFor(() => expect(shell).toHaveAttribute("data-search-state", "complete"));

        expect(document.getElementById("record-4")).toBeInTheDocument();
        expect(getToolbarInput()).toHaveValue("task_started");

        await user.click(screen.getByRole("button", { name: "Commands" }));
        expect(screen.getByRole("button", { name: /jq syntax/i })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        expect(screen.getByRole("button", { name: /^Case sensitive$/i })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
      } finally {
        deferredSearch.mockRestore();
      }
    });

    it("uses the final endpoint open when two actions are dispatched consecutively", () => {
      const firstSelection = {
        kind: "trajectory",
        id: "tool-call:evidence-0",
        recordId: "record-call-1",
      } as const;
      const finalSelection = {
        kind: "trajectory",
        id: "tool-call:evidence-1",
        recordId: "record-call-2",
      } as const;
      const afterFirstOpen = reduceWorkspaceSelection(createInitialWorkspaceSelectionState(), {
        type: "openAgentRecord",
        selection: firstSelection,
        recordId: "record-result-1",
      });
      const afterFinalOpen = reduceWorkspaceSelection(afterFirstOpen, {
        type: "openAgentRecord",
        selection: finalSelection,
        recordId: "record-result-2",
      });

      expect(afterFinalOpen).toMatchObject({
        activeRecordId: "record-result-2",
        detailSelection: finalSelection,
        scrollIntent: { kind: "record", recordId: "record-result-2" },
      });
    });

    it("does not change the filter or output when a trajectory endpoint Record is missing", async () => {
      const createModel = agentSession.createAgentSessionModel;
      const modelSpy = vi
        .spyOn(agentSession, "createAgentSessionModel")
        .mockImplementation((session) => {
          const model = createModel(session);
          const tool = model.trajectory.items.find((item) => item.kind === "tool");
          if (!tool || tool.kind !== "tool" || !tool.callSelection) {
            return model;
          }
          const callSelection = tool.callSelection;
          const missingCallSelection =
            callSelection.kind === "record"
              ? { kind: "record" as const, recordId: "missing-record" }
              : callSelection.kind === "event"
                ? { kind: "event" as const, id: callSelection.id, recordId: "missing-record" }
                : {
                    kind: "conversation" as const,
                    id: callSelection.id,
                    recordId: "missing-record",
                  };

          return {
            ...model,
            trajectory: {
              ...model.trajectory,
              items: model.trajectory.items.map((item) =>
                item === tool
                  ? {
                      ...tool,
                      callSelection: missingCallSelection,
                    }
                  : item,
              ),
            },
          };
        });

      try {
        const user = await renderCodexAgentView();
        expect(modelSpy).toHaveBeenCalled();

        await user.click(screen.getByRole("tab", { name: "JSONL" }));
        const messagesFilter = screen.getByRole("button", { name: "Messages" });
        await user.click(messagesFilter);
        expect(messagesFilter).toHaveAttribute("aria-pressed", "true");

        await user.click(screen.getByRole("tab", { name: "Trajectory" }));
        await waitFor(() =>
          expect(document.querySelector("[data-trajectory-ready]")).toBeInTheDocument(),
        );
        await user.click(screen.getAllByRole("button", { name: /^Tool:/ })[0]!);
        await user.click(screen.getByRole("button", { name: "Open call Record" }));

        expect(document.querySelector(".uq-shell")).toHaveAttribute(
          "data-output-view",
          "trajectory",
        );

        await user.click(screen.getByRole("tab", { name: "JSONL" }));
        expect(screen.getByRole("button", { name: "Messages" })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
      } finally {
        modelSpy.mockRestore();
      }
    });
  });
});
