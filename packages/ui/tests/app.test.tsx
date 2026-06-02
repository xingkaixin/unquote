import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JsonNode, JsonlRecord, ParseResult } from "@unquote/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnquoteApp } from "../src/app";
import { I18nProvider } from "../src/i18n/context";

const maxTransferStringLength = 4096;

const compactNodeForTransfer = (node: JsonNode): JsonNode => {
  const value =
    node.kind === "string" &&
    typeof node.value === "string" &&
    node.value.length > maxTransferStringLength
      ? node.value.slice(0, maxTransferStringLength)
      : node.value;
  const meta =
    value !== node.value && typeof node.value === "string"
      ? { ...node.meta, truncated: true, valueLength: node.value.length }
      : node.meta;

  if (node.kind === "array" && Array.isArray(node.children)) {
    return {
      ...node,
      value,
      children: node.children.map((child) => compactNodeForTransfer(child)),
      meta,
    };
  }

  if (node.kind === "object" && node.children && !Array.isArray(node.children)) {
    return {
      ...node,
      value,
      children: Object.fromEntries(
        Object.entries(node.children).map(([key, child]) => [key, compactNodeForTransfer(child)]),
      ),
      meta,
    };
  }

  return { ...node, value, meta };
};

const compactRecordForTransfer = (record: JsonlRecord): JsonlRecord =>
  record.node ? { ...record, node: compactNodeForTransfer(record.node) } : record;

const compactResultForTransfer = (result: ParseResult): ParseResult => ({
  ...result,
  records: result.records.map(compactRecordForTransfer),
});

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
    constructor(..._args: unknown[]) {}
    onmessage: ((event: MessageEvent) => void) | null = null;
    addEventListener(_type: string, listener: (event: MessageEvent) => void) {
      this.onmessage = listener;
    }
    removeEventListener() {}
    complete(requestId: number, input: string, forcedFormat?: "json" | "jsonl", compact = false) {
      import("@unquote/core").then(({ parseInput }) => {
        const parsed = parseInput(input, forcedFormat ? { forcedFormat } : {});
        const result = compact ? compactResultForTransfer(parsed) : parsed;
        this.onmessage?.({
          data: {
            type: "complete",
            requestId,
            result,
            progress: {
              processedLines: result.stats.total,
              success: result.stats.success,
              failed: result.stats.failed,
              elapsedMs: 0,
              done: true,
            },
          },
        } as MessageEvent);
      });
    }
    postMessage(payload: {
      type?: "parse" | "start-jsonl" | "jsonl-chunk" | "file-jsonl";
      requestId: number;
      input?: string;
      forcedFormat?: "json" | "jsonl";
      chunk?: string;
      done?: boolean;
      file?: File;
    }) {
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
  localStorage.clear();
});

describe("UnquoteApp", () => {
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
    expect(screen.getAllByPlaceholderText("Search text, or enter $.path to jump...")[0]).toBeInTheDocument();
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
    await waitFor(() => expect(screen.getAllByText("nested json").length).toBeGreaterThan(0));
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
    expect(screen.getAllByText("nested json").length).toBeGreaterThan(0);
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
    await user.click(screen.getAllByRole("button", { name: /File Overview/ })[0]!);
    expect(screen.getAllByText("webhook.received").length).toBeGreaterThan(0);
    expect(screen.getAllByText("3 total · 2 ok · 1 err").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Parse failed").length).toBeGreaterThan(0);

    await user.click(screen.getAllByRole("button", { name: "Jump to line 2" })[0]!);
    await waitFor(() => expect(screen.queryAllByText("#1")).toHaveLength(0));
    expect(screen.getAllByText("#2").length).toBeGreaterThan(0);
  });

  it("filters JSONL records across list, toc, search, and copy output", async () => {
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
    const input = [
      '{"level":"info","payload":"{\\"nested\\":true}"}',
      '{"level":"error","message":"boom"}',
      "not-json",
    ].join("\n");

    render(
      <I18nProvider>
        <UnquoteApp initialInput={input} />
      </I18nProvider>,
    );

    fireEvent.change(screen.getAllByLabelText("format mode")[0]!, {
      target: { value: "jsonl" },
    });
    await user.click(screen.getByRole("tab", { name: "Output" }));
    await waitFor(() => expect(screen.getAllByText("#3").length).toBeGreaterThan(0));

    await user.type(screen.getByPlaceholderText("Search text, or enter $.path to jump..."), "boom");
    await user.click(screen.getAllByRole("button", { name: /Commands/ })[0]!);
    await user.click(screen.getByRole("button", { name: /Matches/ }));

    await waitFor(() => expect(screen.queryAllByText("#1")).toHaveLength(0));
    expect(screen.getAllByText("#2").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("#3")).toHaveLength(0);
    expect(screen.getAllByText("boom").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1/3 records · 1 ok · 0 err").length).toBeGreaterThan(0);

    await user.click(screen.getAllByRole("button", { name: /Commands/ })[0]!);
    await user.click(screen.getByRole("button", { name: /Errors/ }));
    await waitFor(() => expect(screen.getAllByText("#3").length).toBeGreaterThan(0));
    expect(screen.getAllByText("#2").length).toBeGreaterThan(0);
    expect(screen.getAllByText("not-json").length).toBeGreaterThan(0);

    await user.click(screen.getAllByRole("button", { name: /Commands/ })[0]!);
    await user.click(screen.getByRole("button", { name: /Nested/ }));
    await waitFor(() => expect(screen.getAllByText("#1").length).toBeGreaterThan(0));
    expect(screen.queryAllByText("#2")).toHaveLength(0);
    expect(screen.getAllByText("nested json").length).toBeGreaterThan(0);

    await user.click(screen.getAllByRole("button", { name: /More actions/ })[0]!);
    await user.click(screen.getByText("Copy JSONL"));

    expect(writeText).toHaveBeenLastCalledWith('{"level":"info","payload":{"nested":true}}');

    await user.click(screen.getAllByRole("button", { name: /More actions/ })[0]!);
    await user.click(screen.getByText("Export JSONL"));
    await waitFor(() => expect(exportedBlobs).toHaveLength(1));
    await expect(readBlobText(exportedBlobs[0]!)).resolves.toBe(
      '{"level":"info","payload":{"nested":true}}',
    );

    await user.click(screen.getAllByRole("button", { name: /More actions/ })[0]!);
    await user.click(screen.getByText("Export JSON"));
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

  it("focuses selected nodes and copies extraction payloads", async () => {
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
    await waitFor(() => expect(screen.getAllByText("Path Inspector").length).toBeGreaterThan(0));

    await user.click(screen.getAllByRole("button", { name: /Focus subtree/ })[0]!);
    await waitFor(() =>
      expect(screen.getAllByText("Focused: $.payload").length).toBeGreaterThan(0),
    );
    expect(screen.queryAllByText("other")).toHaveLength(0);
    expect(screen.getAllByText("nested").length).toBeGreaterThan(0);

    await user.click(screen.getAllByRole("button", { name: /More actions/ }).at(-1)!);
    await user.click(screen.getByText("Copy subtree"));
    expect(writeText).toHaveBeenLastCalledWith(
      JSON.stringify({ ok: true, nested: { count: 2 } }, null, 2),
    );

    await user.click(screen.getAllByRole("button", { name: /More actions/ }).at(-1)!);
    await user.click(screen.getByText("Copy escaped string"));
    expect(writeText).toHaveBeenLastCalledWith(JSON.stringify('{"ok":true,"nested":{"count":2}}'));

    await user.click(screen.getAllByRole("button", { name: /More actions/ }).at(-1)!);
    await user.click(screen.getByText("Copy value"));
    expect(writeText).toHaveBeenLastCalledWith('{"ok":true,"nested":{"count":2}}');

    await user.click(screen.getAllByRole("button", { name: /More actions/ }).at(-1)!);
    await user.click(screen.getByText("Copy debug bundle"));
    const bundle = JSON.parse(writeText.mock.calls.at(-1)?.[0] as string) as {
      recordLine: number;
      path: string;
      parseStatus: string;
      value: unknown;
    };
    expect(bundle).toMatchObject({
      recordLine: 1,
      path: "$.payload",
      parseStatus: "success",
      value: { ok: true, nested: { count: 2 } },
    });

    await user.click(screen.getAllByRole("button", { name: /Exit focus/ })[0]!);
    await waitFor(() => expect(screen.queryAllByText("Focused: $.payload")).toHaveLength(0));
    expect(screen.getAllByText("other").length).toBeGreaterThan(0);
  });

  it("shows JSON parse location in the source pane", async () => {
    render(
      <I18nProvider>
        <UnquoteApp initialInput={"{\n bad\n}"} />
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getAllByText("JSON parse failed").length).toBeGreaterThan(0));
    expect(screen.getAllByText("Line 2, column 2").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Auto parsed as JSON").length).toBeGreaterThan(0);
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

  it("searches full string content in streamed JSONL files", async () => {
    const user = userEvent.setup();
    render(
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
    const streamSpy = vi.fn(() => new Blob([fileContents]).stream());
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

    await user.type(
      screen.getByPlaceholderText("Search text, or enter $.path to jump..."),
      "needle",
    );
    expect(streamSpy).not.toHaveBeenCalled();

    await waitFor(() => expect(streamSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getAllByText("1/1").length).toBeGreaterThan(0));
  });
});
