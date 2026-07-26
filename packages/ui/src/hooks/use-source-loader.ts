import { useCallback, useReducer, useRef, useState } from "react";
import type { JsonlRecord } from "@unquote/core";
import { writeClipboardText } from "../lib/clipboard";
import { createLocalFileAccess, type LocalFileAccess } from "../lib/local-file-source";

const largeSourceCollapseBytes = 1_000_000;

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
  onReadFile?: ((file: File) => Promise<string>) | undefined;
  onRequestOpenFile?:
    | (() => Promise<File | string | null> | File | string | null | void)
    | undefined;
  // Reset source-scoped workspace state before publishing the new source.
  onReset: () => void;
  onCollapseSource: () => void;
  // Called when a file read fails, so the caller can surface it (e.g. a toast).
  // The hook does not rethrow — InputPane invokes onFileDrop fire-and-forget,
  // so a throw here would become an unhandled rejection with no user feedback.
  onError: (error: unknown) => void;
  // Called when a clipboard write fails (permission denied / document unfocused).
  onCopyError: () => void;
}

export const useSourceLoader = ({
  initialInput,
  onReadFile,
  onRequestOpenFile,
  onReset,
  onCollapseSource,
  onError,
  onCopyError,
}: UseSourceLoaderParams) => {
  const [sourceState, setSourceState] = useState<SourceState>({ kind: "text", text: initialInput });
  const [mode, setMode] = useState<SourceMode>("auto");
  const modeRef = useRef<SourceMode>(mode);
  const [sourceRevision, incrementSourceRevision] = useReducer((value: number) => value + 1, 0);
  const fileImportIdRef = useRef(0);

  const publishedSource = sourceState.kind === "reading" ? sourceState.previousSource : sourceState;
  const sourceText =
    publishedSource.kind === "text" || publishedSource.kind === "imported"
      ? publishedSource.text
      : "";
  const sourceAccess = publishedSource.kind === "streaming" ? publishedSource.access : null;
  const readingFile = sourceState.kind === "reading" ? sourceState.file : null;
  const readProgress = sourceState.kind === "reading" ? sourceState.progress : null;
  const importedFile = sourceState.kind === "imported" ? sourceState.file : null;
  const sourceAccessRef = useRef(sourceAccess);
  const onErrorRef = useRef(onError);
  const onCopyErrorRef = useRef(onCopyError);
  sourceAccessRef.current = sourceAccess;
  onErrorRef.current = onError;
  onCopyErrorRef.current = onCopyError;

  const shouldStreamFile = (file: File, sourceMode: SourceMode) =>
    file.size > largeSourceCollapseBytes &&
    (sourceMode === "jsonl" ||
      (sourceMode === "auto" && file.name.toLowerCase().endsWith(".jsonl")));

  const publishStreamingFile = (file: File) => {
    setSourceState({ kind: "streaming", access: createLocalFileAccess(file) });
    onReset();
    incrementSourceRevision();
    onCollapseSource();
  };

  const publishImportedFile = (file: File, text: string) => {
    setSourceState({ kind: "imported", file, text });
    onReset();
    incrementSourceRevision();
    if (text.length > largeSourceCollapseBytes) {
      onCollapseSource();
    }
  };

  const onSourceChange = (value: string) => {
    fileImportIdRef.current += 1;
    setSourceState({ kind: "text", text: value });
    onReset();
    incrementSourceRevision();
    if (value.length > largeSourceCollapseBytes) {
      onCollapseSource();
    }
  };

  const onFileDrop = async (file: File) => {
    const requestId = fileImportIdRef.current + 1;
    fileImportIdRef.current = requestId;
    setSourceState({
      kind: "reading",
      file,
      progress: onReadFile ? null : 0,
      previousSource: publishedSource,
    });

    if (shouldStreamFile(file, modeRef.current)) {
      publishStreamingFile(file);
      return;
    }

    let text: string;
    try {
      const access = createLocalFileAccess(file);
      text = onReadFile
        ? await onReadFile(file)
        : await access.readText((nextProgress) => {
            if (fileImportIdRef.current === requestId) {
              setSourceState((prev) =>
                prev.kind === "reading" ? { ...prev, progress: nextProgress } : prev,
              );
            }
          });
    } catch (error) {
      if (fileImportIdRef.current !== requestId) {
        return;
      }

      setSourceState((prev) => (prev.kind === "reading" ? prev.previousSource : prev));
      onError(error);
      return;
    }

    if (fileImportIdRef.current !== requestId) {
      return;
    }

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
      publishStreamingFile(publishedSource.file);
      return;
    }

    onReset();
    incrementSourceRevision();
  };

  const onOpenFile = async () => {
    const source = await onRequestOpenFile?.();
    if (source instanceof File) {
      await onFileDrop(source);
      return;
    }

    if (typeof source === "string") {
      onSourceChange(source);
    }
  };

  const onCopyRawLine = useCallback(async (record: JsonlRecord) => {
    let text = record.status === "failed" ? record.rawLine : record.summary;
    const currentAccess = sourceAccessRef.current;
    if (currentAccess) {
      try {
        text = await currentAccess.readRecordText(record);
      } catch (error) {
        onErrorRef.current(error);
        return;
      }
    }

    if (!(await writeClipboardText(text))) {
      onCopyErrorRef.current();
    }
  }, []);

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
    onOpenFile,
    onCopyRawLine,
  };
};
