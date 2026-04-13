import { ClipboardCopy, RotateCcw, ScanSearch, Sparkles } from "lucide-react";
import { Badge } from "./badge";
import { Button } from "./button";
import { Card, CardContent } from "./card";

interface ToolbarProps {
  detectedFormat: "json" | "jsonl";
  pathLabel: string;
  statsLabel: string;
  onCopyAll: () => void;
  onExpandAll: () => void;
  onRestoreAll: () => void;
}

export const Toolbar = ({
  detectedFormat,
  pathLabel,
  statsLabel,
  onCopyAll,
  onExpandAll,
  onRestoreAll,
}: ToolbarProps) => (
  <Card className="sticky top-4 z-20 overflow-hidden border-zinc-900/10 bg-white/95 shadow-[0_14px_40px_rgba(15,23,42,0.08)] backdrop-blur">
    <CardContent className="flex flex-col gap-3 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge className="border-zinc-900/15 bg-zinc-900 text-white">{detectedFormat}</Badge>
          <Badge variant="default">{statsLabel}</Badge>
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-[11px] text-zinc-600">
            <ScanSearch className="size-3.5" />
            <span className="font-mono">{pathLabel}</span>
          </div>
        </div>
        <div className="hidden text-[11px] uppercase tracking-[0.24em] text-zinc-400 xl:block">
          local parse workspace
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={onCopyAll}>
          <ClipboardCopy className="size-4" />
          复制全部
        </Button>
        <Button variant="secondary" size="sm" onClick={onExpandAll}>
          <Sparkles className="size-4" />
          展开全部
        </Button>
        <Button variant="outline" size="sm" onClick={onRestoreAll}>
          <RotateCcw className="size-4" />
          还原全部
        </Button>
      </div>
    </CardContent>
  </Card>
);
