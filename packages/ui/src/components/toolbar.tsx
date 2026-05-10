import { Braces, ChevronDown, ClipboardCopy, List, RotateCcw, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "../i18n/context";
import { Button } from "./button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

interface ToolbarProps {
  onCopyJsonl: () => void;
  onCopyFormattedJson: () => void;
  onExpandAll: () => void;
  onRestoreAll: () => void;
  searchBar?: ReactNode;
}

export const Toolbar = ({
  onCopyJsonl,
  onCopyFormattedJson,
  onExpandAll,
  onRestoreAll,
  searchBar,
}: ToolbarProps) => {
  const { t } = useTranslation();
  return (
    <div className="sticky top-11 z-20 flex flex-wrap items-start justify-between gap-2 rounded-b-md border-x border-b border-border bg-[var(--background)]/80 px-4 py-2 shadow-sm backdrop-blur-md">
      {searchBar ? (
        <div className="min-w-[min(100%,520px)] flex-[1_1_720px]">{searchBar}</div>
      ) : null}
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5 text-[11px]">
              <ClipboardCopy className="size-3.5" />
              {t("toolbar.copy")}
              <ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="text-[12px]" onSelect={onCopyJsonl}>
              <List className="mr-2 size-3.5" />
              {t("toolbar.copyJsonl")}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-[12px]" onSelect={onCopyFormattedJson}>
              <Braces className="mr-2 size-3.5" />
              {t("toolbar.copyFormattedJson")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="secondary" size="sm" className="gap-1.5 text-[11px]" onClick={onExpandAll}>
          <Sparkles className="size-3.5" />
          {t("toolbar.expandAll")}
        </Button>
        <Button variant="ghost" size="sm" className="gap-1.5 text-[11px]" onClick={onRestoreAll}>
          <RotateCcw className="size-3.5" />
          {t("toolbar.restoreAll")}
        </Button>
      </div>
    </div>
  );
};
