import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "../src/components/command-palette";
import { I18nProvider } from "../src/i18n/context";

const renderPalette = (overrides: Partial<ComponentProps<typeof CommandPalette>> = {}) => {
  const callbacks = {
    onClose: vi.fn(),
    onInputChange: vi.fn(),
    onSearch: vi.fn(),
    onJumpPath: vi.fn(),
    onRegexChange: vi.fn(),
    onCaseSensitiveChange: vi.fn(),
    onJqChange: vi.fn(),
    onFilterChange: vi.fn(),
  };
  render(
    <I18nProvider>
      <CommandPalette
        open
        inputValue=""
        regex={false}
        caseSensitive={false}
        jq={false}
        matchCount={3}
        pathMatchCount={2}
        visibleCount={7}
        totalCount={10}
        filterMode="all"
        nestedFilterScope="all-levels"
        {...callbacks}
        {...overrides}
      />
    </I18nProvider>,
  );
  return callbacks;
};

describe("CommandPalette", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("runs search and toggles search options", async () => {
    const user = userEvent.setup();
    const callbacks = renderPalette({ inputValue: " needle " });

    expect(screen.getByText("3 matches")).toBeInTheDocument();
    expect(screen.getByText("7/10 records visible")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "JSONPath / jq syntax" }));
    await user.click(screen.getByRole("button", { name: "Regex" }));
    await user.click(screen.getByRole("button", { name: "Case sensitive" }));
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(callbacks.onJqChange).toHaveBeenCalledWith(true);
    expect(callbacks.onRegexChange).toHaveBeenCalledWith(true);
    expect(callbacks.onCaseSensitiveChange).toHaveBeenCalledWith(true);
    expect(callbacks.onSearch).toHaveBeenCalledWith("needle");
    expect(callbacks.onClose).toHaveBeenCalledTimes(1);
  });

  it("jumps to path-like input and forwards input changes", async () => {
    const user = userEvent.setup();
    const callbacks = renderPalette({ inputValue: "$.payload" });
    const input = screen.getByRole("combobox", { name: "Search or jump" });

    expect(screen.getByText("Path")).toBeInTheDocument();
    expect(screen.getByText("2 paths")).toBeInTheDocument();
    await user.type(input, ".value");
    expect(callbacks.onInputChange).toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });

    expect(callbacks.onJumpPath).toHaveBeenCalledWith("$.payload");
    expect(callbacks.onSearch).not.toHaveBeenCalled();
    expect(callbacks.onClose).toHaveBeenCalled();
  });

  it("filters commands and runs the keyboard-selected action", async () => {
    const user = userEvent.setup();
    const callbacks = renderPalette();
    const commandFilter = screen.getByRole("textbox", { name: "Filter commands..." });
    const input = screen.getByRole("combobox", { name: "Search or jump" });

    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).toHaveAttribute("aria-activedescendant", "command-action-filter-events");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant", "command-action-filter-all");

    await user.type(commandFilter, "errors");
    const errorOption = screen.getByRole("option", { name: "Errors" });
    fireEvent.mouseEnter(errorOption);
    expect(errorOption).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(callbacks.onFilterChange).toHaveBeenCalledWith("errors");
    expect(callbacks.onClose).toHaveBeenCalled();
  });

  it("handles an empty command result and escape without selecting a filter", async () => {
    const user = userEvent.setup();
    const callbacks = renderPalette();
    const commandFilter = screen.getByRole("textbox", { name: "Filter commands..." });
    const input = screen.getByRole("combobox", { name: "Search or jump" });

    await user.type(commandFilter, "no such command");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(callbacks.onFilterChange).not.toHaveBeenCalled();
    expect(callbacks.onClose).toHaveBeenCalledTimes(1);
    const closeCallsAfterEnter = callbacks.onClose.mock.calls.length;
    fireEvent.keyDown(input, { key: "Escape" });
    expect(callbacks.onClose.mock.calls.length).toBeGreaterThan(closeCallsAfterEnter);
  });

  it("runs a clicked filter and closes from the close control", async () => {
    const user = userEvent.setup();
    const callbacks = renderPalette({ filterMode: "nested", jq: true, regex: true });

    expect(screen.getByRole("option", { name: /Nested\s*active/i })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    await user.click(screen.getByRole("option", { name: "Tools" }));
    expect(callbacks.onFilterChange).toHaveBeenCalledWith("tool");

    await user.click(screen.getByRole("button", { name: "Close command panel" }));
    expect(callbacks.onClose).toHaveBeenCalledTimes(2);
  });

  it("labels the nested action as top-level for partial structure facts", () => {
    renderPalette({ nestedFilterScope: "top-level" });

    expect(screen.getByRole("option", { name: "Top-level nested" })).toBeInTheDocument();
  });
});
