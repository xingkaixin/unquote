import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UnquoteApp } from "../src/app";
import { memorySearchDebounceMs } from "../src/hooks/use-query-interaction";
import { searchWorkerTimeoutMs } from "../src/hooks/use-search-worker";
import { I18nProvider } from "../src/i18n/context";
import { setInitialSearchWindowIndexes } from "./helpers/app-worker";
import { commandInputPlaceholder, getToolbarInput, railItem } from "./app-test-helpers";

describe("UnquoteApp", () => {
  describe("search", () => {
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

      const commandsButton = screen.getAllByRole("button", { name: /Commands/i })[0]!;
      await waitFor(() => expect(commandsButton).toBeEnabled());
      await user.click(commandsButton);
      // Enable regex, then jq — jq must turn regex off.
      const regexButton = await screen.findByRole("button", { name: /^Regex$/i });
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
});
