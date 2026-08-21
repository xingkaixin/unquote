import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../src/i18n/context";
import { projectSourceImport, resolveSourceWork } from "../src/lib/published-source";
import { sourceDetectionProbeByteBudget } from "../src/lib/source-detect";
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

const snapshot = (current: ReturnType<typeof useSourceLoader>) => {
  const work = resolveSourceWork(current.source);
  const importProjection = projectSourceImport(current.source);
  return {
    sourceRevision: current.source.sourceRevision,
    sourceText: work.text,
    sourceAccess: work.sourceAccess,
    importedFile: work.sourceAccess ? null : importProjection.file,
    mode: importProjection.mode,
    readingFile: current.operation.kind === "reading" ? current.operation.file : null,
    readProgress: current.operation.kind === "reading" ? current.operation.progress : null,
  };
};

const oversizedContents = (prefix: string) => prefix.padEnd(1_000_001, " ");
const oversizedJsonlContents = (line = '{"loaded":true}\n') =>
  line.repeat(Math.ceil(1_000_001 / line.length));
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

const createControlledProbeFile = (name = "probe.txt") => {
  const source = createStreamFile(oversizedJsonlContents(), name);
  const probe = new Blob([]);
  let canceled = false;
  const probeStream = vi.fn(
    () =>
      new ReadableStream<Uint8Array>({
        cancel() {
          canceled = true;
        },
      }),
  );
  Object.defineProperty(probe, "stream", { configurable: true, value: probeStream });
  const slice = vi.spyOn(source.file, "slice").mockReturnValue(probe);

  return {
    ...source,
    probeStream,
    slice,
    isProbeCanceled: () => canceled,
  };
};

const setup = (overrides: Partial<Parameters<typeof useSourceLoader>[0]> = {}) => {
  const params = {
    initialInput: "initial",
    ...overrides,
  };
  return renderHook(() => useSourceLoader(params), { wrapper });
};

describe("useSourceLoader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.writeClipboardText.mockResolvedValue(true);
  });

  it("publishes text and parsing mode as one Source Revision", () => {
    const { result } = setup();
    let publishedRevision = -1;

    act(() => {
      publishedRevision = result.current.onSourceChange("sample", "json");
    });

    expect(publishedRevision).toBe(1);
    expect(snapshot(result.current).sourceRevision).toBe(1);
    expect(snapshot(result.current).sourceText).toBe("sample");
    expect(snapshot(result.current).mode).toBe("json");
  });

  it("returns the exact revision assigned to a text source", () => {
    const { result } = setup();
    let publishedRevision = -1;

    act(() => {
      publishedRevision = result.current.onSourceChange("sample");
    });

    expect(publishedRevision).toBe(1);
    expect(snapshot(result.current).sourceRevision).toBe(1);
  });

  it("keeps the published Source stable while a replacement file is read", async () => {
    const controlled = createControlledStreamFile('{"replacement":true}', "replacement.json");
    const { result } = setup();
    let readPromise: Promise<void> | undefined;

    act(() => result.current.onSourceChange('{"current":true}'));
    const currentRevision = snapshot(result.current).sourceRevision;
    act(() => {
      readPromise = result.current.onFileDrop(controlled.file);
    });

    expect(controlled.stream).toHaveBeenCalledTimes(1);
    expect(snapshot(result.current).sourceText).toBe('{"current":true}');
    expect(snapshot(result.current).sourceAccess).toBeNull();
    expect(snapshot(result.current).sourceRevision).toBe(currentRevision);

    await act(async () => {
      controlled.complete();
      await readPromise;
    });
    expect(snapshot(result.current).sourceText).toBe('{"replacement":true}');
    expect(snapshot(result.current).sourceRevision).toBe(currentRevision + 1);
  });

  it("publishes text and imported files while restoring text after a read failure", async () => {
    const readError = new Error("read failed");
    const imported = createStreamFile('{"imported":true}', "small.json");
    const broken = createFailingStreamFile(readError, "broken.json");
    const { result } = setup();

    act(() => result.current.onSourceChange("edited"));
    expect(snapshot(result.current).sourceText).toBe("edited");
    expect(snapshot(result.current).sourceRevision).toBe(1);

    await act(() => result.current.onFileDrop(imported.file));
    expect(imported.stream).toHaveBeenCalledTimes(1);
    expect(snapshot(result.current).importedFile).toBe(imported.file);
    expect(snapshot(result.current).sourceText).toBe('{"imported":true}');

    await act(() => result.current.onFileDrop(broken.file));
    expect(broken.stream).toHaveBeenCalledTimes(1);
    expect(snapshot(result.current).sourceText).toBe('{"imported":true}');
    expect(snapshot(result.current).readingFile).toBeNull();
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
    expect(snapshot(result.current).readProgress).toBe(0.5);

    act(() => result.current.onSourceChange("replacement"));
    await act(async () => {
      controlled.fail(new Error("obsolete"));
      await readPromise;
    });

    expect(snapshot(result.current).sourceText).toBe("replacement");
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("keeps oversized text published and ignores an obsolete successful import", async () => {
    const controlled = createControlledStreamFile("stale", "slow.json");
    const { result } = setup();

    act(() => result.current.onSourceChange("x".repeat(1_000_001)));
    expect(snapshot(result.current).sourceText).toHaveLength(1_000_001);

    let readPromise: Promise<void> | undefined;
    act(() => {
      readPromise = result.current.onFileDrop(controlled.file);
    });
    act(() => result.current.onSourceChange("replacement"));
    await act(async () => {
      controlled.complete();
      await readPromise;
    });

    expect(snapshot(result.current).sourceText).toBe("replacement");
    expect(snapshot(result.current).importedFile).toBeNull();
  });

  it("switches a large file between streaming and imported modes", async () => {
    const contents = oversizedJsonlContents();
    const { file, stream } = createStreamFile(contents, "large.jsonl");
    const { result } = setup();

    await act(() => result.current.onFileDrop(file, "auto"));
    expect(snapshot(result.current).sourceAccess?.getFile()).toBe(file);
    expect(snapshot(result.current).sourceText).toBe("");
    expect(stream).not.toHaveBeenCalled();

    await act(() => result.current.onFileDrop(file, "json"));
    await waitFor(() => expect(snapshot(result.current).importedFile).toBe(file));
    expect(stream).toHaveBeenCalledTimes(1);
    expect(snapshot(result.current).sourceText).toBe(contents);
    expect(snapshot(result.current).mode).toBe("json");

    await act(() => result.current.onFileDrop(file, "jsonl"));
    expect(snapshot(result.current).sourceAccess?.getFile()).toBe(file);
    expect(snapshot(result.current).sourceText).toBe("");
    expect(snapshot(result.current).mode).toBe("jsonl");
  });

  it.each(["trace.txt", "events.json", "trace"])(
    "streams large JSONL from content when named %s",
    async (name) => {
      const { file, stream } = createStreamFile(oversizedJsonlContents(), name);
      const slice = vi.spyOn(file, "slice");
      const { result } = setup();

      await act(() => result.current.onFileDrop(file, "auto"));

      expect(snapshot(result.current).sourceAccess?.getFile()).toBe(file);
      expect(snapshot(result.current).importedFile).toBeNull();
      expect(stream).not.toHaveBeenCalled();
      expect(slice).toHaveBeenCalledWith(0, sourceDetectionProbeByteBudget + 1);
    },
  );

  it("recognizes CRLF JSONL after a BOM and leading blank lines", async () => {
    const contents = oversizedContents('\uFEFF\r\n\r\n{"i":1}\r\n{"i":2}\r\n');
    const { file, stream } = createStreamFile(contents, "trace.txt");
    const { result } = setup();

    await act(() => result.current.onFileDrop(file, "auto"));

    expect(snapshot(result.current).sourceAccess?.getFile()).toBe(file);
    expect(stream).not.toHaveBeenCalled();
  });

  it.each([
    ["large pretty JSON", `{\n  "blob": "${"x".repeat(1_000_000)}"\n}`],
    ["large single-line JSON", `{"blob":"${"x".repeat(1_000_000)}"}`],
    [
      "JSONL with no complete line in the probe",
      oversizedContents(`{"blob":"${"x".repeat(70 * 1024)}"}\n{"i":2}\n`),
    ],
  ])("keeps ambiguous %s on the full-read path", async (_, contents) => {
    const { file, stream } = createStreamFile(contents, "misleading.jsonl");
    const { result } = setup();

    await act(() => result.current.onFileDrop(file, "auto"));

    expect(snapshot(result.current).sourceAccess).toBeNull();
    expect(snapshot(result.current).importedFile).toBe(file);
    expect(stream).toHaveBeenCalledOnce();
  });

  it("cancels a content probe superseded by a text source", async () => {
    const controlled = createControlledProbeFile();
    const { result } = setup();
    let importPromise: Promise<void> | undefined;

    act(() => {
      importPromise = result.current.onFileDrop(controlled.file, "auto");
    });
    expect(controlled.probeStream).toHaveBeenCalledOnce();

    act(() => result.current.onSourceChange("replacement"));
    await act(async () => {
      await importPromise;
    });

    expect(controlled.isProbeCanceled()).toBe(true);
    expect(controlled.stream).not.toHaveBeenCalled();
    expect(snapshot(result.current).sourceText).toBe("replacement");
    expect(snapshot(result.current).sourceAccess).toBeNull();
  });

  it("cancels a content probe when a newer file is selected", async () => {
    const stale = createControlledProbeFile("stale.txt");
    const fresh = createStreamFile(oversizedJsonlContents(), "fresh.data");
    const { result } = setup();
    let stalePromise: Promise<void> | undefined;

    act(() => {
      stalePromise = result.current.onFileDrop(stale.file, "auto");
    });
    await act(async () => {
      await result.current.onFileDrop(fresh.file, "jsonl");
      await stalePromise;
    });

    expect(stale.isProbeCanceled()).toBe(true);
    expect(stale.stream).not.toHaveBeenCalled();
    expect(snapshot(result.current).sourceAccess?.getFile()).toBe(fresh.file);
  });

  it("cancels an in-flight content probe when the owner unmounts", async () => {
    const controlled = createControlledProbeFile();
    const { result, unmount } = setup();
    let importPromise: Promise<void> | undefined;

    act(() => {
      importPromise = result.current.onFileDrop(controlled.file, "auto");
    });
    unmount();
    await act(async () => {
      await importPromise;
    });

    expect(controlled.isProbeCanceled()).toBe(true);
    expect(controlled.stream).not.toHaveBeenCalled();
  });

  it("publishes an asynchronous file and its candidate mode together", async () => {
    const controlled = createControlledStreamFile(
      oversizedContents('{"loaded":true}'),
      "large.json",
    );
    const { result } = setup();
    let readPromise: Promise<void> | undefined;

    act(() => {
      readPromise = result.current.onFileDrop(controlled.file, "json");
    });
    expect(snapshot(result.current).mode).toBe("auto");
    expect(snapshot(result.current).sourceRevision).toBe(0);

    await act(async () => {
      controlled.complete();
      await readPromise;
    });

    expect(snapshot(result.current).sourceAccess).toBeNull();
    expect(snapshot(result.current).importedFile).toBe(controlled.file);
    expect(snapshot(result.current).mode).toBe("json");
    expect(snapshot(result.current).sourceRevision).toBe(1);
  });

  it("imports a chosen file through the same path as a drop", async () => {
    const { file, stream } = createStreamFile('{"file":true}', "opened.json");
    const { result } = setup();

    await act(() => result.current.onFileDrop(file));

    expect(stream).toHaveBeenCalledTimes(1);
    expect(snapshot(result.current).importedFile).toBe(file);
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
    expect(snapshot(result.current).sourceText).toBe("replacement");
    expect(snapshot(result.current).importedFile).toBeNull();
    expect(snapshot(result.current).readingFile).toBeNull();
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
    expect(snapshot(result.current).importedFile).toBe(fresh);
    expect(snapshot(result.current).sourceText).toBe('{"fresh":true}');
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
    expect(snapshot(result.current).readingFile).toBeNull();
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
    expect(snapshot(result.current).sourceText).toBe("replacement");
  });
});
