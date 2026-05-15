import type { ChangeEvent, ClipboardEvent, DragEvent } from "react";
import { useRef, useState } from "react";
import { ChevronDown, FileJson2, PanelLeftClose, PanelLeftOpen, Upload, X } from "lucide-react";
import { useTranslation } from "../i18n/context";
import { cn } from "../lib/utils";
import { Button } from "./button";
import { Card, CardContent } from "./card";

interface InputPaneProps {
  value: string;
  mode: "auto" | "json" | "jsonl";
  onChange: (value: string) => void;
  onModeChange: (mode: "auto" | "json" | "jsonl") => void;
  onOpenFile?: () => void;
  onFileDrop?: (file: File) => void;
  onClear: () => void;
  onToggleCollapse?: () => void;
  collapsed?: boolean;
  sourceStatus?: string | undefined;
  sourceBusy?: boolean | undefined;
  sourceProgress?: number | null | undefined;
  sourceError?: SourceParseError | null | undefined;
}

export interface SourceParseError {
  message: string;
  line: number;
  column: number;
  context: string;
  format: string;
}

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

export const InputPane = ({
  value,
  mode,
  onChange,
  onModeChange,
  onOpenFile,
  onFileDrop,
  onClear,
  onToggleCollapse,
  collapsed = false,
  sourceStatus,
  sourceBusy = false,
  sourceProgress = null,
  sourceError = null,
}: InputPaneProps) => {
  const { t } = useTranslation();
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetDragState = () => {
    dragDepth.current = 0;
    setIsDraggingFile(false);
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!onFileDrop || !isPotentialFileDrag(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    dragDepth.current += 1;
    setIsDraggingFile(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!onFileDrop || !isPotentialFileDrag(event.dataTransfer)) {
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
    if (!onFileDrop || !isPotentialFileDrag(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    resetDragState();
    const file = getTransferFile(event.dataTransfer);
    if (file) {
      onFileDrop(file);
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!onFileDrop) {
      return;
    }

    const file = getTransferFile(event.clipboardData);
    if (file) {
      event.preventDefault();
      onFileDrop(file);
      return;
    }

    const pastedFileName = getPastedFileName(event.clipboardData.getData("text/plain").trim());
    if (!hasFileType(event.clipboardData) && !pastedFileName) {
      return;
    }

    event.preventDefault();
    void readClipboardFile(pastedFileName ?? "clipboard.json")
      .then((clipboardFile) => {
        if (clipboardFile) {
          onFileDrop(clipboardFile);
        }
      })
      .catch(() => undefined);
  };

  const handleOpenFile = () => {
    if (onFileDrop) {
      fileInputRef.current?.click();
      return;
    }

    onOpenFile?.();
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) {
      onFileDrop?.(file);
    }
  };

  const progressPercent =
    typeof sourceProgress === "number"
      ? Math.max(0, Math.min(100, Math.round(sourceProgress * 100)))
      : null;

  const dropTargetProps = {
    onDragEnter: handleDragEnter,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDragEnd: resetDragState,
    onDrop: handleDrop,
  };
  const showSourcePreview = Boolean(!value && sourceStatus && !isDraggingFile);

  if (collapsed) {
    return (
      <Card
        className={cn(
          "relative flex h-full flex-col items-center gap-4 overflow-hidden px-2 py-4 transition-[background-color,border-color,box-shadow]",
          isDraggingFile && "border-accent bg-surface-200 shadow-md",
        )}
        {...dropTargetProps}
      >
        <Button
          variant="outline"
          size="sm"
          className="h-9 w-9 rounded-full px-0"
          onClick={onToggleCollapse}
          aria-label={t("input.expandSource")}
        >
          <PanelLeftOpen className="size-4" />
        </Button>
        <div className="flex min-h-0 flex-1 flex-col items-center gap-3 pt-2">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border bg-surface-200 text-text-secondary">
            <FileJson2 className="size-4" />
          </div>
          <div className="text-[11px] font-medium uppercase tracking-[0.24em] text-text-muted [writing-mode:vertical-rl]">
            Source
          </div>
          <div className="font-mono text-[10px] text-text-muted [writing-mode:vertical-rl]">
            {mode}
          </div>
        </div>
        {isDraggingFile ? (
          <div className="pointer-events-none absolute inset-1 flex flex-col items-center justify-center gap-2 rounded-md border border-accent bg-[color-mix(in_oklab,var(--color-accent)_12%,transparent)] px-2 text-center text-accent">
            <Upload className="size-4" />
            <span className="text-[10px] font-semibold leading-4">{t("input.dropActive")}</span>
          </div>
        ) : null}
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        "flex shrink-0 flex-col overflow-hidden transition-[background-color,border-color,box-shadow]",
        isDraggingFile && "border-accent shadow-md",
      )}
      {...dropTargetProps}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <FileJson2 className="size-3.5 text-text-secondary" />
          <span className="text-[13px] font-medium text-text-primary">Source</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" className="h-7 w-7 px-0" onClick={handleOpenFile}>
            <Upload className="size-3.5" />
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.jsonl,application/json,text/plain"
            className="sr-only"
            tabIndex={-1}
            onChange={handleFileInputChange}
          />
          <Button variant="ghost" size="sm" className="h-7 w-7 px-0" onClick={onClear}>
            <X className="size-3.5" />
          </Button>
          <div className="relative">
            <select
              aria-label="format mode"
              value={mode}
              onChange={(event) => onModeChange(event.target.value as "auto" | "json" | "jsonl")}
              className="h-7 appearance-none rounded-md border border-border bg-surface-200 pl-3 pr-8 text-[12px] font-medium text-text-primary outline-none hover:bg-surface-300 focus:border-border-medium"
            >
              <option value="auto">auto</option>
              <option value="json">json</option>
              <option value="jsonl">jsonl</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
          </div>
          <Button variant="ghost" size="sm" className="h-7 w-7 px-0" onClick={onToggleCollapse}>
            <PanelLeftClose className="size-3.5" />
          </Button>
        </div>
      </div>
      <CardContent
        className={cn(
          "bg-surface-50 transition-colors",
          isDraggingFile &&
            "bg-[color-mix(in_oklab,var(--color-accent)_6%,var(--color-surface-50))]",
        )}
      >
        {sourceStatus ? (
          <div
            className="mb-2 flex min-h-7 items-center justify-between gap-3 rounded-md border border-border bg-surface-100 px-3 py-1.5 text-[12px] text-text-secondary"
            aria-live="polite"
          >
            <span className="min-w-0 truncate">{sourceStatus}</span>
            {sourceBusy ? (
              <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-surface-300">
                <span
                  className={cn(
                    "block h-full rounded-full bg-accent transition-[width] duration-150",
                    progressPercent === null && "w-1/2 animate-pulse",
                  )}
                  style={progressPercent === null ? undefined : { width: `${progressPercent}%` }}
                />
              </span>
            ) : null}
          </div>
        ) : null}
        {sourceError ? (
          <div
            className="mb-2 flex flex-col gap-2 rounded-md border border-error/30 bg-[rgba(207,45,86,0.06)] px-3 py-2 text-[12px]"
            aria-live="polite"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-error">{t("input.parseErrorTitle")}</span>
              <span className="font-mono text-[11px] text-text-secondary">
                {t("input.parseErrorMode", { format: sourceError.format })}
              </span>
              <span className="font-mono text-[11px] text-text-secondary">
                {t("error.location", { line: sourceError.line, column: sourceError.column })}
              </span>
            </div>
            <div className="min-w-0 break-words font-mono text-[11px] text-text-secondary">
              {t("error.message", { message: sourceError.message })}
            </div>
            <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-surface-50 px-2 py-1.5 font-mono text-[11px] leading-5 text-text-secondary">
              {sourceError.context}
            </pre>
          </div>
        ) : null}
        <div className="relative">
          <textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onPaste={handlePaste}
            spellCheck={false}
            className={cn(
              "h-[min(42vh,520px)] min-h-[320px] w-full resize-none rounded-md border border-border bg-surface-50 px-4 py-4 font-mono text-[13px] leading-6 text-text-primary outline-none transition-[background-color,border-color,box-shadow]",
              isDraggingFile &&
                "border-accent bg-surface-100 shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-accent)_18%,transparent)]",
            )}
            placeholder={t("input.placeholder")}
          />
          {isDraggingFile ? (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-md border border-accent bg-[color-mix(in_oklab,var(--color-accent)_10%,var(--color-surface-50))] text-accent shadow-sm">
              <Upload className="size-5" />
              <div className="text-[13px] font-semibold">{t("input.dropActive")}</div>
              <div className="text-[11px] text-text-secondary">{t("input.dropHint")}</div>
            </div>
          ) : showSourcePreview ? (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-md border border-border bg-surface-50 px-6 text-center">
              <FileJson2 className="size-5 text-accent" />
              <div className="max-w-full truncate text-[13px] font-semibold text-text-primary">
                {sourceStatus}
              </div>
              <div className="text-[11px] text-text-secondary">{t("input.filePreviewHint")}</div>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
};
