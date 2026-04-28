import type { DragEvent } from "react";
import { ChevronDown, FileJson2, PanelLeftClose, PanelLeftOpen, Upload, X } from "lucide-react";
import { useTranslation } from "../i18n/context";
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
}

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
}: InputPaneProps) => {
  const { t } = useTranslation();
  const handleDrop = (event: DragEvent<HTMLTextAreaElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file && onFileDrop) {
      onFileDrop(file);
    }
  };

  if (collapsed) {
    return (
      <Card className="flex h-full flex-col items-center gap-4 overflow-hidden px-2 py-4">
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
      </Card>
    );
  }

  return (
    <Card className="flex shrink-0 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <FileJson2 className="size-3.5 text-text-secondary" />
          <span className="text-[13px] font-medium text-text-primary">Source</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" className="h-7 w-7 px-0" onClick={onOpenFile}>
            <Upload className="size-3.5" />
          </Button>
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
      <CardContent className="bg-surface-50">
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
          spellCheck={false}
          className="h-[min(42vh,520px)] min-h-[320px] w-full resize-none rounded-md border border-border bg-surface-50 px-4 py-4 font-mono text-[13px] leading-6 text-text-primary outline-none"
          placeholder={t("input.placeholder")}
        />
      </CardContent>
    </Card>
  );
};
