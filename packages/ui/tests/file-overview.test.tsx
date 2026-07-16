import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileOverview } from "../src/components/file-overview";
import { I18nProvider } from "../src/i18n/context";
import type { FileOverview as FileOverviewModel } from "../src/lib/file-overview";

const baseOverview: FileOverviewModel = {
  total: 10,
  success: 8,
  failed: 2,
  nestedRecords: 3,
  maxDepth: 5,
  topNestedPaths: [{ pathText: "$.payload", count: 3 }],
  topFieldValues: [
    { field: "tool", pathText: "$.tool", value: "Read", count: 2 },
    { field: "type", pathText: "$.type", value: "event", count: 4 },
    { field: "event", pathText: "$.event", value: "complete", count: 1 },
  ],
  errors: Array.from({ length: 10 }, (_, index) => ({
    recordId: `record-${index + 1}`,
    lineNumber: index + 1,
    message: index === 0 ? "" : `Error ${index + 1}`,
    summary: `Summary ${index + 1}`,
  })),
};

const renderOverview = (overview: FileOverviewModel = baseOverview, visibleCount = 3) => {
  const callbacks = {
    onSelectNestedPath: vi.fn(),
    onSearchFieldValue: vi.fn(),
    onSelectError: vi.fn(),
  };
  render(
    <I18nProvider>
      <FileOverview overview={overview} format="jsonl" visibleCount={visibleCount} {...callbacks} />
    </I18nProvider>,
  );
  return callbacks;
};

describe("FileOverview", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("expands diagnostics and forwards path, value, and error selections", async () => {
    const user = userEvent.setup();
    const callbacks = renderOverview();
    const toggle = screen.getByRole("button", { name: /file overview/i });

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("3/10 shown")).toBeInTheDocument();
    expect(screen.queryByText("Top nested paths")).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("tool · $.tool")).toBeInTheDocument();
    expect(screen.getByText("type · $.type")).toBeInTheDocument();
    expect(screen.getByText("event · $.event")).toBeInTheDocument();
    expect(screen.getByText("Summary 1")).toBeInTheDocument();
    expect(screen.getByText("2 more in Errors filter")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Jump to $.payload" }));
    await user.click(screen.getByRole("button", { name: "Search Read" }));
    await user.click(screen.getByRole("button", { name: "Jump to line 1" }));

    expect(callbacks.onSelectNestedPath).toHaveBeenCalledWith("$.payload");
    expect(callbacks.onSearchFieldValue).toHaveBeenCalledWith("Read");
    expect(callbacks.onSelectError).toHaveBeenCalledWith("record-1");
  });

  it("shows empty diagnostics without a filtered-scope badge", async () => {
    const user = userEvent.setup();
    const overview: FileOverviewModel = {
      ...baseOverview,
      total: 0,
      success: 0,
      failed: 0,
      nestedRecords: 0,
      maxDepth: 0,
      topNestedPaths: [],
      topFieldValues: [],
      errors: [],
    };
    renderOverview(overview, 0);

    expect(screen.queryByText(/shown$/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /file overview/i }));
    expect(screen.getAllByText("None")).toHaveLength(3);
    expect(screen.queryByText(/more in errors filter/i)).not.toBeInTheDocument();
  });
});
