import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";
import { UnquoteApp } from "../src/app";
import { I18nProvider } from "../src/i18n/context";
import { createControlledStreamFile, createFailingStreamFile } from "./helpers/stub-file";
import {
  getToolbarInput,
  maxTransferStringLength,
  pasteFileIntoImport,
  setInputFormat,
} from "./app-test-helpers";

describe("UnquoteApp", () => {
  describe("local files", () => {
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
});
