import { useEffect, useReducer, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "../i18n/context";
import { createLocalFileAccess, type LocalFileAccess } from "../lib/local-file-source";
import type { SourceRevision } from "../lib/source-revision";

const largeSourceStreamBytes = 1_000_000;

type SourceMode = "auto" | "json" | "jsonl";

type PublishedSourceState =
  | { kind: "text"; text: string }
  | { kind: "imported"; file: File; text: string }
  | { kind: "streaming"; access: LocalFileAccess };

type SourceState =
  | PublishedSourceState
  | {
      kind: "reading";
      file: File;
      progress: number | null;
      previousSource: PublishedSourceState;
    };

interface UseSourceLoaderParams {
  initialInput: string;
}

export const useSourceLoader = ({ initialInput }: UseSourceLoaderParams) => {
  const { t } = useTranslation();
  const [sourceState, setSourceState] = useState<SourceState>({ kind: "text", text: initialInput });
  const [mode, setMode] = useState<SourceMode>("auto");
  const modeRef = useRef<SourceMode>(mode);
  const [sourceRevision, incrementSourceRevision] = useReducer((value: number) => value + 1, 0);
  const sourceRevisionRef = useRef<SourceRevision>(sourceRevision);
  const fileImportIdRef = useRef(0);
  // The request id keeps a stale result from being committed; this stops the
  // work that produced it. A superseded read has no value, so it should not
  // keep decoding a large file in the background.
  const activeReadRef = useRef<AbortController | null>(null);
  const abortActiveRead = () => {
    activeReadRef.current?.abort();
    activeReadRef.current = null;
  };

  useEffect(() => () => abortActiveRead(), []);

  const publishedSource = sourceState.kind === "reading" ? sourceState.previousSource : sourceState;
  const sourceText =
    publishedSource.kind === "text" || publishedSource.kind === "imported"
      ? publishedSource.text
      : "";
  const sourceAccess = publishedSource.kind === "streaming" ? publishedSource.access : null;
  const readingFile = sourceState.kind === "reading" ? sourceState.file : null;
  const readProgress = sourceState.kind === "reading" ? sourceState.progress : null;
  const importedFile = sourceState.kind === "imported" ? sourceState.file : null;

  const shouldStreamFile = (file: File, sourceMode: SourceMode) =>
    file.size > largeSourceStreamBytes &&
    (sourceMode === "jsonl" ||
      (sourceMode === "auto" && file.name.toLowerCase().endsWith(".jsonl")));

  const publishSourceRevision = () => {
    sourceRevisionRef.current += 1;
    incrementSourceRevision();
    return sourceRevisionRef.current;
  };

  const publishStreamingFile = (file: File) => {
    setSourceState({ kind: "streaming", access: createLocalFileAccess(file) });
    publishSourceRevision();
  };

  const publishImportedFile = (file: File, text: string) => {
    setSourceState({ kind: "imported", file, text });
    publishSourceRevision();
  };

  const onSourceChange = (value: string) => {
    fileImportIdRef.current += 1;
    abortActiveRead();
    setSourceState({ kind: "text", text: value });
    return publishSourceRevision();
  };

  const onFileDrop = async (file: File) => {
    const requestId = fileImportIdRef.current + 1;
    fileImportIdRef.current = requestId;
    abortActiveRead();
    const controller = new AbortController();
    activeReadRef.current = controller;
    setSourceState({
      kind: "reading",
      file,
      progress: 0,
      previousSource: publishedSource,
    });

    if (shouldStreamFile(file, modeRef.current)) {
      publishStreamingFile(file);
      return;
    }

    let text: string;
    try {
      const access = createLocalFileAccess(file);
      text = await access.readText((nextProgress) => {
        if (fileImportIdRef.current === requestId) {
          setSourceState((prev) =>
            prev.kind === "reading" ? { ...prev, progress: nextProgress } : prev,
          );
        }
      }, controller.signal);
    } catch {
      // An abort is the caller's own doing, not a failure to report.
      if (fileImportIdRef.current !== requestId || controller.signal.aborted) {
        return;
      }

      setSourceState((prev) => (prev.kind === "reading" ? prev.previousSource : prev));
      toast.error(t("input.readFailed"));
      return;
    }

    if (fileImportIdRef.current !== requestId || controller.signal.aborted) {
      return;
    }
    activeReadRef.current = null;

    if (shouldStreamFile(file, modeRef.current)) {
      publishStreamingFile(file);
      return;
    }

    publishImportedFile(file, text);
  };

  const setSourceMode = (nextMode: SourceMode) => {
    if (modeRef.current === nextMode) {
      return;
    }

    modeRef.current = nextMode;
    setMode(nextMode);

    if (publishedSource.kind === "streaming") {
      const file = publishedSource.access.getFile();
      if (!shouldStreamFile(file, nextMode)) {
        void onFileDrop(file);
        return;
      }
    }

    if (publishedSource.kind === "imported" && shouldStreamFile(publishedSource.file, nextMode)) {
      fileImportIdRef.current += 1;
      abortActiveRead();
      publishStreamingFile(publishedSource.file);
      return;
    }

    publishSourceRevision();
  };

  return {
    mode,
    setMode: setSourceMode,
    sourceText,
    sourceAccess,
    readingFile,
    readProgress,
    importedFile,
    sourceRevision,
    onSourceChange,
    onFileDrop,
  };
};
