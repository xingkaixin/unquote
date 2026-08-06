import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatusBar } from "../src/components/status-bar";
import { I18nProvider } from "../src/i18n/context";

afterEach(cleanup);

const renderBar = (overrides: Partial<ComponentProps<typeof StatusBar>> = {}) => {
  const props: ComponentProps<typeof StatusBar> = {
    summary: "3 total · 2 ok · 1 err",
    failedCount: 0,
    onSelectFailed: vi.fn(),
    maxDepth: 4,
    expandedNestedCount: 2,
    sourceStatus: undefined,
    sourceBusy: false,
    sourceProgress: null,
    hasData: true,
    onClear: vi.fn(),
    ...overrides,
  };
  const rendered = render(
    <I18nProvider>
      <StatusBar {...props} />
    </I18nProvider>,
  );
  return { ...rendered, props };
};

describe("StatusBar source progress", () => {
  it.each([
    { progress: -1, scale: 0 },
    { progress: 0.42, scale: 0.42 },
    { progress: 2, scale: 1 },
  ])("renders determinate progress $progress as scaleX($scale)", ({ progress, scale }) => {
    const { container } = renderBar({
      sourceStatus: "Reading payload.json",
      sourceBusy: true,
      sourceProgress: progress,
    });
    const indicator = container.querySelector<HTMLElement>(".uq-motion-progress");

    expect(indicator).toHaveClass("w-full", "origin-left", "transition-transform");
    expect(indicator).toHaveStyle({ transform: `scaleX(${scale})` });
    expect(indicator?.style.width).toBe("");
  });

  it("preserves the indeterminate pulse without a determinate transform", () => {
    const { container } = renderBar({
      sourceStatus: "Reading payload.json",
      sourceBusy: true,
      sourceProgress: null,
    });
    const indicator = container.querySelector<HTMLElement>(".uq-motion-progress");

    expect(indicator).toHaveClass("uq-motion-pulse", "w-1/2", "animate-pulse");
    expect(indicator?.style.transform).toBe("");
  });
});

describe("StatusBar summary", () => {
  it("reports the parse summary, depth, and expanded nesting", () => {
    renderBar();

    expect(screen.getByText("3 total · 2 ok · 1 err")).toBeInTheDocument();
    expect(screen.getByText("max depth 4")).toBeInTheDocument();
    expect(screen.getByText("2 nested expanded")).toBeInTheDocument();
  });

  it("offers the failed count as the only jump into the error filter", async () => {
    const user = userEvent.setup();
    const { props, rerender } = renderBar({ failedCount: 1 });

    await user.click(screen.getByRole("button", { name: "1 failed" }));
    expect(props.onSelectFailed).toHaveBeenCalledOnce();

    rerender(
      <I18nProvider>
        <StatusBar {...props} failedCount={0} />
      </I18nProvider>,
    );
    expect(screen.queryByRole("button", { name: /failed/ })).not.toBeInTheDocument();
  });

  it("clears the loaded source", async () => {
    const user = userEvent.setup();
    const { props } = renderBar();

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(props.onClear).toHaveBeenCalledOnce();
  });

  it("hides the data-scoped readouts until a source is loaded", () => {
    renderBar({ hasData: false, summary: "No data loaded · waiting for import" });

    expect(screen.getByText("No data loaded · waiting for import")).toBeInTheDocument();
    expect(screen.queryByText("max depth 4")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
    // The empty state disables the search field and ⌘K, so it must not
    // advertise their shortcuts (dc:319-326 gates the hints on hasData).
    expect(screen.queryByText("⌘K command palette")).not.toBeInTheDocument();
    expect(screen.queryByText("↑↓ prev/next match")).not.toBeInTheDocument();
    expect(screen.queryByText("Enter jump to path")).not.toBeInTheDocument();
  });

  it("keeps the shortcut hints once a source is loaded", () => {
    renderBar();

    expect(screen.getByText("⌘K command palette")).toBeInTheDocument();
  });

  it("renders store links whether or not a source is loaded", () => {
    renderBar({
      hasData: false,
      chromeWebStoreUrl: "https://chrome.example/extension",
      edgeAddonsUrl: "https://edge.example/extension",
    });

    for (const link of screen.getAllByRole("link", { name: /Extension$/ })) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noreferrer");
    }
  });
});
