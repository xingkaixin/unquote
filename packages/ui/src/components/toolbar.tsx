import { ClipboardCopy, RotateCcw, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "../i18n/context";
import { Button } from "./button";

interface ToolbarProps {
  onCopyAll: () => void;
  onExpandAll: () => void;
  onRestoreAll: () => void;
  searchBar?: ReactNode;
}

export const Toolbar = ({ onCopyAll, onExpandAll, onRestoreAll, searchBar }: ToolbarProps) => {
  const { t } = useTranslation();
  return (
    <div className="sticky top-11 z-20 flex flex-wrap items-center justify-between gap-2 rounded-b-md border-x border-b border-border bg-[var(--background)]/80 px-4 py-2 shadow-sm backdrop-blur-md">
      {searchBar ? <div className="min-w-0 flex-1 basis-[280px]">{searchBar}</div> : null}
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
