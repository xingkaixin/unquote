import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../src/i18n/context";
import {
  createControlledStreamFile,
  createFailingStreamFile,
  createStreamFile,
} from "./helpers/stub-file";

const mocks = vi.hoisted(() => ({
  writeClipboardText: vi.fn(),
}));
const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
}));

vi.mock("../src/lib/clipboard", () => ({
  writeClipboardText: mocks.writeClipboardText,
}));
vi.mock("sonner", () => ({ toast: toastMocks }));

import { useSourceLoader } from "../src/hooks/use-source-loader";

const oversizedContents = (prefix: string) => prefix.padEnd(1_000_001, " ");
const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider>{children}</I18nProvider>;

// Each chunk is released by the test, so the count reflects exactly how far the
// reader got rather than how fast the queue filled.
const createCountingStreamFile = (name = "counted.json") => {
  const file = new File(["x"], name, { type: "application/json" });
  let pulled = 0;
  let releaseChunk: (() => void) | null = null;
  Object.defineProperty(file, "stream", {
    configurable: true,
    value: () =>
      new ReadableStream<Uint8Array>({
        pull(controller) {
          return new Promise<void>((resolve) => {
            releaseChunk = () => {
              try {
                controller.enqueue(new TextEncoder().encode("x".repeat(64)));
                pulled += 1;
              } catch {
                // Enqueueing into a canceled stream throws: the reader is gone,
                // which is precisely the outcome under test.
              }
              releaseChunk = null;
              resolve();
            };
          });
        },
      }),
  });

  return {
    file,
    pulled: () => pulled,
    releaseChunk: () => {
      releaseChunk?.();
      return releaseChunk !== null;
    },
  };
};

const setup = (overrides: Partial<Parameters<typeof useSourceLoader>[0]> = {}) => {
  const callbacks = {
    onCollapseSource: vi.fn(),
  };
  const params = {
    initialInput: "initial",
    ...callbacks,
    ...overrides,
  };
  return { callbacks, ...renderHook(() => useSourceLoader(params), { wrapper }) };
};

describe("useSourceLoader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.writeClipboardText.mockResolvedValue(true);
  });

  it("publishes parsing-mode changes as new Source Revisions", () => {
    const { result } = setup();

    act(() => result.current.setMode("json"));
    expect(result.current.sourceRevision).toBe(1);

    act(() => result.current.setMode("json"));
    expect(result.current.sourceRevision).toBe(1);

    act(() => result.current.setMode("jsonl"));
    expect(result.current.sourceRevision).toBe(2);
  });

  it("returns the exact revision assigned to a text source", () => {
    const { result } = setup();
    let publishedRevision = -1;

    act(() => {
      result.current.setMode("json");
      publishedRevision = result.current.onSourceChange("sample");
    });

    expect(publishedRevision).toBe(2);
    expect(result.current.sourceRevision).toBe(2);
  });

  it("keeps the published Source stable while a replacement file is read", async () => {
    const controlled = createControlledStreamFile('{"replacement":true}', "replacement.json");
    const { result } = setup();
    let readPromise: Promise<void> | undefined;

    act(() => result.current.onSourceChange('{"current":true}'));
    const currentRevision = result.current.sourceRevision;
    act(() => {
      readPromise = result.current.onFileDrop(controlled.file);
    });

    expect(controlled.stream).toHaveBeenCalledTimes(1);
    expect(result.current.sourceText).toBe('{"current":true}');
    expect(result.current.sourceAccess).toBeNull();
    expect(result.current.sourceRevision).toBe(currentRevision);

    await act(async () => {
      controlled.complete();
      await readPromise;
    });
    expect(result.current.sourceText).toBe('{"replacement":true}');
    expect(result.current.sourceRevision).toBe(currentRevision + 1);
  });

  it("publishes text and imported files while restoring text after a read failure", async () => {
    const readError = new Error("read failed");
    const imported = createStreamFile('{"imported":true}', "small.json");
    const broken = createFailingStreamFile(readError, "broken.json");
    const { result } = setup();

    act(() => result.current.onSourceChange("edited"));
    expect(result.current.sourceText).toBe("edited");
    expect(result.current.sourceRevision).toBe(1);

    await act(() => result.current.onFileDrop(imported.file));
    expect(imported.stream).toHaveBeenCalledTimes(1);
    expect(result.current.importedFile).toBe(imported.file);
    expect(result.current.sourceText).toBe('{"imported":true}');

    await act(() => result.current.onFileDrop(broken.file));
    expect(broken.stream).toHaveBeenCalledTimes(1);
    expect(result.current.sourceText).toBe('{"imported":true}');
    expect(result.current.readingFile).toBeNull();
    expect(toastMocks.error).toHaveBeenCalledWith("Failed to read file");
  });

  it("reports read progress and ignores an obsolete read failure", async () => {
    const controlled = createControlledStreamFile("slow", "slow.json");
    const { result } = setup();
    let readPromise: Promise<void> | undefined;

    act(() => {
      readPromise = result.current.onFileDrop(controlled.file);
    });
    await act(async () => {
      controlled.enqueue("sl");
    });
    expect(result.current.readProgress).toBe(0.5);

    act(() => result.current.onSourceChange("replacement"));
    await act(async () => {
      controlled.fail(new Error("obsolete"));
      await readPromise;
    });

    expect(result.current.sourceText).toBe("replacement");
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("collapses oversized text and ignores an obsolete successful import", async () => {
    const controlled = createControlledStreamFile("stale", "slow.json");
    const { result, callbacks } = setup();

    act(() => result.current.onSourceChange("x".repeat(1_000_001)));
    expect(callbacks.onCollapseSource).toHaveBeenCalledTimes(1);

    let readPromise: Promise<void> | undefined;
    act(() => {
      readPromise = result.current.onFileDrop(controlled.file);
    });
    act(() => result.current.onSourceChange("replacement"));
    await act(async () => {
      controlled.complete();
      await readPromise;
    });

    expect(result.current.sourceText).toBe("replacement");
    expect(result.current.importedFile).toBeNull();
  });

  it("switches a large file between streaming and imported modes", async () => {
    const contents = oversizedContents('{"loaded":true}');
    const { file, stream } = createStreamFile(contents, "large.jsonl");
    const { result, callbacks } = setup();

    await act(() => result.current.onFileDrop(file));
    expect(result.current.sourceAccess?.getFile()).toBe(file);
    expect(result.current.sourceText).toBe("");
    expect(stream).not.toHaveBeenCalled();

    act(() => result.current.setMode("json"));
    await waitFor(() => expect(result.current.importedFile).toBe(file));
    expect(stream).toHaveBeenCalledTimes(1);
    expect(result.current.sourceText).toBe(contents);

    act(() => result.current.setMode("jsonl"));
    expect(result.current.sourceAccess?.getFile()).toBe(file);
    expect(callbacks.onCollapseSource).toHaveBeenCalledTimes(3);
  });

  it("rechecks the active mode when an asynchronous file read completes", async () => {
    const controlled = createControlledStreamFile(
      oversizedContents('{"loaded":true}'),
      "large.json",
    );
    const { result } = setup();
    let readPromise: Promise<void> | undefined;

    act(() => {
      readPromise = result.current.onFileDrop(controlled.file);
    });
    act(() => result.current.setMode("jsonl"));
    await act(async () => {
      controlled.complete();
      await readPromise;
    });

    expect(result.current.sourceAccess?.getFile()).toBe(controlled.file);
    expect(result.current.importedFile).toBeNull();
  });

  it("imports a chosen file through the same path as a drop", async () => {
    const { file, stream } = createStreamFile('{"file":true}', "opened.json");
    const { result } = setup();

    await act(() => result.current.onFileDrop(file));

    expect(stream).toHaveBeenCalledTimes(1);
    expect(result.current.importedFile).toBe(file);
  });

  it("cancels a superseded read instead of decoding a file nobody wants", async () => {
    const controlled = createControlledStreamFile("stale", "slow.json");
    const { result } = setup();

    let readPromise: Promise<void> | undefined;
    act(() => {
      readPromise = result.current.onFileDrop(controlled.file);
    });
    act(() => controlled.enqueue("partial"));
    expect(controlled.isCanceled()).toBe(false);

    act(() => result.current.onSourceChange("replacement"));
    await act(async () => {
      await readPromise;
    });

    expect(controlled.isCanceled()).toBe(true);
    expect(result.current.sourceText).toBe("replacement");
    expect(result.current.importedFile).toBeNull();
    expect(result.current.readingFile).toBeNull();
    // Cancelling is the caller's own doing, so it must not look like a failure.
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("cancels a read that a newer import replaces, then completes the newer one", async () => {
    const stale = createControlledStreamFile("stale", "stale.json");
    const { file: fresh, stream } = createStreamFile('{"fresh":true}', "fresh.json");
    const { result } = setup();

    let stalePromise: Promise<void> | undefined;
    act(() => {
      stalePromise = result.current.onFileDrop(stale.file);
    });
    await act(async () => {
      await result.current.onFileDrop(fresh);
      await stalePromise;
    });

    expect(stale.isCanceled()).toBe(true);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(result.current.importedFile).toBe(fresh);
    expect(result.current.sourceText).toBe('{"fresh":true}');
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("cancels an in-flight read when the owner unmounts", async () => {
    const controlled = createControlledStreamFile("stale", "slow.json");
    const { result, unmount } = setup();

    act(() => {
      void result.current.onFileDrop(controlled.file);
    });
    act(() => controlled.enqueue("partial"));

    unmount();

    expect(controlled.isCanceled()).toBe(true);
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("still reports a genuine read failure", async () => {
    const { file } = createFailingStreamFile(new Error("disk gone"), "broken.json");
    const { result } = setup();

    await act(() => result.current.onFileDrop(file));

    expect(toastMocks.error).toHaveBeenCalledWith("Failed to read file");
    expect(result.current.readingFile).toBeNull();
  });

  it("stops pulling chunks once a read is superseded", async () => {
    const counted = createCountingStreamFile();
    const { result } = setup();

    let readPromise: Promise<void> | undefined;
    act(() => {
      readPromise = result.current.onFileDrop(counted.file);
    });
    for (let chunk = 0; chunk < 3; chunk += 1) {
      await act(async () => {
        counted.releaseChunk();
        await Promise.resolve();
      });
    }
    const pulledBeforeAbort = counted.pulled();
    expect(pulledBeforeAbort).toBeGreaterThan(0);

    act(() => result.current.onSourceChange("replacement"));
    await act(async () => {
      await readPromise;
    });

    // Five more releases cannot restart a canceled read: at most the one chunk
    // already in flight lands, and the rest of the file is never decoded.
    for (let chunk = 0; chunk < 5; chunk += 1) {
      await act(async () => {
        counted.releaseChunk();
        await Promise.resolve();
      });
    }

    expect(counted.pulled()).toBeLessThanOrEqual(pulledBeforeAbort + 1);
    expect(result.current.sourceText).toBe("replacement");
  });
});
