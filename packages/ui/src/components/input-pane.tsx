import type { DragEvent } from "react";
import { ChevronDown, FileJson2, PanelLeftClose, PanelLeftOpen, Upload, X } from "lucide-react";
import { Button } from "./button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card";

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
  const handleDrop = (event: DragEvent<HTMLTextAreaElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file && onFileDrop) {
      onFileDrop(file);
    }
  };

  if (collapsed) {
    return (
      <Card className="flex h-full flex-col items-center gap-4 overflow-hidden border-zinc-900/10 bg-white px-2 py-4 shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
        <Button
          variant="outline"
          size="sm"
          className="h-9 w-9 rounded-full px-0"
          onClick={onToggleCollapse}
          aria-label="展开 source"
        >
          <PanelLeftOpen className="size-4" />
        </Button>
        <div className="flex min-h-0 flex-1 flex-col items-center gap-3 pt-2">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200 bg-zinc-50 text-zinc-500">
            <FileJson2 className="size-4" />
          </div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.32em] text-zinc-400 [writing-mode:vertical-rl]">
            Source
          </div>
          <div className="text-[10px] font-mono text-zinc-400 [writing-mode:vertical-rl]">
            {mode}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="flex shrink-0 flex-col overflow-hidden border-zinc-900/10 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-2">
            <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-400">
              <FileJson2 className="size-3.5" />
              Source
            </div>
            <CardTitle>输入工作台</CardTitle>
            <CardDescription>
              这里保留原始 JSON / JSONL。收起左侧后，右侧解析区会获得完整主视角。
            </CardDescription>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="relative">
              <select
                aria-label="format mode"
                value={mode}
                onChange={(event) => onModeChange(event.target.value as "auto" | "json" | "jsonl")}
                className="h-10 appearance-none rounded-full border border-zinc-300 bg-zinc-50 pl-4 pr-10 text-[13px] font-medium text-zinc-800 shadow-[0_1px_0_rgba(24,24,27,0.04)] outline-none transition-[box-shadow,border-color] hover:border-zinc-400 focus:border-zinc-400 focus:shadow-[0_0_0_4px_rgba(24,24,27,0.06)]"
              >
                <option value="auto">auto</option>
                <option value="json">json</option>
                <option value="jsonl">jsonl</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 rounded-full px-2"
              onClick={onToggleCollapse}
            >
              <PanelLeftClose className="size-4" />
              收起
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 bg-[linear-gradient(180deg,rgba(248,250,252,0.9),rgba(255,255,255,1))]">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onOpenFile}>
            <Upload className="size-4" />
            打开文件
          </Button>
          <Button variant="outline" size="sm" onClick={onClear}>
            <X className="size-4" />
            清空
          </Button>
        </div>
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
          spellCheck={false}
          className="h-[min(42vh,520px)] min-h-[320px] resize-none rounded-[24px] border border-zinc-200 bg-[#fffdf9] px-5 py-5 font-mono text-[13px] leading-6 text-zinc-900 outline-none shadow-inner"
          placeholder="粘贴 JSON / JSONL，或把文件拖到这里。"
        />
      </CardContent>
    </Card>
  );
};
