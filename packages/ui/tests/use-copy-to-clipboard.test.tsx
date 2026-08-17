import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCopyToClipboard } from "../src/hooks/use-copy-to-clipboard";
import { I18nProvider } from "../src/i18n/context";
import { copyBytesLimit } from "../src/lib/record-export";

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: toastMocks }));

const originalClipboard = navigator.clipboard;
const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider>{children}</I18nProvider>;

const stubClipboard = (writeText: ReturnType<typeof vi.fn>) => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  return writeText;
};

const renderCopy = () =>
  renderHook(
    ({ sourceRevision }: { sourceRevision: number }) => useCopyToClipboard(sourceRevision),
    {
      wrapper,
      initialProps: { sourceRevision: 0 },
    },
  );

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: originalClipboard,
  });
});

describe("useCopyToClipboard", () => {
  it("writes text without reporting a successful copy", async () => {
    const writeText = stubClipboard(vi.fn().mockResolvedValue(undefined));
    const { result } = renderCopy();

    await act(() => result.current(() => "payload"));

    expect(writeText).toHaveBeenCalledWith("payload");
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("reports a failed clipboard write", async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    const { result } = renderCopy();

    await act(() => result.current(() => "payload"));

    expect(toastMocks.error).toHaveBeenCalledWith("Copy failed");
  });

  it("blocks a final clipboard payload above the byte budget", async () => {
    const writeText = stubClipboard(vi.fn().mockResolvedValue(undefined));
    const { result } = renderCopy();

    await act(() => result.current(() => "x".repeat(copyBytesLimit + 1)));

    expect(writeText).not.toHaveBeenCalled();
    expect(toastMocks.warning).toHaveBeenCalledWith(
      "Data is too large to copy — use Export instead",
    );
  });

  it("skips the write when the producer reports its own failure", async () => {
    const writeText = stubClipboard(vi.fn().mockResolvedValue(undefined));
    const { result } = renderCopy();

    await act(() => result.current(() => null));

    expect(writeText).not.toHaveBeenCalled();
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("lets the newest copy win when a slower one finishes last", async () => {
    const writeText = stubClipboard(vi.fn().mockResolvedValue(undefined));
    const slow = deferred<string>();
    const { result } = renderCopy();
    let slowSignal: AbortSignal | undefined;

    const slowCopy = result.current((signal) => {
      slowSignal = signal;
      return slow.promise;
    });
    await act(() => result.current(() => "fast"));
    await act(async () => {
      slow.resolve("slow");
      await slowCopy;
    });

    expect(slowSignal?.aborted).toBe(true);
    expect(writeText.mock.calls.map(([text]) => text)).toEqual(["fast"]);
  });

  it("drops a copy whose source was replaced while it was producing text", async () => {
    const writeText = stubClipboard(vi.fn().mockResolvedValue(undefined));
    const pending = deferred<string>();
    const { result, rerender } = renderCopy();
    let copySignal: AbortSignal | undefined;

    // Started outside `act` so the rerender below can flush its effects while
    // this copy is still awaiting its text.
    const copy = result.current((signal) => {
      copySignal = signal;
      return pending.promise;
    });
    rerender({ sourceRevision: 1 });
    await act(async () => {
      pending.resolve("from the previous source");
      await copy;
    });

    expect(copySignal?.aborted).toBe(true);
    expect(writeText).not.toHaveBeenCalled();
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("drops a copy that is still producing text when the owner unmounts", async () => {
    const writeText = stubClipboard(vi.fn().mockResolvedValue(undefined));
    const pending = deferred<string>();
    const { result, unmount } = renderCopy();
    let copySignal: AbortSignal | undefined;

    const copy = result.current((signal) => {
      copySignal = signal;
      return pending.promise;
    });
    unmount();
    await act(async () => {
      pending.resolve("too late");
      await copy;
    });

    expect(copySignal?.aborted).toBe(true);
    expect(writeText).not.toHaveBeenCalled();
  });
});
