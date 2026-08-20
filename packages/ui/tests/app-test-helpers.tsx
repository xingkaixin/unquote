import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";
import { UnquoteApp } from "../src/app";
import { I18nProvider, useTranslation } from "../src/i18n/context";
// Installs the app Worker mock and resets DOM, globals, and storage after every test.
import "./helpers/app-worker";

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

export {
  maxTransferStringLength,
  commandInputPlaceholder,
  inputFormatLabel,
  useDesktopViewport,
  LocaleProbe,
  codexRolloutSource,
  getToolbarInput,
  readBlobText,
  renderCodexAgentView,
  renderClaudeAgentView,
  sourceButton,
  setInputFormat,
  pasteFileIntoImport,
  railRow,
  railItem,
  selectRailRecord,
  replaceSource,
  renderFilterableJsonl,
};
