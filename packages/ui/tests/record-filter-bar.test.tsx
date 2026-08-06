import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecordFilterBar } from "../src/components/record-filter-bar";
import { I18nProvider } from "../src/i18n/context";
import type { RecordFilterMode } from "../src/lib/record-filter";

afterEach(cleanup);

const renderBar = (overrides: Partial<ComponentProps<typeof RecordFilterBar>> = {}) => {
  const props: ComponentProps<typeof RecordFilterBar> = {
    mode: "all",
    onChange: vi.fn(),
    shown: 2,
    total: 5,
    ...overrides,
  };
  render(
    <I18nProvider>
      <RecordFilterBar {...props} />
    </I18nProvider>,
  );
  return { props };
};

describe("RecordFilterBar", () => {
  it.each<{ label: string; mode: RecordFilterMode }>([
    { label: "All", mode: "all" },
    { label: "Tools", mode: "tool" },
    { label: "Messages", mode: "message" },
    { label: "Events", mode: "events" },
    { label: "Nested", mode: "nested" },
  ])("selects the $mode filter from the $label chip", async ({ label, mode }) => {
    const user = userEvent.setup();
    const { props } = renderBar();

    await user.click(screen.getByRole("button", { name: label }));
    expect(props.onChange).toHaveBeenCalledWith(mode);
  });

  it("presses only the active chip and leaves palette-only filters out", () => {
    renderBar({ mode: "nested" });

    expect(screen.getByRole("button", { name: "Nested" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: "Errors" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Matches" })).not.toBeInTheDocument();
  });

  it("reports how much of the file the filter keeps", () => {
    renderBar();

    expect(screen.getByText("2 / 5 records match this filter")).toBeInTheDocument();
  });
});
