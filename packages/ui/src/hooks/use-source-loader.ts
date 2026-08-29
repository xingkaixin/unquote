import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "../i18n/context";
import { reportDiagnostic } from "../lib/diagnostics";
import {
  createLocalFileAccess,
  readFileHead,
  type LocalFileAccess,
} from "../lib/local-file-source";
import {
  createImportedFileSourceRevision,
  createStreamingFileSourceRevision,
  createTextSourceRevision,
  type PublishedSourceRevision,
} from "../lib/published-source";
import type { SourceMode } from "../lib/source-candidate";
import { detectSourceFormat, sourceDetectionProbeByteBudget } from "../lib/source-detect";
import type { SourceRevision } from "../lib/source-revision";

const largeSourceStreamBytes = 1_000_000;
// Full JSON parsing keeps source and parsed representations live together.
// Reserve three quarters of the 256 MiB release heap budget for that expansion.
export const maxInMemorySourceBytes = 64 * 1024 * 1024;
const sourceDetectionFileProbeBytes = sourceDetectionProbeByteBudget + 1;

interface ReadingSourceOperation {
  kind: "reading";
  requestId: number;
  file: File;
  progress: number | null;
}

type SourceReadOperation = { kind: "idle" } | ReadingSourceOperation;

interface SourceLoaderState {
  source: PublishedSourceRevision;
  operation: SourceReadOperation;
}

interface UseSourceLoaderParams {
  initialInput: string;
}

export const useSourceLoader = ({ initialInput }: UseSourceLoaderParams) => {
  const { t } = useTranslation();
  const [state, setState] = useState<SourceLoaderState>(() => ({
    source: createTextSourceRevision(0, initialInput, "auto"),
    operation: { kind: "idle" },
  }));
  const sourceRevisionRef = useRef<SourceRevision>(state.source.sourceRevision);
  const fileImportIdRef = useRef(0);
  const publishedAccessRef = useRef<LocalFileAccess | null>(null);
  const mountedRef = useRef(false);
  // The request id keeps a stale result from being committed; this stops the
  // work that produced it. A superseded read has no value, so it should not
  // keep decoding a large file in the background.
  const activeReadRef = useRef<AbortController | null>(null);
  const abortActiveRead = () => {
    activeReadRef.current?.abort();
    activeReadRef.current = null;
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      abortActiveRead();
      mountedRef.current = false;
      // React StrictMode immediately remounts this effect during its development check.
      queueMicrotask(() => {
        if (!mountedRef.current) {
          publishedAccessRef.current?.dispose();
          publishedAccessRef.current = null;
        }
      });
    };
  }, []);

  const nextSourceRevision = () => {
    sourceRevisionRef.current += 1;
    return sourceRevisionRef.current;
  };

  const publishSource = (source: PublishedSourceRevision) => {
    const nextAccess = source.kind === "local-file" ? source.access : null;
    const previousAccess = publishedAccessRef.current;
    publishedAccessRef.current = nextAccess;
    if (previousAccess && previousAccess !== nextAccess) {
      previousAccess.dispose();
    }
    setState({ source, operation: { kind: "idle" } });
    return source.sourceRevision;
  };

  const onSourceChange = (value: string, sourceMode: SourceMode = state.source.mode) => {
    fileImportIdRef.current += 1;
    abortActiveRead();
    return publishSource(createTextSourceRevision(nextSourceRevision(), value, sourceMode));
  };

  const onFileDrop = async (file: File, sourceMode: SourceMode = state.source.mode) => {
    const requestId = fileImportIdRef.current + 1;
    fileImportIdRef.current = requestId;
    abortActiveRead();

    const isLargeFile = file.size > largeSourceStreamBytes;
    if (isLargeFile && sourceMode === "jsonl") {
      publishSource(
        createStreamingFileSourceRevision(
          nextSourceRevision(),
          createLocalFileAccess(file),
          sourceMode,
        ),
      );
      return;
    }

    const controller = new AbortController();
    activeReadRef.current = controller;
    setState((current) => ({
      source: current.source,
      operation: { kind: "reading", requestId, file, progress: 0 },
    }));

    let text: string;
    try {
      if (isLargeFile && sourceMode === "auto") {
        const head = await readFileHead(file, sourceDetectionFileProbeBytes, controller.signal);
        if (fileImportIdRef.current !== requestId || controller.signal.aborted) {
          return;
        }
        if (detectSourceFormat(head).kind === "jsonl") {
          activeReadRef.current = null;
          publishSource(
            createStreamingFileSourceRevision(
              nextSourceRevision(),
              createLocalFileAccess(file),
              sourceMode,
            ),
          );
          return;
        }
      }

      if (file.size > maxInMemorySourceBytes) {
        activeReadRef.current = null;
        setState((current) =>
          current.operation.kind === "reading" && current.operation.requestId === requestId
            ? { source: current.source, operation: { kind: "idle" } }
            : current,
        );
        toast.error(t("input.fileTooLargeForMemory"));
        return;
      }

      const access = createLocalFileAccess(file);
      try {
        text = await access.readText((nextProgress) => {
          if (fileImportIdRef.current === requestId) {
            setState((current) =>
              current.operation.kind === "reading" && current.operation.requestId === requestId
                ? {
                    source: current.source,
                    operation: { ...current.operation, progress: nextProgress },
                  }
                : current,
            );
          }
        }, controller.signal);
      } finally {
        access.dispose();
      }
    } catch (error) {
      // An abort is the caller's own doing, not a failure to report.
      if (fileImportIdRef.current !== requestId || controller.signal.aborted) {
        return;
      }

      reportDiagnostic("source.read", error);
      setState((current) =>
        current.operation.kind === "reading" && current.operation.requestId === requestId
          ? { source: current.source, operation: { kind: "idle" } }
          : current,
      );
      toast.error(t("input.readFailed"));
      return;
    }

    if (fileImportIdRef.current !== requestId || controller.signal.aborted) {
      return;
    }
    activeReadRef.current = null;

    publishSource(createImportedFileSourceRevision(nextSourceRevision(), file, text, sourceMode));
  };

  return {
    source: state.source,
    operation:
      state.operation.kind === "reading"
        ? {
            kind: state.operation.kind,
            file: state.operation.file,
            progress: state.operation.progress,
          }
        : state.operation,
    onSourceChange,
    onFileDrop,
  };
};
