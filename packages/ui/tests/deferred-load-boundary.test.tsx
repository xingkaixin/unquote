import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeferredLoadBoundary } from "../src/components/deferred-load-boundary";
import { DeferredLoadError } from "../src/components/deferred-load-error";
import { I18nProvider } from "../src/i18n/context";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const BrokenView = () => {
  throw new Error("chunk unavailable");
};

describe("DeferredLoadBoundary", () => {
  it("contains a render failure and resets when the owning view changes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = render(
      <I18nProvider>
        <DeferredLoadBoundary resetKey="agent">
          <BrokenView />
        </DeferredLoadBoundary>
      </I18nProvider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("This view couldn't be loaded");

    rerender(
      <I18nProvider>
        <DeferredLoadBoundary resetKey="json">
          <div>Recovered view</div>
        </DeferredLoadBoundary>
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByText("Recovered view")).toBeInTheDocument());
  });

  it("provides an explicit retry action", () => {
    const onRetry = vi.fn();
    render(
      <I18nProvider>
        <DeferredLoadError onRetry={onRetry} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(onRetry).toHaveBeenCalledOnce();
  });
});
