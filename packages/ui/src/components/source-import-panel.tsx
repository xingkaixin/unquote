import type { ChangeEvent, ClipboardEvent, DragEvent, KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FileJson2 } from "lucide-react";
import { useTranslation } from "../i18n/context";
import { cn } from "../lib/utils";
import { detectSourceFormat } from "../lib/source-detect";
import type { SourceDetection } from "../lib/source-detect";
import type { SourceCandidate, SourceMode } from "../lib/source-candidate";
import { Button } from "./button";

export interface SourceSampleOption {
  id: string;
  label: string;
  value: string;
  expandedPathsByRecord: readonly { recordId: string; paths: readonly string[] }[];
}

interface SourceImportPanelProps {
  initialDraft: string;
  initialFile: File | null;
  initialMode: SourceMode;
  onCommit: (candidate: SourceCandidate) => void;
  samples: readonly SourceSampleOption[];
  onSampleSelect: (sample: SourceSampleOption) => void;
  textareaClassName: string;
}

const modeOptions: readonly SourceMode[] = ["auto", "json", "jsonl"];

const transferTypes = (dataTransfer: DataTransfer) => Array.from(dataTransfer.types);

const hasFileType = (dataTransfer: DataTransfer) =>
  transferTypes(dataTransfer).some((type) => {
    const normalized = type.toLowerCase();
    return normalized === "files" || normalized.includes("file");
  });

const hasTransferFile = (dataTransfer: DataTransfer) =>
  dataTransfer.files.length > 0 ||
  Array.from(dataTransfer.items).some((item) => item.kind === "file") ||
  hasFileType(dataTransfer);

const isPotentialFileDrag = (dataTransfer: DataTransfer) =>
  hasTransferFile(dataTransfer) || transferTypes(dataTransfer).length === 0;

const getTransferFile = (dataTransfer: DataTransfer) => {
  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind !== "file") {
      continue;
    }

    const file = item.getAsFile();
    if (file) {
      return file;
    }
  }

  return dataTransfer.files[0] ?? null;
};

const pastedFileNamePattern = /(?:^|[/\\])([^/\\]+\.(?:json|jsonl|txt))$/i;

const getPastedFileName = (text: string) => {
  const match = pastedFileNamePattern.exec(text);
  return match?.[1] ?? null;
};

const looksLikeJsonSource = (text: string) => {
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
};

const readClipboardFile = async (name: string) => {
  if (typeof navigator.clipboard?.read !== "function") {
    return null;
  }

  const items = await navigator.clipboard.read();
  for (const item of items) {
    for (const type of item.types) {
      const normalized = type.toLowerCase();
      if (!normalized.includes("json") && !normalized.startsWith("text/")) {
        continue;
      }

      const blob = await item.getType(type);
      const text = await blob.text();
      if (!looksLikeJsonSource(text)) {
        continue;
      }

      return new File([text], name, { type });
    }
  }

  return null;
};

const detectionHint = (
  detection: SourceDetection,
  t: ReturnType<typeof useTranslation>["t"],
): string => {
  switch (detection.kind) {
    case "empty":
      return t("input.detectWaiting");
    case "json":
      return t("input.detectJson");
    case "jsonl":
      return t(detection.precision === "exact" ? "input.detectJsonl" : "input.detectJsonlAtLeast", {
        lines: detection.lines,
      });
    case "invalid":
      return t("input.detectInvalid");
  }
};

export const SourceImportPanel = ({
  initialDraft,
  initialFile,
  initialMode,
  onCommit,
  samples,
  onSampleSelect,
  textareaClassName,
}: SourceImportPanelProps) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initialDraft);
  const [mode, setMode] = useState(initialMode);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const candidateAcquisitionGeneration = useRef(0);
  const detection = useMemo(() => detectSourceFormat(draft), [draft]);

  useEffect(
    () => () => {
      candidateAcquisitionGeneration.current += 1;
    },
    [],
  );

  const invalidateCandidateAcquisition = () => {
    candidateAcquisitionGeneration.current += 1;
  };

  const beginCandidateAcquisition = () => {
    invalidateCandidateAcquisition();
    return candidateAcquisitionGeneration.current;
  };

  const commitCandidate = (candidate: SourceCandidate) => {
    invalidateCandidateAcquisition();
    onCommit(candidate);
  };

  const resetDragState = () => {
    dragDepth.current = 0;
    setIsDraggingFile(false);
  };

  const commitFile = (file: File) => {
    commitCandidate({ kind: "file", file, mode });
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!isPotentialFileDrag(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    dragDepth.current += 1;
    setIsDraggingFile(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!isPotentialFileDrag(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!isDraggingFile && !isPotentialFileDrag(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) {
      setIsDraggingFile(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!isPotentialFileDrag(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    invalidateCandidateAcquisition();
    resetDragState();
    const file = getTransferFile(event.dataTransfer);
    if (file) {
      commitFile(file);
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const acquisitionGeneration = beginCandidateAcquisition();
    const file = getTransferFile(event.clipboardData);
    if (file) {
      event.preventDefault();
      commitFile(file);
      return;
    }

    const pastedFileName = getPastedFileName(event.clipboardData.getData("text/plain").trim());
    if (!hasFileType(event.clipboardData) && !pastedFileName) {
      return;
    }

    void readClipboardFile(pastedFileName ?? "clipboard.json")
      .then((clipboardFile) => {
        if (clipboardFile && acquisitionGeneration === candidateAcquisitionGeneration.current) {
          commitCandidate({ kind: "file", file: clipboardFile, mode });
        }
      })
      .catch(() => undefined);
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    invalidateCandidateAcquisition();
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) {
      commitFile(file);
    }
  };

  const commitDraft = () => {
    if (initialFile && draft === initialDraft) {
      commitFile(initialFile);
      return;
    }

    if (draft.trim()) {
      commitCandidate({ kind: "text", text: draft, mode });
    }
  };

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    invalidateCandidateAcquisition();
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      commitDraft();
    }
  };

  return (
    <div className="flex flex-col gap-3.5">
      <div
        className={cn(
          "flex flex-col gap-3 rounded-lg border border-dashed p-4 transition-[background-color,border-color]",
          isDraggingFile ? "border-accent bg-accent-soft" : "border-border-medium bg-surface-50",
        )}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDragEnd={resetDragState}
        onDrop={handleDrop}
      >
        <div className="flex items-center gap-2.5">
          <span className={cn("uq-label", isDraggingFile && "text-accent")}>
            {t(isDraggingFile ? "input.dropRelease" : "input.dropIdle")}
          </span>
          <span className="flex-1" />
          <span className="font-mono text-[10.5px] text-text-tertiary" translate="no">
            {t("input.acceptedTypes")}
          </span>
        </div>
        <textarea
          aria-label={t("input.sourceLabel")}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onPaste={handlePaste}
          onKeyDown={handleTextareaKeyDown}
          spellCheck={false}
          placeholder={t("input.placeholder")}
          className={cn(
            "uq-area w-full resize-none rounded-md border border-border bg-surface-100 p-3 font-mono text-[12px] leading-5 text-text-primary outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            textareaClassName,
          )}
        />
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            type="button"
            variant="outline"
            className="h-8 px-3.5 text-[11px]"
            onClick={() => {
              invalidateCandidateAcquisition();
              fileInputRef.current?.click();
            }}
          >
            {t("input.chooseFile")}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            data-benchmark-action="source-file-input"
            accept=".json,.jsonl,application/json,text/plain"
            className="sr-only"
            tabIndex={-1}
            onChange={handleFileInputChange}
          />
          <span className="flex-1" />
          <span
            className={cn(
              "font-mono text-[11px]",
              detection.kind === "invalid" ? "text-error" : "text-text-tertiary",
            )}
          >
            {detectionHint(detection, t)}
          </span>
          <Button
            type="button"
            variant="secondary"
            className="h-8 px-4 text-[11px]"
            onClick={commitDraft}
            disabled={!initialFile && detection.kind === "empty"}
          >
            {t("import.parse")}
          </Button>
        </div>
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label={t("samples.ariaLabel")}
        >
          <span className="uq-label mr-0.5">{t("samples.label")}</span>
          {samples.map((sample) => (
            <Button
              key={sample.id}
              type="button"
              variant="outline"
              size="sm"
              className="rounded-sm px-2.5 text-[10px]"
              onClick={() => {
                invalidateCandidateAcquisition();
                onSampleSelect(sample);
              }}
            >
              <FileJson2 className="size-3" />
              <span>{sample.label}</span>
            </Button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="uq-label">{t("import.formatLabel")}</span>
        <div className="flex items-center gap-1.5" role="group" aria-label={t("input.modeLabel")}>
          {modeOptions.map((option) => (
            <Button
              key={option}
              type="button"
              variant={mode === option ? "selected" : "outline"}
              size="sm"
              className="rounded-sm px-2.5 font-mono"
              aria-pressed={mode === option}
              translate={option === "auto" ? undefined : "no"}
              onClick={() => {
                invalidateCandidateAcquisition();
                setMode(option);
              }}
            >
              {t(`input.mode.${option}`)}
            </Button>
          ))}
        </div>
        <span className="flex-1" />
        <span className="text-[11.5px] text-text-tertiary">{t("import.formatHint")}</span>
      </div>
    </div>
  );
};
