import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UnquoteApp } from "../src/app";
import { I18nProvider } from "../src/i18n/context";
import { inspectorNodeLimit } from "../src/lib/selected-node";
import {
  getToolbarInput,
  readBlobText,
  renderFilterableJsonl,
  selectRailRecord,
} from "./app-test-helpers";

describe("UnquoteApp", () => {
  describe("records and errors", () => {
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
});
