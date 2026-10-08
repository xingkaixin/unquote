import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deferredComponent } from "../src/components/deferred-component";
import { DeferredLoadBoundary } from "../src/components/deferred-load-boundary";
import { I18nProvider } from "../src/i18n/context";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const LoadedView = ({ label }: { label: string }) => <div>{label}</div>;

describe("deferredComponent", () => {
  it("renders a preloaded component in the first commit", async () => {
    const load = vi.fn(() => Promise.resolve(LoadedView));
    const Deferred = deferredComponent(load);

    await Deferred.preload();
    render(<Deferred label="Loaded view" />);

    expect(screen.getByText("Loaded view")).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reports a loader rejection to the deferred load boundary", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const Deferred = deferredComponent<{ label: string }>(() =>
      Promise.reject(new Error("chunk unavailable")),
    );

    render(
      <I18nProvider>
        <DeferredLoadBoundary resetKey="view">
          <Deferred label="Loaded view" />
        </DeferredLoadBoundary>
      </I18nProvider>,
    );

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("Loaded view")).not.toBeInTheDocument();
  });
});
