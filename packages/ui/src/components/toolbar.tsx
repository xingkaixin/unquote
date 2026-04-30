import { ClipboardCopy, RotateCcw, ScanSearch, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "../i18n/context";
import { Badge } from "./badge";
import { Button } from "./button";

interface ToolbarProps {
  detectedFormat: "json" | "jsonl";
  pathLabel: string;
  statsLabel: string;
  onCopyAll: () => void;
  onExpandAll: () => void;
  onRestoreAll: () => void;
  searchBar?: ReactNode;
}

export const Toolbar = ({
  detectedFormat,
  pathLabel,
  statsLabel,
  onCopyAll,
  onExpandAll,
  onRestoreAll,
  searchBar,
}: ToolbarProps) => {
  const { t } = useTranslation();
  return (
    <div className="sticky top-12 z-20 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-[var(--background)]/80 px-4 py-2 backdrop-blur-sm">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge className="border-transparent bg-[oklab(0.15_0_0)] text-white">{detectedFormat}</Badge>
        <Badge>{statsLabel}</Badge>
        <div className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-200 px-2.5 py-0.5">
          <ScanSearch className="size-3 text-text-muted" />
          <span className="font-mono text-[11px] text-text-secondary">{pathLabel}</span>
        </div>
      </div>
      {searchBar ? (
        <div className="min-w-0 flex-1 max-w-md">{searchBar}</div>
      ) : null}
      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="sm" onClick={onCopyAll}>
          <ClipboardCopy className="size-3.5" />
          {t("toolbar.copyAll")}
        </Button>
        <Button variant="secondary" size="sm" onClick={onExpandAll}>
          <Sparkles className="size-3.5" />
          {t("toolbar.expandAll")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onRestoreAll}>
          <RotateCcw className="size-3.5" />
          {t("toolbar.restoreAll")}
        </Button>
      </div>
    </div>
  );
};
