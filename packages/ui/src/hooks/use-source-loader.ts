import { useCallback, useReducer, useRef, useState } from "react";
import type { JsonlRecord } from "@unquote/core";
import { toast } from "sonner";
import { useTranslation } from "../i18n/context";
import { createLocalFileAccess, type LocalFileAccess } from "../lib/local-file-source";
import type { SourceRevision } from "../lib/source-revision";
import { useCopyToClipboard } from "./use-copy-to-clipboard";

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
  onRequestOpenFile?:
    | (() => Promise<File | string | null> | File | string | null | void)
    | undefined;
  onCollapseSource: () => void;
}

export const useSourceLoader = ({
  initialInput,
  onRequestOpenFile,
  onCollapseSource,
}: UseSourceLoaderParams) => {
  const { t } = useTranslation();
  const copyToClipboard = useCopyToClipboard();
  const [sourceState, setSourceState] = useState<SourceState>({ kind: "text", text: initialInput });
  const [mode, setMode] = useState<SourceMode>("auto");
  const modeRef = useRef<SourceMode>(mode);
  const [sourceRevision, incrementSourceRevision] = useReducer((value: number) => value + 1, 0);
  const sourceRevisionRef = useRef<SourceRevision>(sourceRevision);
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
  sourceAccessRef.current = sourceAccess;

  const shouldStreamFile = (file: File, sourceMode: SourceMode) =>
    file.size > largeSourceCollapseBytes &&
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
    onCollapseSource();
  };

  const publishImportedFile = (file: File, text: string) => {
    setSourceState({ kind: "imported", file, text });
    publishSourceRevision();
    if (text.length > largeSourceCollapseBytes) {
      onCollapseSource();
    }
  };

  const onSourceChange = (value: string) => {
    fileImportIdRef.current += 1;
    setSourceState({ kind: "text", text: value });
    const nextRevision = publishSourceRevision();
    if (value.length > largeSourceCollapseBytes) {
      onCollapseSource();
    }
    return nextRevision;
  };

  const onFileDrop = async (file: File) => {
    const requestId = fileImportIdRef.current + 1;
    fileImportIdRef.current = requestId;
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
      });
    } catch {
      if (fileImportIdRef.current !== requestId) {
        return;
      }

      setSourceState((prev) => (prev.kind === "reading" ? prev.previousSource : prev));
      toast.error(t("input.readFailed"));
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

    publishSourceRevision();
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

  const onCopyRawLine = useCallback(
    async (record: JsonlRecord) => {
      let text = record.status === "failed" ? record.rawLine : record.summary;
      const currentAccess = sourceAccessRef.current;
      if (currentAccess) {
        try {
          text = await currentAccess.readRecordText(record);
        } catch {
          toast.error(t("input.readFailed"));
          return;
        }
      }

      await copyToClipboard(text);
    },
    [copyToClipboard, t],
  );

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
