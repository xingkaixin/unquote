import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parsePreviewJsonlRecordLine } from "@unquote/core";
import type { JsonlRecord, ParseResult } from "@unquote/core";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnquoteApp } from "../src/app";
import { memorySearchDebounceMs } from "../src/hooks/use-query-interaction";
import { searchWorkerTimeoutMs } from "../src/hooks/use-search-worker";
import { isCopyAboveThreshold } from "../src/lib/record-export";
import { I18nProvider, useTranslation } from "../src/i18n/context";

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
  return <button onClick={() => setLocale("zh-CN")}>{t("input.title")}</button>;
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

const getToolbarInput = () => {
  const inputs = screen.getAllByPlaceholderText(commandInputPlaceholder);
  return inputs[1] ?? inputs[0]!;
};

// Mirrors parser-worker.ts's compactForTransfer branch: the worker builds
// Preview Records straight from the source lines via core, so this mock must
// too. Re-deriving the projection here once let the mock drift from the real
// Preview shape (children retained, no preview marker), which hid UQ-120.
const compactResultForTransfer = (input: string, stats: ParseResult["stats"]): ParseResult => {
  const records: JsonlRecord[] = [];
  input.split(/\r?\n/).forEach((line, index) => {
    if (line.trim()) {
      records.push(parsePreviewJsonlRecordLine(line, index + 1));
    }
  });

  return { format: "jsonl", records, stats };
};

const readMockFileText = (file: File) => {
  if (typeof file.text === "function") {
    return file.text();
  }

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsText(file);
  });
};

const readBlobText = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob"));
    reader.readAsText(blob);
  });

Object.assign(globalThis, {
  Worker: class {
    chunks = "";
    isSearchWorker: boolean;
    searchSource: {
      sourceRevision: number;
      text: string;
      forcedFormat?: "json" | "jsonl";
    } | null = null;
    constructor(...args: unknown[]) {
      this.isSearchWorker = String(args[0]).includes("search-worker");
    }
    onmessage: ((event: MessageEvent) => void) | null = null;
    addEventListener(_type: string, listener: (event: MessageEvent) => void) {
      this.onmessage = listener;
    }
    removeEventListener() {}
    terminate() {
      this.onmessage = null;
    }
    completeSearch(
      requestId: number,
      text: string,
      forcedFormat: "json" | "jsonl" | undefined,
      query: string,
      options: unknown,
    ) {
      Promise.all([import("../src/lib/parse-text"), import("../src/lib/record-search")]).then(
        ([{ parseTextResult }, { searchRecords }]) => {
          const parsed = parseTextResult(text, forcedFormat);
          const matches = searchRecords(
            parsed.records,
            query,
            options as { regex: boolean; caseSensitive: boolean; jq: boolean },
          );
          this.onmessage?.({
            data: { type: "result", requestId, matches },
          } as MessageEvent);
        },
      );
    }
    completeSearchFile(requestId: number, file: File, query: string, options: unknown) {
      import("../src/lib/local-file-source").then(({ createLocalFileAccess }) => {
        createLocalFileAccess(file)
          .search(
            query,
            options as { regex: boolean; caseSensitive: boolean; jq: boolean },
            new AbortController().signal,
          )
          .then((matches) => {
            this.onmessage?.({
              data: { type: "result", requestId, matches },
            } as MessageEvent);
          })
          .catch(() => {
            this.onmessage?.({
              data: { type: "error", requestId, message: "search failed" },
            } as MessageEvent);
          });
      });
    }
    complete(requestId: number, input: string, forcedFormat?: "json" | "jsonl", compact = false) {
      import("../src/lib/parse-text").then(({ parseText }) => {
        const parsed = parseText(input, { forcedFormat });
        const result = compact
          ? compactResultForTransfer(input, parsed.result.stats)
          : parsed.result;
        this.onmessage?.({
          data: {
            type: "complete-result",
            requestId,
            result,
            agentSession: parsed.agentSession,
            progress: parsed.progress,
          },
        } as MessageEvent);
      });
    }
    postMessage(payload: {
      type?: "parse" | "start-jsonl" | "jsonl-chunk" | "file-jsonl" | "search-text" | "search-file";
      requestId: number;
      input?: string;
      forcedFormat?: "json" | "jsonl";
      chunk?: string;
      done?: boolean;
      file?: File;
      source?:
        | {
            kind: "content";
            sourceRevision: number;
            text: string;
            forcedFormat?: "json" | "jsonl";
          }
        | { kind: "cached"; sourceRevision: number };
      query?: string;
      options?: unknown;
    }) {
      if (payload.type === "search-text") {
        if (!this.isSearchWorker || !payload.source) {
          return;
        }
        if (payload.source.kind === "content") {
          this.searchSource = {
            sourceRevision: payload.source.sourceRevision,
            text: payload.source.text,
            ...(payload.source.forcedFormat ? { forcedFormat: payload.source.forcedFormat } : {}),
          };
        }
        if (this.searchSource?.sourceRevision !== payload.source.sourceRevision) {
          this.onmessage?.({
            data: { type: "error", requestId: payload.requestId, message: "search failed" },
          } as MessageEvent);
          return;
        }
        this.completeSearch(
          payload.requestId,
          this.searchSource.text,
          this.searchSource.forcedFormat,
          payload.query ?? "",
          payload.options,
        );
        return;
      }

      if (payload.type === "search-file") {
        if (!this.isSearchWorker || !payload.file) {
          return;
        }
        this.completeSearchFile(
          payload.requestId,
          payload.file,
          payload.query ?? "",
          payload.options,
        );
        return;
      }

      if (this.isSearchWorker) {
        return;
      }

      if (payload.type === "start-jsonl") {
        this.chunks = "";
        return;
      }

      if (payload.type === "jsonl-chunk") {
        this.chunks += payload.chunk ?? "";
        if (payload.done) {
          this.complete(payload.requestId, this.chunks, "jsonl");
        }
        return;
      }

      if (payload.type === "file-jsonl") {
        if (payload.file) {
          if (payload.file.name === "worker-failure.jsonl") {
            this.onmessage?.({
              data: {
                type: "error",
                requestId: payload.requestId,
                stats: { total: 0, success: 0, failed: 0 },
                progress: {
                  processedLines: 0,
                  success: 0,
                  failed: 0,
                  elapsedMs: 1,
                  done: true,
                },
              },
            } as MessageEvent);
            return;
          }
          void readMockFileText(payload.file).then((text) =>
            this.complete(payload.requestId, text, "jsonl", true),
          );
        }
        return;
      }

      this.complete(payload.requestId, payload.input ?? "", payload.forcedFormat);
    }
  },
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.mocked(window.matchMedia).mockImplementation(defaultMatchMedia);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn() },
  });
  localStorage.clear();
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
  return user;
};

const filterableJsonlInput = [
  '{"level":"info","payload":"{\\"nested\\":true}"}',
  '{"level":"error","message":"boom"}',
  "not-json",
].join("\n");

const renderFilterableJsonl = async () => {
  useDesktopViewport();
  render(
    <I18nProvider>
      <UnquoteApp initialInput={filterableJsonlInput} />
    </I18nProvider>,
  );

  fireEvent.change(screen.getAllByLabelText(inputFormatLabel)[0]!, {
    target: { value: "jsonl" },
  });
  await waitFor(() => expect(screen.getAllByText("#3").length).toBeGreaterThan(0));
};

describe("UnquoteApp", () => {
  it("mounts one mobile workspace pane at a time", async () => {
    const user = userEvent.setup();
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
    expect(main).toHaveClass("scroll-mt-[52px]");

    expect(screen.getAllByRole("textbox", { name: "Source input" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Collapse source" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Search or jump" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Output" }));

    await waitFor(() => expect(document.querySelectorAll("#record-1")).toHaveLength(1));
    expect(screen.queryByRole("textbox", { name: "Source input" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("textbox", { name: "Search or jump" })).toHaveLength(1);
  });

  it("mounts one desktop source and output tree", async () => {
    const user = userEvent.setup();
    useDesktopViewport();
    render(
      <I18nProvider>
        <UnquoteApp initialInput='{"ok":true}' />
      </I18nProvider>,
    );

    await waitFor(() => expect(document.querySelectorAll("#record-1")).toHaveLength(1));
    expect(screen.getAllByRole("textbox", { name: "Source input" })).toHaveLength(1);
    expect(screen.getAllByRole("textbox", { name: "Search or jump" })).toHaveLength(1);
    expect(screen.queryByRole("tab", { name: "Output" })).not.toBeInTheDocument();

    await user.type(getToolbarInput(), "x");
    expect(getToolbarInput().closest("form")).toHaveClass("h-[34px]");
    expect(screen.getByRole("button", { name: "Clear search" })).toHaveClass("size-7");
    expect(screen.getByRole("button", { name: "Previous match" })).toHaveClass("h-7", "w-7");
    expect(screen.getByRole("button", { name: "Next match" })).toHaveClass("h-7", "w-7");
    expect(screen.getByRole("button", { name: "Commands" })).toHaveClass("h-7");
    expect(screen.getByRole("button", { name: "Expand All" })).toHaveClass("h-7");
    expect(screen.getByRole("button", { name: "More actions" })).toHaveClass("h-7", "w-7");

    await user.click(screen.getByRole("button", { name: "Collapse source" }));

    expect(screen.queryByRole("textbox", { name: "Source input" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("textbox", { name: "Search or jump" })).toHaveLength(1);
    expect(document.querySelectorAll("#record-1")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Expand source" })).toHaveClass("size-7");
  });

  it("exposes command options and restores focus when the palette closes", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <UnquoteApp />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("tab", { name: "Output" }));
    expect(getToolbarInput().closest("form")).toHaveClass("focus-within:outline-2");
    const trigger = screen.getAllByRole("button", { name: "Commands" })[0]!;
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Find, jump, and commands" });
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
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <UnquoteApp initialInput='{"payload":"{\\"ok\\":true}"}' />
      </I18nProvider>,
    );
    await user.click(screen.getByRole("tab", { name: "Output" }));
    await waitFor(() => expect(screen.getAllByText("#1").length).toBeGreaterThan(0));
    expect(screen.getAllByText("Expand All")[0]).toBeInTheDocument();
    expect(screen.getAllByPlaceholderText(commandInputPlaceholder)[0]).toBeInTheDocument();
  });

  it("renders a continuous heading hierarchy", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <UnquoteApp initialInput='{"value":1}' />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("tab", { name: "Output" }));
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
    expect(within(sampleGroup).getByRole("button", { name: "转义 API 响应" })).toBeInTheDocument();
    expect(
      within(sampleGroup).getByRole("button", { name: "Agent 工具调用 JSONL" }),
    ).toBeInTheDocument();
    expect(
      within(sampleGroup).getByRole("button", { name: "有效/无效混合 JSONL" }),
    ).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute("lang", "zh-CN");
    expect(screen.getAllByText("来源").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("option", { name: "自动" }).length).toBeGreaterThan(0);
  });

  it("updates document language and accessible copy when locale changes", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <LocaleProbe />
      </I18nProvider>,
    );

    expect(document.documentElement).toHaveAttribute("lang", "en");
    await user.click(screen.getByRole("button", { name: "Source" }));

    expect(document.documentElement).toHaveAttribute("lang", "zh-CN");
    expect(screen.getByRole("button", { name: "来源" })).toBeInTheDocument();
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

    const sourceInput = screen.getAllByPlaceholderText(
      "Paste JSON / JSONL, or drop a file here.",
    )[0]! as HTMLTextAreaElement;
    await waitFor(() => expect(sourceInput.value).toContain('"body"'));

    await user.click(screen.getByRole("tab", { name: "Output" }));
    await waitFor(() => expect(screen.getAllByText("body").length).toBeGreaterThan(0));
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
    await user.click(within(sampleGroup).getByRole("button", { name: "Agent tool-call JSONL" }));

    await user.click(screen.getByRole("tab", { name: "Output" }));
    await waitFor(() => expect(screen.getAllByText("#3").length).toBeGreaterThan(0));
    expect(screen.getAllByText(/tool_call/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("action").length).toBeGreaterThan(0);
    expect(screen.queryByText("nested json")).not.toBeInTheDocument();
    expect(screen.getAllByText("customerId").length).toBeGreaterThan(0);
  });

  it("shows the Agent view for Codex rollout logs", async () => {
    await renderCodexAgentView();

    expect(screen.getAllByText("Codex").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Timeline").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Conversation").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Tool call").length).toBeGreaterThan(0);
  });

  it("updates Agent timestamps across every surface when locale changes", async () => {
    const user = await renderCodexAgentView();
    const timestamp = Date.parse("2026-06-06T13:44:08.000Z");
    const formatTimestamp = (locale: "en" | "zh-CN") =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "medium",
      }).format(timestamp);

    await user.click(
      (await screen.findAllByRole("button", { name: /^Timeline: tool_use exec_command/ }))[0]!,
    );

    const rawJsonPanel = screen.getAllByRole("complementary", { name: "Raw JSONL" })[0]!;
    expect(screen.getAllByText(formatTimestamp("en"))).toHaveLength(2);
    expect(rawJsonPanel).toHaveTextContent(formatTimestamp("en"));

    await user.click(screen.getByRole("button", { name: "Change language" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "Chinese (Simplified)" }));

    expect(screen.getAllByText(formatTimestamp("zh-CN"))).toHaveLength(2);
    expect(rawJsonPanel).toHaveTextContent(formatTimestamp("zh-CN"));
    expect(screen.queryByText(formatTimestamp("en"))).not.toBeInTheDocument();
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

    await user.click(screen.getByRole("tab", { name: "Output" }));
    const timelineToolResult = (
      await screen.findAllByRole("button", {
        name: /^Timeline: tool_result/,
      })
    )[0]!;
    await user.click(timelineToolResult);

    const rawJsonPanel = (await screen.findAllByRole("complementary", { name: "Raw JSONL" }))[0]!;
    await waitFor(() =>
      expect(within(rawJsonPanel).getByText(new RegExp(fullValueMarker))).toBeInTheDocument(),
    );

    const copyRecordButton = within(rawJsonPanel)
      .getAllByRole("button")
      .find((button) => button.querySelector(".lucide-copy"));
    expect(copyRecordButton).toBeDefined();
    await user.click(copyRecordButton!);
    await waitFor(() =>
      expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining(fullValueMarker)),
    );
  });

  it("keeps Agent detail selection aligned across navigation sources", async () => {
    const user = await renderCodexAgentView();
    const timelineToolCalls = await screen.findAllByRole("button", {
      name: /^Timeline: tool_use exec_command/,
    });
    const timelineTaskStarted = screen.getAllByRole("button", {
      name: /^Timeline: task_started/,
    });
    const conversationToolCalls = screen.getAllByRole("button", {
      name: /^Conversation: Tool call/,
    });
    const getTocButton = (lineNumber: number) =>
      screen
        .getAllByText(`#${lineNumber}`)
        .map((node) => node.closest("button"))
        .find((button): button is HTMLButtonElement => Boolean(button))!;
    const tocLineTwo = getTocButton(2);
    const tocLineFour = getTocButton(4);
    const expectPressed = (buttons: HTMLElement[], pressed: boolean) => {
      for (const button of buttons) {
        expect(button).toHaveAttribute("aria-pressed", String(pressed));
      }
    };
    const expectSelection = async (recordId: string, selectedLine: 2 | 4) => {
      await waitFor(() =>
        expect(
          screen
            .getAllByRole("complementary", { name: "Raw JSONL" })
            .every((panel) => within(panel).queryByText(new RegExp(recordId))),
        ).toBe(true),
      );
      expect(tocLineTwo).toHaveAttribute("aria-pressed", String(selectedLine === 2));
      expect(tocLineFour).toHaveAttribute("aria-pressed", String(selectedLine === 4));
      expectPressed(timelineTaskStarted, selectedLine === 2);
      expectPressed(timelineToolCalls, selectedLine === 4);
      expectPressed(conversationToolCalls, selectedLine === 4);
    };

    await user.click(timelineToolCalls[0]!);
    await expectSelection("record-4", 4);
    const rawJsonPanel = screen.getAllByRole("complementary", { name: "Raw JSONL" })[0]!;
    expect(within(rawJsonPanel).getAllByText("call_id").length).toBeGreaterThan(0);
    expect(within(rawJsonPanel).getAllByText('"call_1"').length).toBeGreaterThan(0);
    await user.click(tocLineTwo);
    await expectSelection("record-2", 2);

    await user.click(conversationToolCalls[0]!);
    await expectSelection("record-4", 4);
  });

  it("reopens collapsed Agent raw data from a TOC selection", async () => {
    const user = await renderCodexAgentView();
    const tocLineTwo = screen
      .getAllByText("#2")
      .map((node) => node.closest("button"))
      .find((button): button is HTMLButtonElement => Boolean(button))!;

    await user.click(tocLineTwo);
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("complementary", { name: "Raw JSONL" })
          .every((panel) => within(panel).queryByText(/record-2/)),
      ).toBe(true),
    );

    for (const button of screen.getAllByRole("button", { name: "Collapse raw data" })) {
      await user.click(button);
    }
    expect(screen.queryAllByRole("complementary", { name: "Raw JSONL" })).toHaveLength(0);

    await user.click(tocLineTwo);
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("complementary", { name: "Raw JSONL" })
          .every((panel) => within(panel).queryByText(/record-2/)),
      ).toBe(true),
    );
  });

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

    await user.click(screen.getByRole("tab", { name: "Output" }));
    await waitFor(() => expect(screen.getAllByText("#3").length).toBeGreaterThan(0));
    expect(screen.getAllByText("File Overview").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Nested records").length).toBeGreaterThan(0);
    const maxDepthIcon = screen.getAllByText("Max depth")[0]?.parentElement?.querySelector("svg");
    expect(maxDepthIcon).toHaveClass("text-text-secondary");
    expect(maxDepthIcon).not.toHaveClass("text-code-boolean");
    await user.click(screen.getAllByRole("button", { name: /File Overview/ })[0]!);
    expect(screen.getAllByText("webhook.received").length).toBeGreaterThan(0);
    expect(screen.getAllByText("3 total · 2 ok · 1 err").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Parse failed").length).toBeGreaterThan(0);

    await user.click(screen.getAllByRole("button", { name: "Jump to line 2" })[0]!);
    await waitFor(() => expect(screen.queryAllByText("#1")).toHaveLength(0));
    expect(screen.getAllByText("#2").length).toBeGreaterThan(0);
  });

  it("filters JSONL records across list, toc, and search", async () => {
    const user = userEvent.setup();
    await renderFilterableJsonl();

    await user.type(getToolbarInput(), "boom");
    await user.click(screen.getAllByRole("button", { name: /Commands/ })[0]!);
    await user.click(screen.getByRole("option", { name: /Matches/ }));

    await waitFor(() => expect(screen.getAllByText("#2").length).toBeGreaterThan(0));
    expect(screen.queryAllByText("#1")).toHaveLength(0);
    expect(screen.queryAllByText("#3")).toHaveLength(0);
    expect(screen.getAllByText("boom").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1/3 records · 1 ok · 0 err").length).toBeGreaterThan(0);

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
    await renderFilterableJsonl();

    await user.click(screen.getAllByRole("button", { name: /Commands/ })[0]!);
    await user.click(screen.getByRole("option", { name: /Nested/ }));
    await waitFor(() => expect(screen.getAllByText("#1").length).toBeGreaterThan(0));
    expect(screen.queryAllByText("#2")).toHaveLength(0);

    await user.click(screen.getAllByRole("button", { name: /More actions/ })[0]!);
    await user.click(await screen.findByText("Copy JSONL"));

    expect(writeText).toHaveBeenLastCalledWith('{"level":"info","payload":{"nested":true}}');

    await user.click(screen.getAllByRole("button", { name: /More actions/ })[0]!);
    await user.click(await screen.findByText("Export JSONL"));
    await waitFor(() => expect(exportedBlobs).toHaveLength(1));
    await expect(readBlobText(exportedBlobs[0]!)).resolves.toBe(
      '{"level":"info","payload":{"nested":true}}',
    );

    await user.click(screen.getAllByRole("button", { name: /More actions/ })[0]!);
    await user.click(await screen.findByText("Export JSON"));
    await waitFor(() => expect(exportedBlobs).toHaveLength(2));
    await expect(readBlobText(exportedBlobs[1]!)).resolves.toBe(
      JSON.stringify([{ level: "info", payload: { nested: true } }], null, 2),
    );
  });

  it("skips the active-record observer for virtualized record lists", async () => {
    const user = userEvent.setup();
    const originalIntersectionObserver = globalThis.IntersectionObserver;
    const observerOptions: IntersectionObserverInit[] = [];
    Object.assign(globalThis, {
      IntersectionObserver: class {
        constructor(_callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
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

      await user.click(screen.getByRole("tab", { name: "Output" }));
      await waitFor(() =>
        expect(screen.getAllByText("161 total · 161 ok · 0 err").length).toBeGreaterThan(0),
      );

      expect(observerOptions.some((options) => Array.isArray(options.threshold))).toBe(false);
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

    await user.click(screen.getByRole("tab", { name: "Output" }));
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

    await user.click(screen.getByRole("tab", { name: "Output" }));
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

    await user.click(screen.getByRole("tab", { name: "Output" }));
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

    await user.click(screen.getByRole("tab", { name: "Output" }));
    await waitFor(() => expect(screen.getAllByText("a(b").length).toBeGreaterThan(0));
    await user.click(screen.getAllByText("a(b")[0]!);

    await user.keyboard("{Control>}c{/Control}");
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('"a(b": 1'));
  });

  it("shows JSON parse location in the source pane", async () => {
    render(
      <I18nProvider>
        <UnquoteApp initialInput={"{\n bad\n}"} />
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getAllByText("JSON parse failed").length).toBeGreaterThan(0));
    expect(screen.getAllByText("Line 2, column 2").length).toBeGreaterThan(0);
  });

  it("shows parse error UI in Chinese locale", async () => {
    localStorage.setItem("unquote-locale", "zh-CN");

    render(
      <I18nProvider>
        <UnquoteApp initialInput={"{\n bad\n}"} />
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getAllByText("JSON 解析失败").length).toBeGreaterThan(0));
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

    await user.click(screen.getByRole("tab", { name: "Output" }));
    await waitFor(() => expect(screen.getAllByText("Line 2, column 2").length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("button", { name: /Copy raw line/ })[0]!);

    expect(writeText).toHaveBeenLastCalledWith("{bad}");

    await user.click(screen.getAllByRole("button", { name: /Copy error/ })[0]!);
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining("Line 2, column 2"));
  });

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

    expect(screen.getByText("Release to open file")).toBeInTheDocument();
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

    await waitFor(() => expect(sourceInput).toHaveValue('{"pasted":true}'));
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

  it("keeps the previous source text visible while a dropped file is being read", async () => {
    let resolveRead: ((value: string) => void) | undefined;
    const onReadFile = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveRead = resolve;
        }),
    );
    render(
      <I18nProvider>
        <UnquoteApp initialInput={'{"old":true}'} onReadFile={onReadFile} />
      </I18nProvider>,
    );

    const sourceInput = screen.getAllByPlaceholderText(
      "Paste JSON / JSONL, or drop a file here.",
    )[0]!;
    expect(sourceInput).toHaveValue('{"old":true}');

    const file = new File(['{"new":true}'], "payload.json", { type: "application/json" });
    fireEvent.paste(sourceInput, {
      clipboardData: { files: [file], items: [], types: ["Files"] },
    });

    // While reading, the reading state carries prevText so the prior source text
    // stays visible instead of collapsing to the file-preview overlay.
    await waitFor(() => expect(onReadFile).toHaveBeenCalledTimes(1));
    expect(sourceInput).toHaveValue('{"old":true}');

    await act(async () => {
      resolveRead?.('{"new":true}');
    });
    await waitFor(() => expect(sourceInput).toHaveValue('{"new":true}'));
    await waitFor(() => expect(screen.getAllByText(/payload\.json/).length).toBeGreaterThan(0));
  });

  it("surfaces an error toast and restores prior text when a file read fails", async () => {
    const onReadFile = vi.fn().mockRejectedValue(new Error("boom"));
    render(
      <I18nProvider>
        <UnquoteApp initialInput={'{"old":true}'} onReadFile={onReadFile} />
      </I18nProvider>,
    );

    const sourceInput = screen.getAllByPlaceholderText(
      "Paste JSON / JSONL, or drop a file here.",
    )[0]!;

    const file = new File(['{"new":true}'], "payload.json", { type: "application/json" });
    fireEvent.paste(sourceInput, {
      clipboardData: { files: [file], items: [], types: ["Files"] },
    });

    // The read rejects: an error toast surfaces (the hook no longer rethrows, so
    // there is no unhandled rejection) and the prior source text is restored.
    await waitFor(() => expect(onReadFile).toHaveBeenCalledTimes(1));
    expect((await screen.findAllByText("Failed to read file")).length).toBeGreaterThan(0);
    await waitFor(() => expect(sourceInput).toHaveValue('{"old":true}'));
  });

  it("ignores a read failure after a newer file import succeeds", async () => {
    const toastError = vi.spyOn(toast, "error");
    const pendingReads = new Map<
      string,
      { resolve: (text: string) => void; reject: (error: Error) => void }
    >();
    const onReadFile = vi.fn(
      (file: File) =>
        new Promise<string>((resolve, reject) => {
          pendingReads.set(file.name, { resolve, reject });
        }),
    );
    render(
      <I18nProvider>
        <UnquoteApp initialInput={'{"old":true}'} onReadFile={onReadFile} />
      </I18nProvider>,
    );

    const sourceInput = screen.getAllByPlaceholderText(
      "Paste JSON / JSONL, or drop a file here.",
    )[0]!;
    const pasteFile = (file: File) =>
      fireEvent.paste(sourceInput, {
        clipboardData: { files: [file], items: [], types: ["Files"] },
      });

    pasteFile(new File(["a"], "a.json", { type: "application/json" }));
    pasteFile(new File(["b"], "b.json", { type: "application/json" }));
    await waitFor(() => expect(onReadFile).toHaveBeenCalledTimes(2));

    await act(async () => pendingReads.get("b.json")?.resolve('{"current":true}'));
    await waitFor(() => expect(sourceInput).toHaveValue('{"current":true}'));
    await act(async () => pendingReads.get("a.json")?.reject(new Error("stale failure")));

    expect(sourceInput).toHaveValue('{"current":true}');
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
    const file = new File(["x".repeat(1_000_001)], "worker-failure.jsonl", {
      type: "application/jsonl",
    });

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
    const fileContents = `${JSON.stringify({ message: longValue })}\n`;
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

    await user.click(screen.getByRole("tab", { name: "Output" }));
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
    const { container } = render(
      <I18nProvider>
        <UnquoteApp />
      </I18nProvider>,
    );
    const file = new File(
      [`${JSON.stringify({ value: 1 })}\n${" ".repeat(1_000_000)}`],
      "large.jsonl",
    );

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

    fireEvent.change(screen.getByLabelText(inputFormatLabel), { target: { value: "json" } });

    await waitFor(() =>
      expect(container.querySelector(".uq-shell")).toHaveAttribute("data-source-file", ""),
    );
    fireEvent.click(screen.getByRole("tab", { name: "Output" }));
    await waitFor(() => expect(screen.getAllByText("value").length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("tab", { name: "Input" }));
    fireEvent.change(screen.getByLabelText(inputFormatLabel), { target: { value: "jsonl" } });

    await waitFor(() =>
      expect(container.querySelector(".uq-shell")).toHaveAttribute(
        "data-source-file",
        "large.jsonl",
      ),
    );
  });

  it("counts and cycles search matches in the toolbar", async () => {
    const user = userEvent.setup();
    const input = ['{"msg":"alpha"}', '{"msg":"alpha"}', '{"msg":"beta"}'].join("\n");
    render(
      <I18nProvider>
        <UnquoteApp initialInput={input} />
      </I18nProvider>,
    );
    fireEvent.change(screen.getAllByLabelText(inputFormatLabel)[0]!, {
      target: { value: "jsonl" },
    });
    await user.click(screen.getByRole("tab", { name: "Output" }));
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

  it("completes an in-memory search through the search worker", async () => {
    const user = userEvent.setup();
    const input = ['{"msg":"alpha"}', '{"msg":"beta"}'].join("\n");
    const { container } = render(
      <I18nProvider>
        <UnquoteApp initialInput={input} />
      </I18nProvider>,
    );
    fireEvent.change(screen.getAllByLabelText(inputFormatLabel)[0]!, {
      target: { value: "jsonl" },
    });
    await user.click(screen.getByRole("tab", { name: "Output" }));
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
    fireEvent.change(screen.getAllByLabelText(inputFormatLabel)[0]!, {
      target: { value: "jsonl" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "Output" }));
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
      await act(() => vi.advanceTimersByTimeAsync(memorySearchDebounceMs + searchWorkerTimeoutMs));
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
    fireEvent.change(screen.getAllByLabelText(inputFormatLabel)[0]!, {
      target: { value: "jsonl" },
    });
    await user.click(screen.getByRole("tab", { name: "Output" }));
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
    await user.click(screen.getByRole("tab", { name: "Output" }));

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
    fireEvent.change(screen.getAllByLabelText(inputFormatLabel)[0]!, {
      target: { value: "jsonl" },
    });
    await user.click(screen.getByRole("tab", { name: "Output" }));
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

  it("Collapse All reverses Expand All for stringified JSON", async () => {
    const user = userEvent.setup();
    const input = '{"level":"info","payload":"{\\"nested\\":true}"}';
    render(
      <I18nProvider>
        <UnquoteApp initialInput={input} />
      </I18nProvider>,
    );
    fireEvent.change(screen.getAllByLabelText(inputFormatLabel)[0]!, {
      target: { value: "jsonl" },
    });
    await user.click(screen.getByRole("tab", { name: "Output" }));
    await waitFor(() => expect(screen.getAllByText("payload").length).toBeGreaterThan(0));

    // Stringified payload is collapsed by default — the inner `nested` key is absent.
    expect(screen.queryAllByText("nested")).toHaveLength(0);

    // The toolbar toggle starts as "Expand All" (aria-pressed=false).
    const toggle = screen
      .getAllByRole("button", { name: /^Expand All$/i })
      .find((button) => button.hasAttribute("aria-pressed"))!;
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    await user.click(toggle);
    await waitFor(() => expect(screen.getAllByText("nested").length).toBeGreaterThan(0));

    // Clicking again flips the toggle to "Collapse All" and re-folds the payload.
    const collapsedToggle = screen
      .getAllByRole("button", { name: /^Collapse All$/i })
      .find((button) => button.hasAttribute("aria-pressed"))!;
    expect(collapsedToggle.getAttribute("aria-pressed")).toBe("true");
    await user.click(collapsedToggle);
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

    await user.click(screen.getByRole("tab", { name: "Output" }));
    const shell = container.querySelector<HTMLElement>(".uq-shell")!;
    await waitFor(() => expect(shell).toHaveAttribute("data-source-file", "preview.jsonl"));
    await waitFor(() => expect(screen.getAllByText("payload").length).toBeGreaterThan(0));
    expect(screen.queryAllByText("nested")).toHaveLength(0);

    // A Preview Record's projected node has no children, so this only works
    // if the expansion is collected from the record's preview.
    const toggle = screen
      .getAllByRole("button", { name: /^Expand All$/i })
      .find((button) => button.hasAttribute("aria-pressed"))!;
    await user.click(toggle);

    await waitFor(() =>
      expect(
        screen
          .getAllByRole("button", { name: /^Collapse All$/i })
          .some((button) => button.getAttribute("aria-pressed") === "true"),
      ).toBe(true),
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

    await user.click(screen.getByRole("tab", { name: "Output" }));
    const shell = container.querySelector<HTMLElement>(".uq-shell")!;
    await waitFor(() => expect(shell).toHaveAttribute("data-source-file", "buried.jsonl"));
    await waitFor(() => expect(screen.getAllByText("meta").length).toBeGreaterThan(0));
    expect(screen.queryAllByText("buried")).toHaveLength(0);

    await user.click(
      screen
        .getAllByRole("button", { name: /^Expand All$/i })
        .find((button) => button.hasAttribute("aria-pressed"))!,
    );

    await waitFor(() => expect(screen.getAllByText("buried").length).toBeGreaterThan(0));
  });

  it("Expand All opens every level of nested stringified JSON in one click", async () => {
    const user = userEvent.setup();
    // The toolbar control is a single toggle, so there is no second Expand All
    // click available: one click has to reach all the way down.
    const input = JSON.stringify({
      payload: JSON.stringify({ inner: JSON.stringify({ deep: 1 }) }),
    });
    render(
      <I18nProvider>
        <UnquoteApp initialInput={input} />
      </I18nProvider>,
    );
    fireEvent.change(screen.getAllByLabelText(inputFormatLabel)[0]!, {
      target: { value: "jsonl" },
    });
    await user.click(screen.getByRole("tab", { name: "Output" }));
    await waitFor(() => expect(screen.getAllByText("payload").length).toBeGreaterThan(0));
    expect(screen.queryAllByText("deep")).toHaveLength(0);

    await user.click(
      screen
        .getAllByRole("button", { name: /^Expand All$/i })
        .find((button) => button.hasAttribute("aria-pressed"))!,
    );

    await waitFor(() => expect(screen.getAllByText("deep").length).toBeGreaterThan(0));

    await user.click(
      screen
        .getAllByRole("button", { name: /^Collapse All$/i })
        .find((button) => button.hasAttribute("aria-pressed"))!,
    );
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

    fireEvent.change(screen.getAllByLabelText(inputFormatLabel)[0]!, {
      target: { value: "jsonl" },
    });
    await user.click(screen.getByRole("tab", { name: "Output" }));
    await waitFor(() => expect(document.getElementById("record-1")).toBeInTheDocument());

    await user.click(
      within(document.getElementById("record-1")!)
        .getByRole("treeitem", { name: /payload/ })
        .querySelector("[data-tree-toggle]")!,
    );

    await waitFor(() =>
      expect(within(document.getElementById("record-1")!).getByText("nested")).toBeInTheDocument(),
    );
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

    fireEvent.change(screen.getAllByLabelText(inputFormatLabel)[0]!, {
      target: { value: "jsonl" },
    });
    await user.click(screen.getByRole("tab", { name: "Output" }));
    await waitFor(() => expect(document.getElementById("record-2")).toBeInTheDocument());

    await user.type(getToolbarInput(), "target-only");

    await waitFor(() =>
      expect(within(document.getElementById("record-1")!).getByText("nested")).toBeInTheDocument(),
    );
    expect(
      within(document.getElementById("record-2")!).queryByText("nested"),
    ).not.toBeInTheDocument();
  });

  it("shares record-scoped expansion between Agent and JSON views", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <UnquoteApp initialInput={codexRolloutSource} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("tab", { name: "Output" }));
    const timelineToolCall = (
      await screen.findAllByRole("button", {
        name: /^Timeline: tool_use exec_command/,
      })
    )[0]!;
    await user.click(timelineToolCall);

    const rawJsonPanel = (await screen.findAllByRole("complementary", { name: "Raw JSONL" }))[0]!;
    await user.click(
      within(rawJsonPanel)
        .getByRole("treeitem", { name: /arguments/ })
        .querySelector("[data-tree-toggle]")!,
    );
    await waitFor(() => expect(within(rawJsonPanel).getByText("cmd")).toBeInTheDocument());

    await user.click(screen.getAllByRole("tab", { name: "JSONL" })[0]!);
    const jsonRecord = await waitFor(() => {
      const record = document.getElementById("record-4");
      expect(record).toBeInTheDocument();
      return record!;
    });
    expect(within(jsonRecord).getByText("cmd")).toBeInTheDocument();

    await user.click(
      within(jsonRecord)
        .getByRole("treeitem", { name: /arguments/ })
        .querySelector("[data-tree-toggle]")!,
    );
    await user.click(screen.getAllByRole("tab", { name: "Agent" })[0]!);
    const collapsedRawJsonPanel = (
      await screen.findAllByRole("complementary", {
        name: "Raw JSONL",
      })
    )[0]!;
    expect(within(collapsedRawJsonPanel).queryByText("cmd")).not.toBeInTheDocument();
  });

  it("collapses only the records visible after filtering", async () => {
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

    fireEvent.change(screen.getAllByLabelText(inputFormatLabel)[0]!, {
      target: { value: "jsonl" },
    });
    await user.click(screen.getByRole("tab", { name: "Output" }));
    await waitFor(() => expect(document.getElementById("record-2")).toBeInTheDocument());

    const expandAll = screen
      .getAllByRole("button", { name: /^Expand All$/i })
      .find((button) => button.hasAttribute("aria-pressed"))!;
    await user.click(expandAll);
    await waitFor(() =>
      expect(within(document.getElementById("record-1")!).getByText("nested")).toBeInTheDocument(),
    );
    expect(within(document.getElementById("record-2")!).getByText("nested")).toBeInTheDocument();

    await user.type(getToolbarInput(), "target");
    await user.click(screen.getAllByRole("button", { name: /Commands/ })[0]!);
    await user.click(screen.getByRole("option", { name: /Matches/ }));
    await waitFor(() => {
      expect(document.getElementById("record-1")).toBeInTheDocument();
      expect(document.getElementById("record-2")).not.toBeInTheDocument();
    });

    const collapseAll = screen
      .getAllByRole("button", { name: /^Collapse All$/i })
      .find((button) => button.hasAttribute("aria-pressed"))!;
    await user.click(collapseAll);
    await waitFor(() => expect(screen.queryAllByText("nested")).toHaveLength(0));

    await user.click(screen.getAllByRole("button", { name: /Clear search/i })[0]!);
    await user.click(screen.getAllByRole("button", { name: /Commands/ })[0]!);
    await user.click(screen.getByRole("option", { name: /^All$/ }));
    await waitFor(() => expect(document.getElementById("record-2")).toBeInTheDocument());
    expect(within(document.getElementById("record-2")!).getByText("nested")).toBeInTheDocument();
  });

  it("resets expansion when the source changes", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <UnquoteApp initialInput={'{"payload":"{\\"first\\":true}"}'} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("tab", { name: "Output" }));
    await waitFor(() => expect(document.getElementById("record-1")).toBeInTheDocument());
    await user.click(
      within(document.getElementById("record-1")!)
        .getByRole("treeitem", { name: /payload/ })
        .querySelector("[data-tree-toggle]")!,
    );
    await waitFor(() => expect(screen.getAllByText("first")).toHaveLength(1));

    await user.click(screen.getByRole("tab", { name: "Input" }));

    fireEvent.change(
      screen.getAllByPlaceholderText("Paste JSON / JSONL, or drop a file here.")[0]!,
      {
        target: { value: '{"payload":"{\\"second\\":true}"}' },
      },
    );

    await user.click(screen.getByRole("tab", { name: "Output" }));
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

    await user.click(screen.getByRole("tab", { name: "Output" }));
    await user.type(getToolbarInput(), "first");
    await waitFor(() =>
      expect(container.querySelector("[data-search-query]")).toHaveAttribute(
        "data-search-query",
        "first",
      ),
    );

    await user.click(screen.getByRole("tab", { name: "Input" }));
    fireEvent.change(
      screen.getAllByPlaceholderText("Paste JSON / JSONL, or drop a file here.")[0]!,
      { target: { value: '{"message":"second"}' } },
    );

    await user.click(screen.getByRole("tab", { name: "Output" }));
    await waitFor(() => expect(getToolbarInput()).toHaveValue(""));
    expect(container.querySelector("[data-search-query]")).toHaveAttribute("data-search-query", "");
  });

  it("rebuilds only the toggled JSONL record rows", async () => {
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

    fireEvent.change(screen.getAllByLabelText(inputFormatLabel)[0]!, {
      target: { value: "jsonl" },
    });
    await user.click(screen.getByRole("tab", { name: "Output" }));
    await waitFor(() => expect(document.getElementById("record-3")).toBeInTheDocument());

    performance.clearMeasures("unquote:recordRows:build");
    await user.click(
      within(document.getElementById("record-1")!)
        .getByRole("treeitem", { name: /payload/ })
        .querySelector("[data-tree-toggle]")!,
    );
    await waitFor(() =>
      expect(within(document.getElementById("record-1")!).getByText("nested")).toBeInTheDocument(),
    );

    expect(performance.getEntriesByName("unquote:recordRows:build")).toHaveLength(1);
  });

  it("disables Copy above the large-source threshold and points to Export", () => {
    // The guard is a pure rule; behavior is verified at the unit level to avoid
    // parsing thousands of records in a render test.
    expect(isCopyAboveThreshold(5000, 1)).toBe(false);
    expect(isCopyAboveThreshold(5001, 1)).toBe(true);
    expect(isCopyAboveThreshold(1, 20_000_001)).toBe(true);
    expect(isCopyAboveThreshold(1, 20_000_000)).toBe(false);
  });

  it("keeps the clicked TOC record highlighted while scroll-spy reports another", async () => {
    const user = userEvent.setup();
    useDesktopViewport();
    const originalObserver = globalThis.IntersectionObserver;
    let observerCallback: IntersectionObserverCallback | null = null;
    Object.assign(globalThis, {
      IntersectionObserver: class {
        constructor(callback: IntersectionObserverCallback) {
          observerCallback = callback;
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
      const input = [
        '{"event":"message","i":1}',
        '{"event":"tool","i":2}',
        '{"event":"tool_result","i":3}',
      ].join("\n");
      render(
        <I18nProvider>
          <UnquoteApp initialInput={input} />
        </I18nProvider>,
      );
      fireEvent.change(screen.getAllByLabelText(inputFormatLabel)[0]!, {
        target: { value: "jsonl" },
      });
      await waitFor(() => expect(screen.getAllByText("#3").length).toBeGreaterThan(0));

      // Click the #3 entry in the TOC. TOC entries are wrapped in a div with
      // `items-stretch rounded-md`; the record card uses a different wrapper.
      const tocEntryButton = (lineNumber: number) =>
        screen.getAllByRole("button").find((node) => {
          if (!node.textContent?.includes(`#${lineNumber}`)) return false;
          const wrapper = node.closest("[class*='items-stretch']");
          return Boolean(wrapper && wrapper.className.includes("rounded-md"));
        });
      await user.click(tocEntryButton(3)!);

      const tocEntryFor = (lineNumber: number) =>
        tocEntryButton(lineNumber)?.closest("[class*='items-stretch']") ?? null;

      // Simulate the IntersectionObserver firing during smooth-scroll, reporting
      // #2 as the most-visible entry. The user's explicit #3 selection must win.
      act(() => {
        const target2 = document.getElementById("record-2") as HTMLElement;
        observerCallback?.(
          [
            {
              isIntersecting: true,
              intersectionRatio: 0.9,
              target: target2,
            } as unknown as IntersectionObserverEntry,
          ],
          {} as IntersectionObserver,
        );
      });

      const entry3 = tocEntryFor(3);
      expect(entry3?.className).toContain("border-border");
      const entry2 = tocEntryFor(2);
      expect(entry2?.className).toContain("border-transparent");
    } finally {
      Object.assign(globalThis, { IntersectionObserver: originalObserver });
    }
  });
});
