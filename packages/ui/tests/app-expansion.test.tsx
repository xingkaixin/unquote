import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { UnquoteApp } from "../src/app";
import { I18nProvider } from "../src/i18n/context";
import { getToolbarInput, replaceSource, selectRailRecord } from "./app-test-helpers";

describe("UnquoteApp", () => {
  describe("stringified JSON expansion", () => {
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
      const expandAll = screen.getByRole("button", { name: "Expand All" });
      expect(expandAll).toHaveAttribute("data-benchmark-action", "expand-all");
      await user.click(expandAll);
      await waitFor(() => expect(screen.getAllByText("nested").length).toBeGreaterThan(0));

      const collapseAll = screen.getByRole("button", { name: "Collapse All" });
      expect(collapseAll).toHaveAttribute("data-benchmark-action", "collapse-all");
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
      expect(await screen.findByText("This record contains stringified JSON")).toBeInTheDocument();
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
      expect(within(document.getElementById("record-1")!).getByText("nested")).toBeInTheDocument();
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
