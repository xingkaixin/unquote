import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";
import { UnquoteApp } from "../src/app";
import { memorySearchDebounceMs } from "../src/hooks/use-query-interaction";
import { searchWorkerTimeoutMs } from "../src/hooks/use-search-worker";
import * as agentSession from "../src/lib/agent-session";
import { inspectorNodeLimit } from "../src/lib/selected-node";
import {
  createInitialWorkspaceSelectionState,
  reduceWorkspaceSelection,
} from "../src/lib/workspace-selection";
import { I18nProvider, useTranslation } from "../src/i18n/context";
import { setInitialSearchWindowIndexes } from "./helpers/app-worker";
import { createControlledStreamFile, createFailingStreamFile } from "./helpers/stub-file";

const maxTransferStringLength = 4096;
const commandInputPlaceholder = "Search text, or enter $.path to jump...";
const inputFormatLabel = "Input format";
const defaultMatchMedia = vi.mocked(window.matchMedia).getMockImplementation()!;

const useDesktopViewport = () => {
  vi.mocked(window.matchMedia).mockImplementation((query) => {
    const result = defaultMatchMedia(query);
    return { ...result, matches: query === "(min-width: 64rem)" || result.matches };
  });
};

const LocaleProbe = () => {
  const { setLocale, t } = useTranslation();
  return <button onClick={() => setLocale("zh-CN")}>{t("status.clear")}</button>;
};
const codexRolloutSource = [
  JSON.stringify({
    timestamp: "2026-06-06T13:44:06.579Z",
    type: "session_meta",
    payload: {
      session_id: "session-1",
      cwd: "/repo",
      cli_version: "0.137.0",
    },
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
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Inspect the repo" }],
    },
  }),
  JSON.stringify({
    timestamp: "2026-06-06T13:44:08.000Z",
    type: "response_item",
    payload: {
      type: "function_call",
      name: "exec_command",
      arguments: JSON.stringify({ cmd: "rg --files" }),
      call_id: "call_1",
    },
  }),
].join("\n");

const claudeTrajectorySource = [
  JSON.stringify({
    type: "user",
    uuid: "claude-user-1",
    sessionId: "claude-session-1",
    promptId: "claude-prompt-1",
    timestamp: "2026-06-07T09:00:00.000Z",
    message: { role: "user", content: "Inspect the repository" },
  }),
  JSON.stringify({
    type: "assistant",
    uuid: "claude-assistant-1",
    sessionId: "claude-session-1",
    timestamp: "2026-06-07T09:00:01.000Z",
    message: {
      role: "assistant",
      model: "claude-sonnet-4-5",
      content: [
        {
          type: "tool_use",
          id: "toolu_repository",
          name: "Bash",
          input: { command: "pwd" },
        },
      ],
    },
  }),
  JSON.stringify({
    type: "user",
    uuid: "claude-user-2",
    sessionId: "claude-session-1",
    promptId: "claude-prompt-1",
    timestamp: "2026-06-07T09:00:02.000Z",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_repository",
          content: "/repo",
          is_error: false,
        },
      ],
    },
  }),
].join("\n");

const getToolbarInput = () => {
  const inputs = screen.getAllByPlaceholderText(commandInputPlaceholder);
  return inputs[1] ?? inputs[0]!;
};

const readBlobText = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob"));
    reader.readAsText(blob);
  });

const renderCodexAgentView = async () => {
  const user = userEvent.setup();
  useDesktopViewport();
  render(
    <I18nProvider>
      <UnquoteApp initialInput={codexRolloutSource} />
    </I18nProvider>,
  );

  await screen.findAllByRole("tab", { name: "Agent" });
  await screen.findAllByText("Timeline");
  return user;
};

const renderClaudeAgentView = async () => {
  const user = userEvent.setup();
  useDesktopViewport();
  render(
    <I18nProvider>
      <UnquoteApp initialInput={claudeTrajectorySource} />
    </I18nProvider>,
  );

  await screen.findAllByRole("tab", { name: "Agent" });
  await screen.findAllByText("Timeline");
  return user;
};

const filterableJsonlInput = [
  '{"level":"info","payload":"{\\"nested\\":true}"}',
  '{"level":"error","message":"boom"}',
  "not-json",
].join("\n");

type User = ReturnType<typeof userEvent.setup>;

// The header source button is named by what it shows — the loaded source plus
// the "Change" hint — so assistive tech and voice control can reach it by name.
const sourceButton = () => screen.getByRole("button", { name: /Change$/ });

const setInputFormat = async (user: User, label: "Auto" | "JSON" | "JSONL") => {
  await user.click(sourceButton());
  const dialog = await screen.findByRole("dialog");
  await user.click(
    within(within(dialog).getByRole("group", { name: inputFormatLabel })).getByRole("button", {
      name: label,
    }),
  );
  await user.click(within(dialog).getByRole("button", { name: "Parse" }));
};

const pasteFileIntoImport = async (user: User, file: File) => {
  await user.click(sourceButton());
  const dialog = await screen.findByRole("dialog");
  fireEvent.paste(within(dialog).getByRole("textbox", { name: "Source input" }), {
    clipboardData: { files: [file], items: [], types: ["Files"] },
  });
};

const railRow = (lineNumber: number) =>
  screen
    .getAllByText(`#${lineNumber}`)
    .map((node) => node.closest("button"))
    .find((button): button is HTMLButtonElement => Boolean(button))!;

const railItem = (lineNumber: number) => railRow(lineNumber).closest("[role='listitem']")!;

// The workspace shows one record at a time, so reaching another record's tree
// goes through its rail row.
const selectRailRecord = async (user: User, lineNumber: number) => {
  const row = railRow(lineNumber);
  await user.click(row);
  return row;
};

const replaceSource = async (user: User, text: string) => {
  await user.click(sourceButton());
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Source input" }), {
    target: { value: text },
  });
  await user.click(within(dialog).getByRole("button", { name: "Parse" }));
};

const renderFilterableJsonl = async (user: User) => {
  useDesktopViewport();
  render(
    <I18nProvider>
      <UnquoteApp initialInput={filterableJsonlInput} />
    </I18nProvider>,
  );

  await setInputFormat(user, "JSONL");
  await waitFor(() => expect(screen.getAllByText("#3").length).toBeGreaterThan(0));
};

export type AppTestGroup = "shell" | "agent" | "records" | "local-file" | "search" | "expansion";

const appTestGroupLabels: Record<AppTestGroup, string> = {
  shell: "shell and import",
  agent: "Agent and Trajectory",
  records: "records and errors",
  "local-file": "local files",
  search: "search",
  expansion: "stringified JSON expansion",
};

export const registerAppTests = (selectedGroup: AppTestGroup) => {
  const registerGroup = (group: AppTestGroup, tests: () => void) => {
    if (group === selectedGroup) {
      describe(appTestGroupLabels[group], tests);
    }
  };

  describe("UnquoteApp", () => {
    registerGroup("shell", () => {
      it("renders the shell landmarks around a loaded source", async () => {
        render(
          <I18nProvider>
            <UnquoteApp initialInput='{"ok":true}' />
          </I18nProvider>,
        );
        const skipLink = screen.getByRole("link", { name: "Skip to main content" });
        const main = screen.getByRole("main");
        expect(skipLink).toHaveAttribute("href", "#main-content");
        expect(skipLink).toHaveClass("focus:not-sr-only");
        expect(main).toHaveAttribute("id", "main-content");
        expect(main).toHaveAttribute("tabindex", "-1");

        // With data loaded the shell shows the workspace, not the import panel.
        expect(screen.queryByRole("textbox", { name: "Source input" })).not.toBeInTheDocument();
        await waitFor(() => expect(document.querySelectorAll("#record-1")).toHaveLength(1));
        expect(screen.getAllByRole("textbox", { name: "Search or jump" })).toHaveLength(1);
      });

      it("opens the import dialog over a loaded workspace and returns from it", async () => {
        const user = userEvent.setup();
        render(
          <I18nProvider>
            <UnquoteApp initialInput='{"ok":true}' />
          </I18nProvider>,
        );
        await waitFor(() => expect(document.querySelectorAll("#record-1")).toHaveLength(1));

        await user.click(sourceButton());
        const dialog = await screen.findByRole("dialog", { name: "Import data" });
        expect(within(dialog).getByRole("textbox", { name: "Source input" })).toHaveValue(
          '{"ok":true}',
        );

        // The palette must not stack over the modal.
        await user.keyboard("{Meta>}k{/Meta}");
        expect(
          screen.queryByRole("dialog", { name: "Find, jump, and commands" }),
        ).not.toBeInTheDocument();

        const formatGroup = within(dialog).getByRole("group", { name: inputFormatLabel });
        await user.click(within(formatGroup).getByRole("button", { name: "JSONL" }));
        expect(within(formatGroup).getByRole("button", { name: "JSONL" })).toHaveAttribute(
          "aria-pressed",
          "true",
        );

        await user.click(within(dialog).getByRole("button", { name: "Back" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        expect(document.querySelectorAll("#record-1")).toHaveLength(1);

        await user.click(sourceButton());
        const reopenedDialog = await screen.findByRole("dialog", { name: "Import data" });
        expect(
          within(within(reopenedDialog).getByRole("group", { name: inputFormatLabel })).getByRole(
            "button",
            { name: "Auto" },
          ),
        ).toHaveAttribute("aria-pressed", "true");
      });

      it("opens straight into the workspace for an extension selection", async () => {
        render(
          <I18nProvider>
            <UnquoteApp initialInput='{"selection":"handoff"}' />
          </I18nProvider>,
        );

        // The extension passes the selected text as initialInput and never sees the
        // empty state, so hasData has to be true on the very first paint.
        expect(screen.queryByText("Paste, drop, or choose a file")).not.toBeInTheDocument();
        expect(screen.queryByText("No data loaded · waiting for import")).not.toBeInTheDocument();
        expect(screen.getByRole("textbox", { name: "Search or jump" })).toBeEnabled();
        // The source button names what is loaded; a pasted draft has no file name
        // but the workspace is still loaded, so it must not read "No data loaded".
        // The accessible name has to contain that visible text (WCAG 2.5.3).
        expect(sourceButton()).toHaveTextContent("Pasted text");
        expect(screen.getByRole("button", { name: "Pasted text Change" })).toBe(sourceButton());

        await waitFor(() => expect(document.getElementById("record-1")).toBeInTheDocument());
        expect(screen.getByText("selection")).toBeInTheDocument();
      });

      it("renders the empty state with disabled workspace chrome", () => {
        render(
          <I18nProvider>
            <UnquoteApp />
          </I18nProvider>,
        );

        expect(screen.getAllByRole("textbox", { name: "Source input" })).toHaveLength(1);
        expect(screen.getByText("No data loaded · waiting for import")).toBeInTheDocument();
        expect(sourceButton()).toHaveTextContent("No data loaded");
        expect(screen.getByRole("textbox", { name: "Search or jump" })).toBeDisabled();
      });

      it("gives the header chrome controls one bordered treatment", () => {
        render(
          <I18nProvider>
            <UnquoteApp />
          </I18nProvider>,
        );

        // dc:58-59 borders the header controls with --line2; the locale, theme and
        // export triggers used to compute a transparent border and a 0px radius.
        for (const name of ["Change language", "Switch theme", "Export"]) {
          expect(screen.getByRole("button", { name })).toHaveClass(
            "border-border-medium",
            "rounded-md",
          );
        }
      });

      it("renders configured extension store links", () => {
        const chromeWebStoreUrl = "https://chrome.example/extension";
        const edgeAddonsUrl = "https://edge.example/extension";
        render(
          <I18nProvider>
            <UnquoteApp chromeWebStoreUrl={chromeWebStoreUrl} edgeAddonsUrl={edgeAddonsUrl} />
          </I18nProvider>,
        );

        expect(screen.getByRole("link", { name: "Chrome Extension" })).toHaveAttribute(
          "href",
          chromeWebStoreUrl,
        );
        expect(screen.getByRole("link", { name: "Edge Extension" })).toHaveAttribute(
          "href",
          edgeAddonsUrl,
        );
        for (const link of screen.getAllByRole("link", { name: /Extension$/ })) {
          expect(link).toHaveAttribute("target", "_blank");
          expect(link).toHaveAttribute("rel", "noreferrer");
        }
      });

      it("exposes command options and restores focus when the palette closes", async () => {
        const user = userEvent.setup();
        render(
          <I18nProvider>
            <UnquoteApp initialInput='{"ok":true}' />
          </I18nProvider>,
        );

        expect(getToolbarInput().closest("form")).toHaveClass("focus-within:outline-2");
        const trigger = screen.getAllByRole("button", { name: "Commands" })[0]!;
        await user.click(trigger);

        const dialog = await screen.findByRole("dialog", { name: "Find, jump, and commands" });
        const commandInput = within(dialog).getByRole("combobox", { name: "Search or jump" });
        const commandFilter = within(dialog).getByRole("textbox", { name: "Filter commands..." });
        const actionList = within(dialog).getByRole("listbox", { name: "Record filters" });
        const options = within(actionList).getAllByRole("option");

        expect(commandInput.parentElement).toHaveClass("focus-within:outline-2");
        expect(commandFilter).toHaveClass("focus-visible:outline-2");
        expect(within(dialog).getByRole("button", { name: /jq syntax/i })).toHaveAttribute(
          "aria-pressed",
          "false",
        );

        await waitFor(() => expect(commandInput).toHaveFocus());
        expect(commandInput).toHaveAttribute("aria-activedescendant", options[0]!.id);

        await user.keyboard("{ArrowDown}");
        expect(commandInput).toHaveAttribute("aria-activedescendant", options[1]!.id);

        await user.keyboard("{Shift>}{Tab}{/Shift}");
        await waitFor(() => expect(commandFilter).toHaveFocus());

        await user.keyboard("{Escape}");
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(trigger).toHaveFocus();
      });

      it("exposes theme and locale choices as checked menu radio items", async () => {
        const user = userEvent.setup();
        render(
          <I18nProvider>
            <UnquoteApp />
          </I18nProvider>,
        );

        await user.click(screen.getByRole("button", { name: "Switch theme" }));
        expect(await screen.findByRole("menuitemradio", { name: "System" })).toHaveAttribute(
          "aria-checked",
          "true",
        );
        expect(screen.getByRole("menuitemradio", { name: "Light" })).toHaveAttribute(
          "aria-checked",
          "false",
        );
        await user.keyboard("{Escape}");

        await user.click(screen.getByRole("button", { name: "Change language" }));
        expect(await screen.findByRole("menuitemradio", { name: "English" })).toHaveAttribute(
          "aria-checked",
          "true",
        );
        expect(screen.getByRole("menuitemradio", { name: "Chinese (Simplified)" })).toHaveAttribute(
          "aria-checked",
          "false",
        );
      });

      it("renders and parses input", async () => {
        render(
          <I18nProvider>
            <UnquoteApp initialInput='{"payload":"{\\"ok\\":true}"}' />
          </I18nProvider>,
        );
        await waitFor(() => expect(screen.getAllByText("#1").length).toBeGreaterThan(0));
        expect(screen.getAllByText("Expand All")[0]).toBeInTheDocument();
        expect(screen.getAllByPlaceholderText(commandInputPlaceholder)[0]).toBeInTheDocument();
      });

      it("renders a continuous heading hierarchy", async () => {
        render(
          <I18nProvider>
            <UnquoteApp initialInput='{"value":1}' />
          </I18nProvider>,
        );
        await waitFor(() => expect(screen.getAllByText("value").length).toBeGreaterThan(0));

        const levels = screen
          .getAllByRole("heading")
          .map((heading) => Number(heading.tagName.slice(1)));
        expect(levels[0]).toBe(1);
        expect(levels).toContain(2);
        levels.slice(1).forEach((level, index) => {
          expect(level).toBeLessThanOrEqual(levels[index]! + 1);
        });
      });

      it("shows localized sample chips for empty input", () => {
        render(
          <I18nProvider>
            <UnquoteApp />
          </I18nProvider>,
        );

        const sampleGroup = screen.getAllByRole("group", { name: "Sample inputs" })[0]!;
        expect(
          within(sampleGroup).getByRole("button", { name: "Escaped API response" }),
        ).toBeInTheDocument();
        expect(
          within(sampleGroup).getByRole("button", { name: "Agent tool-call JSONL" }),
        ).toBeInTheDocument();
        expect(
          within(sampleGroup).getByRole("button", { name: "Mixed valid/invalid JSONL" }),
        ).toBeInTheDocument();
      });

      it("shows sample chip labels in Chinese locale", () => {
        localStorage.setItem("unquote-locale", "zh-CN");

        render(
          <I18nProvider>
            <UnquoteApp />
          </I18nProvider>,
        );

        const sampleGroup = screen.getAllByRole("group", { name: "样例输入" })[0]!;
        expect(
          within(sampleGroup).getByRole("button", { name: "转义 API 响应" }),
        ).toBeInTheDocument();
        expect(
          within(sampleGroup).getByRole("button", { name: "Agent 工具调用 JSONL" }),
        ).toBeInTheDocument();
        expect(
          within(sampleGroup).getByRole("button", { name: "有效/无效混合 JSONL" }),
        ).toBeInTheDocument();
        expect(document.documentElement).toHaveAttribute("lang", "zh-CN");
        expect(screen.getAllByText("粘贴、拖入或选择一个文件").length).toBeGreaterThan(0);
        expect(screen.getByRole("button", { name: "自动" })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
      });

      it("updates document language and accessible copy when locale changes", async () => {
        const user = userEvent.setup();
        render(
          <I18nProvider>
            <LocaleProbe />
          </I18nProvider>,
        );

        expect(document.documentElement).toHaveAttribute("lang", "en");
        await user.click(screen.getByRole("button", { name: "Clear" }));

        expect(document.documentElement).toHaveAttribute("lang", "zh-CN");
        expect(screen.getByRole("button", { name: "清空" })).toBeInTheDocument();
      });

      it("loads the escaped API response sample", async () => {
        const user = userEvent.setup();
        render(
          <I18nProvider>
            <UnquoteApp />
          </I18nProvider>,
        );

        const sampleGroup = screen.getAllByRole("group", { name: "Sample inputs" })[0]!;
        await user.click(within(sampleGroup).getByRole("button", { name: "Escaped API response" }));

        // A sample publishes immediately: the empty state gives way to the workspace.
        await waitFor(() => expect(screen.getAllByText("body").length).toBeGreaterThan(0));
        expect(screen.queryByRole("textbox", { name: "Source input" })).not.toBeInTheDocument();
        expect(screen.queryByText("nested json")).not.toBeInTheDocument();
        expect(screen.getAllByText("items").length).toBeGreaterThan(0);
      });

      it("loads the agent tool-call JSONL sample", async () => {
        const user = userEvent.setup();
        render(
          <I18nProvider>
            <UnquoteApp />
          </I18nProvider>,
        );

        const sampleGroup = screen.getAllByRole("group", { name: "Sample inputs" })[0]!;
        await user.click(
          within(sampleGroup).getByRole("button", { name: "Agent tool-call JSONL" }),
        );

        await waitFor(() => expect(screen.getAllByText("#3").length).toBeGreaterThan(0));

        // The sample seeds `$.args` as expanded, so opening record 2 shows the
        // stringified payload already unwrapped.
        await selectRailRecord(user, 2);
        expect(screen.getAllByText(/tool_call/).length).toBeGreaterThan(0);
        expect(screen.getAllByText("action").length).toBeGreaterThan(0);
        expect(screen.queryByText("nested json")).not.toBeInTheDocument();
        expect(screen.getAllByText("customerId").length).toBeGreaterThan(0);
      });
    });

    registerGroup("agent", () => {
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
        expect(performance.getEntriesByName(measureName)).toHaveLength(1);

        await user.click(screen.getByRole("tab", { name: "Trajectory" }));
        await waitFor(() =>
          expect(document.querySelector("[data-trajectory-ready]")).toBeInTheDocument(),
        );

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
        await user.click(
          await screen.findByRole("menuitemradio", { name: "Chinese (Simplified)" }),
        );

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
          await user.click(
            within(warningItem).getByRole("button", { name: "Open Record: Line 2" }),
          );
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
        const deferredSearch = vi
          .spyOn(searchWorker, "completeSearch")
          .mockImplementation(function (
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

    registerGroup("records", () => {
      it("loads the mixed JSONL sample with failed records", async () => {
        const user = userEvent.setup();
        render(
          <I18nProvider>
            <UnquoteApp />
          </I18nProvider>,
        );

        const sampleGroup = screen.getAllByRole("group", { name: "Sample inputs" })[0]!;
        await user.click(
          within(sampleGroup).getByRole("button", { name: "Mixed valid/invalid JSONL" }),
        );

        await waitFor(() => expect(screen.getAllByText("#3").length).toBeGreaterThan(0));
        expect(screen.getAllByText("3 total · 2 ok · 1 err").length).toBeGreaterThan(0);
        expect(screen.getAllByText("Parse failed").length).toBeGreaterThan(0);
      });

      it("filters JSONL records across the record list and search", async () => {
        const user = userEvent.setup();
        await renderFilterableJsonl(user);

        await user.type(getToolbarInput(), "boom");
        await user.click(screen.getAllByRole("button", { name: /Commands/ })[0]!);
        await user.click(await screen.findByRole("option", { name: /Matches/ }));

        await waitFor(() => expect(screen.getAllByText("#2").length).toBeGreaterThan(0));
        expect(screen.queryAllByText("#1")).toHaveLength(0);
        expect(screen.queryAllByText("#3")).toHaveLength(0);
        expect(screen.getAllByText("boom").length).toBeGreaterThan(0);
        expect(screen.getByText("1 / 3 records match this filter")).toBeInTheDocument();

        await user.click(screen.getAllByRole("button", { name: /Commands/ })[0]!);
        await user.click(screen.getByRole("option", { name: /Errors/ }));
        await waitFor(() => expect(screen.getAllByText("#3").length).toBeGreaterThan(0));
        expect(screen.getAllByText("#2").length).toBeGreaterThan(0);
        expect(screen.getAllByText("not-json").length).toBeGreaterThan(0);

        await user.click(screen.getAllByRole("button", { name: /Commands/ })[0]!);
        await user.click(screen.getByRole("option", { name: /Nested/ }));
        await waitFor(() => expect(screen.getAllByText("#1").length).toBeGreaterThan(0));
        expect(screen.queryAllByText("#2")).toHaveLength(0);
        expect(screen.queryByText("nested json")).not.toBeInTheDocument();
        expect(screen.getAllByText("payload").length).toBeGreaterThan(0);
      });

      it("copies and exports filtered JSONL records", async () => {
        const user = userEvent.setup();
        const writeText = vi.fn();
        const exportedBlobs: Blob[] = [];
        Object.defineProperty(URL, "createObjectURL", {
          configurable: true,
          value: vi.fn((blob: Blob) => {
            exportedBlobs.push(blob);
            return `blob:export-${exportedBlobs.length}`;
          }),
        });
        Object.defineProperty(URL, "revokeObjectURL", {
          configurable: true,
          value: vi.fn(),
        });
        vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: { writeText },
        });
        await renderFilterableJsonl(user);

        await user.click(screen.getAllByRole("button", { name: /Commands/ })[0]!);
        await user.click(screen.getByRole("option", { name: /Nested/ }));
        await waitFor(() => expect(screen.getAllByText("#1").length).toBeGreaterThan(0));
        expect(screen.queryAllByText("#2")).toHaveLength(0);

        await user.click(screen.getAllByRole("button", { name: "Export" })[0]!);
        await user.click(await screen.findByText("Copy JSONL"));

        expect(writeText).toHaveBeenLastCalledWith('{"level":"info","payload":{"nested":true}}');

        await user.click(screen.getAllByRole("button", { name: "Export" })[0]!);
        await user.click(await screen.findByText("Export JSONL"));
        await waitFor(() => expect(exportedBlobs).toHaveLength(1));
        await expect(readBlobText(exportedBlobs[0]!)).resolves.toBe(
          '{"level":"info","payload":{"nested":true}}',
        );

        await user.click(screen.getAllByRole("button", { name: "Export" })[0]!);
        await user.click(await screen.findByText("Export JSON"));
        await waitFor(() => expect(exportedBlobs).toHaveLength(2));
        await expect(readBlobText(exportedBlobs[1]!)).resolves.toBe(
          JSON.stringify([{ level: "info", payload: { nested: true } }], null, 2),
        );
      });

      it("windows a large record list without observing it", async () => {
        const originalIntersectionObserver = globalThis.IntersectionObserver;
        const observerOptions: IntersectionObserverInit[] = [];
        Object.assign(globalThis, {
          IntersectionObserver: class {
            constructor(
              _callback: IntersectionObserverCallback,
              options?: IntersectionObserverInit,
            ) {
              observerOptions.push(options ?? {});
            }
            disconnect() {}
            observe() {}
            unobserve() {}
            takeRecords() {
              return [];
            }
          },
        });

        try {
          const input = Array.from({ length: 161 }, (_, index) =>
            JSON.stringify({ event: "message", index }),
          ).join("\n");

          render(
            <I18nProvider>
              <UnquoteApp initialInput={input} />
            </I18nProvider>,
          );

          await waitFor(() =>
            expect(screen.getAllByText("161 total · 161 ok · 0 err").length).toBeGreaterThan(0),
          );

          // One record is rendered at a time and the rail virtualizes, so nothing
          // is left to observe: no scroll-spy, no lazy row hydration.
          expect(observerOptions).toHaveLength(0);
          const railRows = document
            .querySelector("[data-record-rail]")!
            .querySelectorAll("[role='listitem']");
          expect(railRows.length).toBeLessThan(161);
          expect(document.querySelectorAll("[id^='record-']:not([id*=':'])")).toHaveLength(1);
        } finally {
          Object.assign(globalThis, { IntersectionObserver: originalIntersectionObserver });
        }
      });

      it("selects nodes and copies extraction payloads", async () => {
        const user = userEvent.setup();
        const writeText = vi.fn();
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: { writeText },
        });
        const input = JSON.stringify({
          payload: JSON.stringify({ ok: true, nested: { count: 2 } }),
          other: 1,
        });

        render(
          <I18nProvider>
            <UnquoteApp initialInput={input} />
          </I18nProvider>,
        );

        await waitFor(() => expect(screen.getAllByText("payload").length).toBeGreaterThan(0));
        await user.click(screen.getAllByText("payload")[0]!);
        expect(screen.queryByText("Path Inspector")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "path" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "jq" })).not.toBeInTheDocument();
        expect(screen.queryByText("{2}")).not.toBeInTheDocument();

        await user.keyboard("{Control>}c{/Control}");
        expect(writeText).toHaveBeenLastCalledWith(
          `"payload": ${JSON.stringify({ ok: true, nested: { count: 2 } }, null, 2)}`,
        );
      });

      it("copies path-jump selections with the resolved key prefix", async () => {
        const user = userEvent.setup();
        const writeText = vi.fn();
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: { writeText },
        });
        const input = JSON.stringify({ payload: { items: [10, 20] } });

        render(
          <I18nProvider>
            <UnquoteApp initialInput={input} />
          </I18nProvider>,
        );

        await waitFor(() => expect(screen.getAllByText("payload").length).toBeGreaterThan(0));

        // Path jump to an object member: the copy payload carries the member key.
        fireEvent.change(getToolbarInput(), { target: { value: "$.payload" } });
        fireEvent.keyDown(getToolbarInput(), { key: "Enter" });
        await user.keyboard("{Control>}c{/Control}");
        await waitFor(() =>
          expect(writeText).toHaveBeenLastCalledWith(
            `"payload": ${JSON.stringify({ items: [10, 20] }, null, 2)}`,
          ),
        );

        // Path jump to an array element: the copy payload has no key prefix.
        fireEvent.change(getToolbarInput(), { target: { value: "$.payload.items[0]" } });
        fireEvent.keyDown(getToolbarInput(), { key: "Enter" });
        await user.keyboard("{Control>}c{/Control}");
        await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("10"));
      });

      it("blocks selected-node copy beyond its projection budget", async () => {
        const user = userEvent.setup();
        const writeText = vi.fn();
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: { writeText },
        });
        const input = JSON.stringify({
          list: Array.from({ length: inspectorNodeLimit + 1 }, (_, index) => index),
        });

        const { container } = render(
          <I18nProvider>
            <UnquoteApp initialInput={input} />
          </I18nProvider>,
        );

        const shell = container.querySelector<HTMLElement>(".uq-shell")!;
        await waitFor(() => expect(shell).toHaveAttribute("data-parse-state", "complete"));
        fireEvent.change(getToolbarInput(), { target: { value: "$.list" } });
        fireEvent.keyDown(getToolbarInput(), { key: "Enter" });
        expect(await screen.findByText("This value is too large to preview")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Copy value" })).toBeDisabled();

        await user.keyboard("{Control>}c{/Control}");

        expect(writeText).not.toHaveBeenCalled();
        expect(
          (await screen.findAllByText("This value is too large to copy")).length,
        ).toBeGreaterThan(0);
      });

      it("shows an error toast when the clipboard write fails", async () => {
        const user = userEvent.setup();
        const writeText = vi.fn().mockRejectedValue(new Error("denied"));
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: { writeText },
        });

        render(
          <I18nProvider>
            <UnquoteApp initialInput={'{"payload":1}'} />
          </I18nProvider>,
        );

        await waitFor(() => expect(screen.getAllByText("payload").length).toBeGreaterThan(0));
        await user.click(screen.getAllByText("payload")[0]!);

        await user.keyboard("{Control>}c{/Control}");
        await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
        expect((await screen.findAllByText("Copy failed")).length).toBeGreaterThan(0);
      });

      it("copies selections whose key contains regex metacharacters", async () => {
        const user = userEvent.setup();
        const writeText = vi.fn();
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: { writeText },
        });

        render(
          <I18nProvider>
            <UnquoteApp initialInput={'{"a(b":1}'} />
          </I18nProvider>,
        );

        await waitFor(() => expect(screen.getAllByText("a(b").length).toBeGreaterThan(0));
        await user.click(screen.getAllByText("a(b")[0]!);

        await user.keyboard("{Control>}c{/Control}");
        await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('"a(b": 1'));
      });

      it("shows JSON parse location on the failed record", async () => {
        render(
          <I18nProvider>
            <UnquoteApp initialInput={"{\n bad\n}"} />
          </I18nProvider>,
        );

        await waitFor(() => expect(screen.getAllByText("Parse failed").length).toBeGreaterThan(0));
        expect(screen.getAllByText("Line 2, column 2").length).toBeGreaterThan(0);
      });

      it("shows parse error UI in Chinese locale", async () => {
        localStorage.setItem("unquote-locale", "zh-CN");

        render(
          <I18nProvider>
            <UnquoteApp initialInput={"{\n bad\n}"} />
          </I18nProvider>,
        );

        await waitFor(() => expect(screen.getAllByText("解析失败").length).toBeGreaterThan(0));
        expect(screen.getAllByText("第 2 行，第 2 列").length).toBeGreaterThan(0);
      });

      it("copies a failed JSONL raw line", async () => {
        const user = userEvent.setup();
        const writeText = vi.fn();
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: { writeText },
        });

        render(
          <I18nProvider>
            <UnquoteApp initialInput={'{"ok":1}\n{bad}'} />
          </I18nProvider>,
        );

        await waitFor(() => expect(screen.getAllByText("#2").length).toBeGreaterThan(0));
        await selectRailRecord(user, 2);

        await waitFor(() =>
          expect(screen.getAllByText("Line 2, column 2").length).toBeGreaterThan(0),
        );
        await user.click(screen.getAllByRole("button", { name: /Copy raw line/ })[0]!);

        expect(writeText).toHaveBeenLastCalledWith("{bad}");

        await user.click(screen.getAllByRole("button", { name: /Copy error/ })[0]!);
        expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining("Line 2, column 2"));
      });
    });

    registerGroup("local-file", () => {
      it("shows file drag feedback on the source input", () => {
        render(
          <I18nProvider>
            <UnquoteApp />
          </I18nProvider>,
        );

        fireEvent.dragEnter(
          screen.getAllByPlaceholderText("Paste JSON / JSONL, or drop a file here.")[0]!,
          {
            dataTransfer: {
              files: [],
              items: [],
              types: ["Files"],
            },
          },
        );

        expect(screen.getByText("Release to parse")).toBeInTheDocument();
      });

      it("reads files pasted into the source input", async () => {
        render(
          <I18nProvider>
            <UnquoteApp />
          </I18nProvider>,
        );

        const sourceInput = screen.getAllByPlaceholderText(
          "Paste JSON / JSONL, or drop a file here.",
        )[0]!;
        const file = new File(['{"pasted":true}'], "payload.json", {
          type: "application/json",
        });

        fireEvent.paste(sourceInput, {
          clipboardData: {
            files: [file],
            items: [],
            types: ["Files"],
          },
        });

        await waitFor(() => expect(screen.getAllByText("pasted").length).toBeGreaterThan(0));
        await waitFor(() => expect(screen.getAllByText(/payload\.json/).length).toBeGreaterThan(0));
      });

      it("preserves filename text when clipboard read is unavailable", () => {
        render(
          <I18nProvider>
            <UnquoteApp />
          </I18nProvider>,
        );

        const sourceInput = screen.getAllByPlaceholderText(
          "Paste JSON / JSONL, or drop a file here.",
        )[0]!;
        const dispatched = fireEvent.paste(sourceInput, {
          clipboardData: {
            files: [],
            items: [],
            types: ["text/plain"],
            getData: () => "payload.json",
          },
        });

        expect(dispatched).toBe(true);
      });

      it("preserves filename text when clipboard read finds no file", async () => {
        const read = vi.fn().mockResolvedValue([]);
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: { read, writeText: vi.fn() },
        });
        render(
          <I18nProvider>
            <UnquoteApp />
          </I18nProvider>,
        );

        const sourceInput = screen.getAllByPlaceholderText(
          "Paste JSON / JSONL, or drop a file here.",
        )[0]!;
        const dispatched = fireEvent.paste(sourceInput, {
          clipboardData: {
            files: [],
            items: [],
            types: ["text/plain"],
            getData: () => "payload.json",
          },
        });

        expect(dispatched).toBe(true);
        await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
      });

      it("preserves filename text when clipboard permission is denied", async () => {
        const read = vi.fn().mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: { read, writeText: vi.fn() },
        });
        render(
          <I18nProvider>
            <UnquoteApp />
          </I18nProvider>,
        );

        const sourceInput = screen.getAllByPlaceholderText(
          "Paste JSON / JSONL, or drop a file here.",
        )[0]!;
        const dispatched = fireEvent.paste(sourceInput, {
          clipboardData: {
            files: [],
            items: [],
            types: ["text/plain"],
            getData: () => "payload.json",
          },
        });

        expect(dispatched).toBe(true);
        await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
      });

      it("keeps the previous source published while a dropped file is being read", async () => {
        const user = userEvent.setup();
        const controlled = createControlledStreamFile('{"new":true}', "payload.json");
        render(
          <I18nProvider>
            <UnquoteApp initialInput={'{"old":true}'} />
          </I18nProvider>,
        );
        await waitFor(() => expect(screen.getAllByText("old").length).toBeGreaterThan(0));

        await pasteFileIntoImport(user, controlled.file);

        // While reading, the reading state carries the previous published Source so
        // the prior workspace stays on screen instead of blanking.
        await waitFor(() => expect(controlled.stream).toHaveBeenCalledTimes(1));
        expect(screen.getAllByText("old").length).toBeGreaterThan(0);

        await act(async () => {
          controlled.complete();
        });
        await waitFor(() => expect(screen.getAllByText("new").length).toBeGreaterThan(0));
        await waitFor(() => expect(screen.getAllByText(/payload\.json/).length).toBeGreaterThan(0));
      });

      it("surfaces an error toast and restores the prior Source when a file read fails", async () => {
        const user = userEvent.setup();
        const failure = createFailingStreamFile(new Error("boom"), "payload.json");
        render(
          <I18nProvider>
            <UnquoteApp initialInput={'{"old":true}'} />
          </I18nProvider>,
        );
        await waitFor(() => expect(screen.getAllByText("old").length).toBeGreaterThan(0));

        await pasteFileIntoImport(user, failure.file);

        // The read rejects: an error toast surfaces (the hook no longer rethrows, so
        // there is no unhandled rejection) and the prior Source stays published.
        await waitFor(() => expect(failure.stream).toHaveBeenCalledTimes(1));
        expect((await screen.findAllByText("Failed to read file")).length).toBeGreaterThan(0);
        await waitFor(() => expect(screen.getAllByText("old").length).toBeGreaterThan(0));
      });

      it("ignores a read failure after a newer file import succeeds", async () => {
        const user = userEvent.setup();
        const toastError = vi.spyOn(toast, "error");
        const stale = createControlledStreamFile("a", "a.json");
        const current = createControlledStreamFile('{"current":true}', "b.json");
        render(
          <I18nProvider>
            <UnquoteApp initialInput={'{"old":true}'} />
          </I18nProvider>,
        );

        await pasteFileIntoImport(user, stale.file);
        await pasteFileIntoImport(user, current.file);
        await waitFor(() => {
          expect(stale.stream).toHaveBeenCalledTimes(1);
          expect(current.stream).toHaveBeenCalledTimes(1);
        });

        await act(async () => current.complete());
        await waitFor(() => expect(screen.getAllByText("current").length).toBeGreaterThan(0));
        await act(async () => stale.fail(new Error("stale failure")));

        expect(screen.getAllByText("current").length).toBeGreaterThan(0);
        expect(toastError).not.toHaveBeenCalled();
        expect(screen.queryByText("Failed to read file")).not.toBeInTheDocument();
      });

      it("ends streamed file parsing and reports a worker read failure once", async () => {
        const { container } = render(
          <I18nProvider>
            <UnquoteApp />
          </I18nProvider>,
        );
        const sourceInput = screen.getAllByPlaceholderText(
          "Paste JSON / JSONL, or drop a file here.",
        )[0]!;
        const failureLine = '{"event":"worker-failure"}\n';
        const file = new File(
          [failureLine.repeat(Math.ceil(1_000_001 / failureLine.length))],
          "worker-failure.jsonl",
          {
            type: "application/jsonl",
          },
        );

        fireEvent.paste(sourceInput, {
          clipboardData: { files: [file], items: [], types: ["Files"] },
        });

        const shell = container.querySelector<HTMLElement>(".uq-shell")!;
        await waitFor(() => expect(screen.getAllByText("Failed to read file")).toHaveLength(1));
        expect(shell).toHaveAttribute("data-parse-state", "complete");
      });

      it("searches full string content in streamed JSONL files", async () => {
        const user = userEvent.setup();
        const { container } = render(
          <I18nProvider>
            <UnquoteApp />
          </I18nProvider>,
        );

        const sourceInput = screen.getAllByPlaceholderText(
          "Paste JSON / JSONL, or drop a file here.",
        )[0]!;
        const longValue = `${"a".repeat(maxTransferStringLength + 32)}needle${"b".repeat(1_000_000)}`;
        const fileContents = [
          JSON.stringify({ event: "probe-start" }),
          JSON.stringify({ event: "probe-confirm" }),
          JSON.stringify({ message: longValue }),
        ].join("\n");
        const file = new File([fileContents], "payload.jsonl", {
          type: "application/jsonl",
        });
        const streamSpy = vi.fn(
          () =>
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode(fileContents));
                controller.close();
              },
            }),
        );
        Object.defineProperty(file, "stream", {
          configurable: true,
          value: streamSpy,
        });

        fireEvent.paste(sourceInput, {
          clipboardData: {
            files: [file],
            items: [],
            types: ["Files"],
          },
        });

        await waitFor(() => expect(screen.getAllByText("#1").length).toBeGreaterThan(0));
        const shell = container.querySelector<HTMLElement>(".uq-shell")!;
        await waitFor(() => expect(shell).toHaveAttribute("data-source-file", "payload.jsonl"));
        expect(shell).toHaveAttribute("data-parse-state", "complete");

        await user.type(getToolbarInput(), "needle{Enter}");
        const streamReadsBeforeSearch = streamSpy.mock.calls.length;

        await waitFor(() => expect(shell).toHaveAttribute("data-search-query", "needle"));
        await waitFor(() =>
          expect(streamSpy.mock.calls.length).toBeGreaterThan(streamReadsBeforeSearch),
        );
        await waitFor(() => expect(shell).toHaveAttribute("data-search-state", "complete"));
        await waitFor(() =>
          expect(
            screen.getAllByText((text) => text.includes("1/1") || /1\s+matches/i.test(text)).length,
          ).toBeGreaterThan(0),
        );
      });

      it("switches a large file between streamed JSONL and loaded JSON semantics", async () => {
        const user = userEvent.setup();
        const { container } = render(
          <I18nProvider>
            <UnquoteApp />
          </I18nProvider>,
        );
        const line = `${JSON.stringify({ value: 1 })}\n`;
        const file = new File([line.repeat(Math.ceil(1_000_001 / line.length))], "large.jsonl");

        fireEvent.paste(
          screen.getAllByPlaceholderText("Paste JSON / JSONL, or drop a file here.")[0]!,
          {
            clipboardData: { files: [file], items: [], types: ["Files"] },
          },
        );
        await waitFor(() =>
          expect(container.querySelector(".uq-shell")).toHaveAttribute(
            "data-source-file",
            "large.jsonl",
          ),
        );

        await setInputFormat(user, "JSON");

        await waitFor(() =>
          expect(container.querySelector(".uq-shell")).toHaveAttribute("data-source-file", ""),
        );
        await waitFor(() =>
          expect(container.querySelector(".uq-shell")).toHaveAttribute(
            "data-parse-state",
            "complete",
          ),
        );

        await setInputFormat(user, "JSONL");

        await waitFor(() =>
          expect(container.querySelector(".uq-shell")).toHaveAttribute(
            "data-source-file",
            "large.jsonl",
          ),
        );
      });
    });

    registerGroup("search", () => {
      it("counts and cycles search matches in the toolbar", async () => {
        const user = userEvent.setup();
        const input = ['{"msg":"alpha"}', '{"msg":"alpha"}', '{"msg":"beta"}'].join("\n");
        render(
          <I18nProvider>
            <UnquoteApp initialInput={input} />
          </I18nProvider>,
        );
        await waitFor(() => expect(screen.getAllByText("#1").length).toBeGreaterThan(0));

        await user.type(getToolbarInput(), "alpha");
        // Search mode shows a "current/total" match counter (e.g. 1/2).
        await waitFor(() =>
          expect(screen.getAllByText((text) => text.includes("1/2")).length).toBeGreaterThan(0),
        );

        // Next match advances the counter to 2/2, prev wraps back to 1/2.
        const inputs = screen.getAllByPlaceholderText(commandInputPlaceholder);
        const nextButtons = screen.getAllByRole("button", { name: /Next match/i });
        await user.click(nextButtons[0]!);
        await waitFor(() =>
          expect(screen.getAllByText((text) => text.includes("2/2")).length).toBeGreaterThan(0),
        );
        await user.click(screen.getAllByRole("button", { name: /Previous match/i })[0]!);
        await waitFor(() =>
          expect(screen.getAllByText((text) => text.includes("1/2")).length).toBeGreaterThan(0),
        );
        void inputs;
      });

      it("loads a missing search window for forward and backward navigation", async () => {
        const user = userEvent.setup();
        setInitialSearchWindowIndexes(Float64Array.from([0]));
        const input = Array.from({ length: 3 }, (_, index) =>
          JSON.stringify({ index, msg: "needle" }),
        ).join("\n");
        render(
          <I18nProvider>
            <UnquoteApp initialInput={input} />
          </I18nProvider>,
        );
        await waitFor(() => expect(screen.getAllByText("#1").length).toBeGreaterThan(0));
        await user.type(getToolbarInput(), "needle");
        await waitFor(() =>
          expect(screen.getAllByText((text) => text.includes("1/3")).length).toBeGreaterThan(0),
        );

        await user.click(screen.getAllByRole("button", { name: /Next match/i })[0]!);
        await waitFor(() => expect(railItem(2)).toHaveAttribute("aria-current", "true"));
        expect(screen.getAllByText((text) => text.includes("2/3")).length).toBeGreaterThan(0);

        await user.click(screen.getAllByRole("button", { name: /Previous match/i })[0]!);
        await waitFor(() => expect(railItem(1)).toHaveAttribute("aria-current", "true"));
      });

      it("follows a search match into a record the workspace was not showing", async () => {
        const user = userEvent.setup();
        const input = ['{"msg":"alpha"}', '{"msg":"beta"}', '{"msg":"needle"}'].join("\n");
        render(
          <I18nProvider>
            <UnquoteApp initialInput={input} />
          </I18nProvider>,
        );
        await waitFor(() => expect(screen.getAllByText("#1").length).toBeGreaterThan(0));
        expect(railItem(1)).toHaveAttribute("aria-current", "true");

        await user.type(getToolbarInput(), "needle");

        // One record is on screen at a time, so the match has to move both the rail
        // selection and the centre tree or the previous/next buttons silently do nothing.
        await waitFor(() => expect(railItem(3)).toHaveAttribute("aria-current", "true"));
        expect(document.getElementById("record-3")).toBeInTheDocument();
        expect(document.getElementById("record-1")).not.toBeInTheDocument();
      });

      it("completes an in-memory search through the search worker", async () => {
        const user = userEvent.setup();
        const input = ['{"msg":"alpha"}', '{"msg":"beta"}'].join("\n");
        const { container } = render(
          <I18nProvider>
            <UnquoteApp initialInput={input} />
          </I18nProvider>,
        );
        await waitFor(() => expect(screen.getAllByText("#1").length).toBeGreaterThan(0));

        const shell = container.querySelector<HTMLElement>(".uq-shell")!;
        await user.type(getToolbarInput(), "alpha");

        await waitFor(() => expect(shell).toHaveAttribute("data-search-state", "complete"));
        expect(screen.getAllByText((text) => text.includes("1/1")).length).toBeGreaterThan(0);
      });

      it("shows a search timeout message and recovers once the worker responds to a later query", async () => {
        const input = ['{"msg":"alpha"}', '{"msg":"beta"}'].join("\n");
        const { container } = render(
          <I18nProvider>
            <UnquoteApp initialInput={input} />
          </I18nProvider>,
        );
        await waitFor(() => expect(screen.getAllByText("#1").length).toBeGreaterThan(0));

        const shell = container.querySelector<HTMLElement>(".uq-shell")!;
        const workerProto = (
          globalThis.Worker as unknown as {
            prototype: { completeSearch: (...args: unknown[]) => void };
          }
        ).prototype;
        const silence = vi.spyOn(workerProto, "completeSearch").mockImplementation(() => {});

        vi.useFakeTimers();
        try {
          fireEvent.change(getToolbarInput(), { target: { value: "alpha" } });
          await act(() =>
            vi.advanceTimersByTimeAsync(memorySearchDebounceMs + searchWorkerTimeoutMs),
          );
        } finally {
          vi.useRealTimers();
        }

        expect(shell).toHaveAttribute("data-search-state", "error");
        expect(screen.getAllByText("Search timed out").length).toBeGreaterThan(0);

        silence.mockRestore();
        fireEvent.change(getToolbarInput(), { target: { value: "beta" } });
        await waitFor(() => expect(shell).toHaveAttribute("data-search-state", "complete"));
        expect(screen.getAllByText((text) => text.includes("1/1")).length).toBeGreaterThan(0);
      });

      it("routes path-like queries to path mode and reports path match counts", async () => {
        const user = userEvent.setup();
        const input = ['{"payload":{"items":[1,2]}}', '{"payload":{"items":[3,4]}}'].join("\n");
        render(
          <I18nProvider>
            <UnquoteApp initialInput={input} />
          </I18nProvider>,
        );
        await waitFor(() => expect(screen.getAllByText("#1").length).toBeGreaterThan(0));

        // A path-like query jumps to the matched node(s).
        await user.type(getToolbarInput(), "$.payload");
        fireEvent.keyDown(getToolbarInput(), { key: "Enter" });

        // The command palette advertises path vs search mode; opening it reflects the
        // path-like input. (The badge text is the durable, localized signal.)
        await user.click(screen.getAllByRole("button", { name: /Commands/i })[0]!);
        await waitFor(() => expect(screen.getAllByText(/path/i).length).toBeGreaterThan(0));
      });

      it("enforces jq / regex mutual exclusion from the command palette", async () => {
        const user = userEvent.setup();
        render(
          <I18nProvider>
            <UnquoteApp initialInput={'{"payload":1}'} />
          </I18nProvider>,
        );

        await user.click(screen.getAllByRole("button", { name: /Commands/i })[0]!);
        // Enable regex, then jq — jq must turn regex off.
        const regexButton = screen.getByRole("button", { name: /^Regex$/i });
        expect(regexButton).toHaveAttribute("aria-pressed", "false");
        await user.click(regexButton);
        expect(regexButton).toHaveAttribute("aria-pressed", "true");

        const jqButton = screen.getByRole("button", { name: /jq syntax/i });
        await user.click(jqButton);
        // jq is now active, regex is not — the mutex held.
        expect(jqButton).toHaveAttribute("aria-pressed", "true");
        expect(regexButton).toHaveAttribute("aria-pressed", "false");
      });

      it("clears matches and resets to the all-records summary", async () => {
        const user = userEvent.setup();
        const input = ['{"msg":"alpha"}', '{"msg":"beta"}'].join("\n");
        render(
          <I18nProvider>
            <UnquoteApp initialInput={input} />
          </I18nProvider>,
        );
        await waitFor(() => expect(screen.getAllByText("#1").length).toBeGreaterThan(0));

        await user.type(getToolbarInput(), "alpha");
        await waitFor(() =>
          expect(screen.getAllByText((text) => text.includes("1/1")).length).toBeGreaterThan(0),
        );

        await user.click(screen.getAllByRole("button", { name: /Clear search/i })[0]!);
        // After clearing, the match counter is gone and the input is empty.
        await waitFor(() => expect((getToolbarInput() as HTMLInputElement).value).toBe(""));
        expect(screen.queryAllByText((text) => text.includes("1/1"))).toHaveLength(0);
      });
    });

    registerGroup("expansion", () => {
      it("Collapse All reverses Expand All for stringified JSON", async () => {
        const user = userEvent.setup();
        const input = '{"level":"info","payload":"{\\"nested\\":true}"}';
        render(
          <I18nProvider>
            <UnquoteApp initialInput={input} />
          </I18nProvider>,
        );
        await waitFor(() => expect(screen.getAllByText("payload").length).toBeGreaterThan(0));

        // Stringified payload is collapsed by default — the inner `nested` key is absent.
        expect(screen.queryAllByText("nested")).toHaveLength(0);

        // Both controls are always present; Collapse All stays disabled until
        // something is actually expanded.
        expect(screen.getByRole("button", { name: "Collapse All" })).toBeDisabled();
        await user.click(screen.getByRole("button", { name: "Expand All" }));
        await waitFor(() => expect(screen.getAllByText("nested").length).toBeGreaterThan(0));

        const collapseAll = screen.getByRole("button", { name: "Collapse All" });
        expect(collapseAll).toBeEnabled();
        await user.click(collapseAll);
        await waitFor(() => expect(screen.queryAllByText("nested")).toHaveLength(0));
      });

      it("Expand All reaches nested JSON in a local-file Preview Record", async () => {
        const user = userEvent.setup();
        // Only a .jsonl file above largeSourceCollapseBytes takes the streamed
        // file-source path that produces Preview Records, so pad past 1MB with
        // filler lines while keeping the record under test first and eager.
        const filler = `${JSON.stringify({ filler: "x".repeat(60_000) })}\n`;
        const fileContents = `${JSON.stringify({
          level: "info",
          payload: JSON.stringify({ nested: true }),
        })}\n${filler.repeat(20)}`;
        const file = new File([fileContents], "preview.jsonl", { type: "application/jsonl" });
        expect(file.size).toBeGreaterThan(1_000_000);
        const { container } = render(
          <I18nProvider>
            <UnquoteApp />
          </I18nProvider>,
        );

        fireEvent.paste(
          screen.getAllByPlaceholderText("Paste JSON / JSONL, or drop a file here.")[0]!,
          {
            clipboardData: { files: [file], items: [], types: ["Files"] },
          },
        );

        const shell = container.querySelector<HTMLElement>(".uq-shell")!;
        await waitFor(() => expect(shell).toHaveAttribute("data-source-file", "preview.jsonl"));
        await waitFor(() => expect(screen.getAllByText("payload").length).toBeGreaterThan(0));
        expect(screen.queryAllByText("nested")).toHaveLength(0);

        // A Preview Record's projected node has no children, so this only works
        // if the expansion is collected from the record's preview.
        await user.click(screen.getByRole("button", { name: "Expand All" }));

        await waitFor(() =>
          expect(screen.getByRole("button", { name: "Collapse All" })).toBeEnabled(),
        );
        await waitFor(() => expect(screen.getAllByText("nested").length).toBeGreaterThan(0));
      });

      it("Expand All reaches nested JSON below a container in a Full Record", async () => {
        const user = userEvent.setup();
        // A Preview Record only records top-level fields, so `$.meta.payload` is
        // invisible to it — this path can only be expanded from the Full Record
        // tree. Same padding requirement as the test above.
        const filler = `${JSON.stringify({ filler: "x".repeat(60_000) })}\n`;
        const fileContents = `${JSON.stringify({
          meta: { payload: JSON.stringify({ buried: true }) },
        })}\n${filler.repeat(20)}`;
        const file = new File([fileContents], "buried.jsonl", { type: "application/jsonl" });
        const { container } = render(
          <I18nProvider>
            <UnquoteApp />
          </I18nProvider>,
        );

        fireEvent.paste(
          screen.getAllByPlaceholderText("Paste JSON / JSONL, or drop a file here.")[0]!,
          {
            clipboardData: { files: [file], items: [], types: ["Files"] },
          },
        );

        const shell = container.querySelector<HTMLElement>(".uq-shell")!;
        await waitFor(() => expect(shell).toHaveAttribute("data-source-file", "buried.jsonl"));
        await waitFor(() => expect(screen.getAllByText("meta").length).toBeGreaterThan(0));
        expect(screen.queryByText(/max depth/)).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Top-level nested" })).toBeInTheDocument();
        expect(
          await screen.findByText("This record contains stringified JSON"),
        ).toBeInTheDocument();
        expect(screen.queryAllByText("buried")).toHaveLength(0);

        await user.click(screen.getByRole("button", { name: "Expand All" }));

        await waitFor(() => expect(screen.getAllByText("buried").length).toBeGreaterThan(0));
      });

      it("Expand All opens every level of nested stringified JSON in one click", async () => {
        const user = userEvent.setup();
        // Expand All is not a per-level step: one click has to reach all the way
        // down through every stringified layer.
        const input = JSON.stringify({
          payload: JSON.stringify({ inner: JSON.stringify({ deep: 1 }) }),
        });
        render(
          <I18nProvider>
            <UnquoteApp initialInput={input} />
          </I18nProvider>,
        );
        await waitFor(() => expect(screen.getAllByText("payload").length).toBeGreaterThan(0));
        expect(screen.queryAllByText("deep")).toHaveLength(0);

        await user.click(screen.getByRole("button", { name: "Expand All" }));

        await waitFor(() => expect(screen.getAllByText("deep").length).toBeGreaterThan(0));

        await user.click(await screen.findByRole("button", { name: "Collapse All" }));
        await waitFor(() => expect(screen.queryAllByText("inner")).toHaveLength(0));
      });

      it("keeps stringified expansion within its JSONL record", async () => {
        const user = userEvent.setup();
        const input = [
          '{"payload":"{\\"nested\\":\\"first\\"}"}',
          '{"payload":"{\\"nested\\":\\"second\\"}"}',
        ].join("\n");
        render(
          <I18nProvider>
            <UnquoteApp initialInput={input} />
          </I18nProvider>,
        );

        await waitFor(() => expect(document.getElementById("record-1")).toBeInTheDocument());

        await user.click(
          within(document.getElementById("record-1")!)
            .getByRole("treeitem", { name: /payload/ })
            .querySelector("[data-tree-toggle]")!,
        );

        await waitFor(() =>
          expect(
            within(document.getElementById("record-1")!).getByText("nested"),
          ).toBeInTheDocument(),
        );

        // Switching the rail to record 2 shows its own, still-collapsed payload.
        await selectRailRecord(user, 2);
        expect(
          within(document.getElementById("record-2")!).queryByText("nested"),
        ).not.toBeInTheDocument();
      });

      it("expands stringified paths only in JSONL records matching search", async () => {
        const user = userEvent.setup();
        const input = [
          '{"payload":"{\\"nested\\":\\"target-only\\"}"}',
          '{"payload":"{\\"nested\\":\\"other-only\\"}"}',
        ].join("\n");
        render(
          <I18nProvider>
            <UnquoteApp initialInput={input} />
          </I18nProvider>,
        );

        await waitFor(() => expect(document.getElementById("record-1")).toBeInTheDocument());

        await user.type(getToolbarInput(), "target-only");

        await waitFor(() =>
          expect(
            within(document.getElementById("record-1")!).getByText("nested"),
          ).toBeInTheDocument(),
        );

        await selectRailRecord(user, 2);
        expect(
          within(document.getElementById("record-2")!).queryByText("nested"),
        ).not.toBeInTheDocument();
      });

      it("collapses only the record on screen", async () => {
        const user = userEvent.setup();
        const input = [
          '{"kind":"target","payload":"{\\"nested\\":\\"first\\"}"}',
          '{"kind":"other","payload":"{\\"nested\\":\\"second\\"}"}',
        ].join("\n");
        render(
          <I18nProvider>
            <UnquoteApp initialInput={input} />
          </I18nProvider>,
        );

        await waitFor(() => expect(document.getElementById("record-1")).toBeInTheDocument());

        await user.click(screen.getByRole("button", { name: "Expand All" }));
        await waitFor(() =>
          expect(
            within(document.getElementById("record-1")!).getByText("nested"),
          ).toBeInTheDocument(),
        );

        await selectRailRecord(user, 2);
        await user.click(screen.getByRole("button", { name: "Expand All" }));
        await waitFor(() =>
          expect(
            within(document.getElementById("record-2")!).getByText("nested"),
          ).toBeInTheDocument(),
        );

        // Collapse All is scoped to the active record: record 1 keeps its expansion.
        await user.click(screen.getByRole("button", { name: "Collapse All" }));
        await waitFor(() => expect(screen.queryAllByText("nested")).toHaveLength(0));

        await selectRailRecord(user, 1);
        expect(
          within(document.getElementById("record-1")!).getByText("nested"),
        ).toBeInTheDocument();
      });

      it("resets expansion when the source changes", async () => {
        const user = userEvent.setup();
        render(
          <I18nProvider>
            <UnquoteApp initialInput={'{"payload":"{\\"first\\":true}"}'} />
          </I18nProvider>,
        );

        await waitFor(() => expect(document.getElementById("record-1")).toBeInTheDocument());
        await user.click(
          within(document.getElementById("record-1")!)
            .getByRole("treeitem", { name: /payload/ })
            .querySelector("[data-tree-toggle]")!,
        );
        await waitFor(() => expect(screen.getAllByText("first")).toHaveLength(1));

        await replaceSource(user, '{"payload":"{\\"second\\":true}"}');

        await waitFor(() => expect(screen.getAllByText("payload")).toHaveLength(1));
        expect(screen.queryByText("second")).not.toBeInTheDocument();
      });

      it("resets query state when the source revision changes", async () => {
        const user = userEvent.setup();
        const { container } = render(
          <I18nProvider>
            <UnquoteApp initialInput={'{"message":"first"}'} />
          </I18nProvider>,
        );

        await user.type(getToolbarInput(), "first");
        await waitFor(() =>
          expect(container.querySelector("[data-search-query]")).toHaveAttribute(
            "data-search-query",
            "first",
          ),
        );

        await replaceSource(user, '{"message":"second"}');

        await waitFor(() => expect(getToolbarInput()).toHaveValue(""));
        expect(container.querySelector("[data-search-query]")).toHaveAttribute(
          "data-search-query",
          "",
        );
      });

      it("rebuilds the displayed record's rows exactly once per toggle", async () => {
        const user = userEvent.setup();
        const input = [
          '{"payload":"{\\"nested\\":\\"first\\"}"}',
          '{"payload":"{\\"nested\\":\\"second\\"}"}',
          '{"payload":"{\\"nested\\":\\"third\\"}"}',
        ].join("\n");
        render(
          <I18nProvider>
            <UnquoteApp initialInput={input} />
          </I18nProvider>,
        );

        // Three records in the rail, one record's tree on screen: only that one
        // may cost a row build.
        await waitFor(() => expect(screen.getAllByText("#3").length).toBeGreaterThan(0));
        expect(document.getElementById("record-1")).toBeInTheDocument();

        performance.clearMeasures("unquote:recordRows:build");
        await user.click(
          within(document.getElementById("record-1")!)
            .getByRole("treeitem", { name: /payload/ })
            .querySelector("[data-tree-toggle]")!,
        );
        await waitFor(() =>
          expect(
            within(document.getElementById("record-1")!).getByText("nested"),
          ).toBeInTheDocument(),
        );

        expect(performance.getEntriesByName("unquote:recordRows:build")).toHaveLength(1);
      });
    });
  });
};
