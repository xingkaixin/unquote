import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { UnquoteApp } from "../src/app";
import { I18nProvider } from "../src/i18n/context";
import {
  commandInputPlaceholder,
  getToolbarInput,
  inputFormatLabel,
  LocaleProbe,
  selectRailRecord,
  sourceButton,
} from "./app-test-helpers";

describe("UnquoteApp", () => {
  describe("shell and import", () => {
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

    it("renders the configured product updates link", () => {
      render(
        <I18nProvider>
          <UnquoteApp
            changelogUrls={{
              en: "/changelog/",
              "zh-CN": "/zh-CN/changelog/",
              ja: "/ja/changelog/",
            }}
          />
        </I18nProvider>,
      );

      expect(screen.getByRole("link", { name: "Product updates" })).toHaveAttribute(
        "href",
        "/changelog/",
      );
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

    it("replaces the command palette when opening the import dialog", async () => {
      const user = userEvent.setup();
      render(
        <I18nProvider>
          <UnquoteApp initialInput='{"ok":true}' />
        </I18nProvider>,
      );

      const importTrigger = sourceButton();
      await user.click(screen.getAllByRole("button", { name: "Commands" })[0]!);
      expect(
        await screen.findByRole("dialog", { name: "Find, jump, and commands" }),
      ).toBeInTheDocument();

      fireEvent.click(importTrigger);

      expect(await screen.findByRole("dialog", { name: "Import data" })).toBeInTheDocument();
      expect(
        screen.queryByRole("dialog", { name: "Find, jump, and commands" }),
      ).not.toBeInTheDocument();
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
      await user.click(screen.getByRole("menuitemradio", { name: "Light" }));
      await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

      await user.click(screen.getByRole("button", { name: "Change language" }));
      expect(await screen.findByRole("menuitemradio", { name: "English" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      expect(screen.getByRole("menuitemradio", { name: "Chinese (Simplified)" })).toHaveAttribute(
        "aria-checked",
        "false",
      );
      expect(screen.getByRole("menuitemradio", { name: "Japanese" })).toHaveAttribute(
        "aria-checked",
        "false",
      );
      await user.click(screen.getByRole("menuitemradio", { name: "Japanese" }));
      await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
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
      expect(screen.getByRole("button", { name: "自动" })).toHaveAttribute("aria-pressed", "true");
    });

    it("shows sample chip labels in Japanese locale", () => {
      localStorage.setItem("unquote-locale", "ja");

      render(
        <I18nProvider>
          <UnquoteApp />
        </I18nProvider>,
      );

      const sampleGroup = screen.getAllByRole("group", { name: "サンプル入力" })[0]!;
      expect(
        within(sampleGroup).getByRole("button", {
          name: "エスケープされた API レスポンス",
        }),
      ).toBeInTheDocument();
      expect(
        within(sampleGroup).getByRole("button", {
          name: "エージェントのツール呼び出し JSONL",
        }),
      ).toBeInTheDocument();
      expect(
        within(sampleGroup).getByRole("button", { name: "有効・無効混在の JSONL" }),
      ).toBeInTheDocument();
      expect(document.documentElement).toHaveAttribute("lang", "ja");
      expect(
        screen.getAllByText("貼り付け、ドロップ、またはファイルを選択").length,
      ).toBeGreaterThan(0);
      expect(screen.getByRole("button", { name: "自動" })).toHaveAttribute("aria-pressed", "true");
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
      await user.click(within(sampleGroup).getByRole("button", { name: "Agent tool-call JSONL" }));

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
});
