import { useReducer, useRef, useState } from "react";
import type { JsonlRecord } from "@unquote/core";
import { writeClipboardText } from "../lib/clipboard";
import { readFileText, readJsonlRecordsByLine } from "../lib/local-file-source";
import { getCopyValue } from "../lib/record-export";

const largeSourceCollapseBytes = 1_000_000;

type SourceMode = "auto" | "json" | "jsonl";

type SourceState =
  | { kind: "text"; text: string }
  | { kind: "reading"; file: File; progress: number | null; prevText: string }
  | { kind: "imported"; file: File; text: string }
  | { kind: "streaming"; file: File };

interface UseSourceLoaderParams {
  initialInput: string;
  onReadFile?: ((file: File) => Promise<string>) | undefined;
  onRequestOpenFile?:
    | (() => Promise<File | string | null> | File | string | null | void)
    | undefined;
  // Reset source-scoped workspace state before publishing the new source.
  // Query state observes sourceRevision because its pipeline is initialized
  // downstream from this hook.
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

  const sourceText =
    sourceState.kind === "text" || sourceState.kind === "imported"
      ? sourceState.text
      : sourceState.kind === "reading"
        ? sourceState.prevText
        : "";
  const sourceFile = sourceState.kind === "streaming" ? sourceState.file : null;
  const readingFile = sourceState.kind === "reading" ? sourceState.file : null;
  const readProgress = sourceState.kind === "reading" ? sourceState.progress : null;
  const importedFile = sourceState.kind === "imported" ? sourceState.file : null;

  const shouldStreamFile = (file: File, sourceMode: SourceMode) =>
    file.size > largeSourceCollapseBytes &&
    (sourceMode === "jsonl" ||
      (sourceMode === "auto" && file.name.toLowerCase().endsWith(".jsonl")));

  const publishStreamingFile = (file: File) => {
    setSourceState({ kind: "streaming", file });
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
    const prevText = sourceText;
    setSourceState({ kind: "reading", file, progress: onReadFile ? null : 0, prevText });

    if (shouldStreamFile(file, modeRef.current)) {
      publishStreamingFile(file);
      return;
    }

    let text: string;
    try {
      text = onReadFile
        ? await onReadFile(file)
        : await readFileText(file, (nextProgress) => {
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

      setSourceState((prev) =>
        prev.kind === "reading" ? { kind: "text", text: prev.prevText } : prev,
      );
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
    modeRef.current = nextMode;
    setMode(nextMode);

    if (sourceState.kind === "streaming" && !shouldStreamFile(sourceState.file, nextMode)) {
      void onFileDrop(sourceState.file);
      return;
    }

    if (sourceState.kind === "imported" && shouldStreamFile(sourceState.file, nextMode)) {
      fileImportIdRef.current += 1;
      publishStreamingFile(sourceState.file);
    }
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

  const onCopyRawLine = async (record: JsonlRecord) => {
    let text = record.rawLine ?? record.errorMeta?.rawLine ?? record.summary;
    if (sourceFile) {
      let fullRecord: JsonlRecord | undefined;
      try {
        const fullRecords = await readJsonlRecordsByLine(sourceFile, new Set([record.lineNumber]));
        fullRecord = fullRecords.get(record.lineNumber);
      } catch (error) {
        // Deferred records only carry a summary, so don't fall back to copying it.
        onError(error);
        return;
      }
      if (fullRecord?.node) {
        text = JSON.stringify(getCopyValue(fullRecord));
      } else if (fullRecord?.rawLine) {
        text = fullRecord.rawLine;
      }
    }

    if (!(await writeClipboardText(text))) {
      onCopyError();
    }
  };

  return {
    mode,
    setMode: setSourceMode,
    sourceText,
    sourceFile,
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
