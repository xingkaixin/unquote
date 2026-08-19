import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDeferredComponent } from "../src/hooks/use-deferred-component";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const LoadedView = () => <div>Loaded view</div>;

const DeferredComponentProbe = ({
  load,
  enabled = true,
}: {
  load: () => Promise<ComponentType>;
  enabled?: boolean;
}) => {
  const deferred = useDeferredComponent(load, enabled);
  const LoadedComponent = deferred.component;

  if (deferred.failed) {
    return <button onClick={deferred.retry}>Retry deferred component</button>;
  }
  if (LoadedComponent) {
    return <LoadedComponent />;
  }
  return <div>{deferred.loading ? "Loading deferred component" : "Deferred component idle"}</div>;
};

describe("useDeferredComponent", () => {
  it("contains a loader rejection and retries it", async () => {
    const load = vi
      .fn<() => Promise<ComponentType>>()
      .mockRejectedValueOnce(new Error("chunk unavailable"))
      .mockResolvedValueOnce(LoadedView);
    render(<DeferredComponentProbe load={load} />);

    const retry = await screen.findByRole("button", { name: "Retry deferred component" });
    expect(load).toHaveBeenCalledTimes(1);

    fireEvent.click(retry);

    expect(await screen.findByText("Loaded view")).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("waits until loading is enabled and retains the loaded component", async () => {
    const load = vi.fn<() => Promise<ComponentType>>().mockResolvedValue(LoadedView);
    const { rerender } = render(<DeferredComponentProbe load={load} enabled={false} />);

    expect(screen.getByText("Deferred component idle")).toBeInTheDocument();
    expect(load).not.toHaveBeenCalled();

    rerender(<DeferredComponentProbe load={load} />);
    expect(await screen.findByText("Loaded view")).toBeInTheDocument();

    rerender(<DeferredComponentProbe load={load} enabled={false} />);
    await waitFor(() => expect(screen.getByText("Loaded view")).toBeInTheDocument());
    expect(load).toHaveBeenCalledTimes(1);
  });
});
