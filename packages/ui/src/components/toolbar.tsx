import {
  Braces,
  ChevronDown,
  ChevronUp,
  ChevronsDownUp,
  ChevronsUpDown,
  ClipboardCopy,
  Download,
  List,
  MoreHorizontal,
  PanelTopOpen,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "../i18n/context";
import { Button } from "./button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

interface ToolbarProps {
  summary: string;
  query: string;
  matchCount: number;
  currentMatchIndex: number;
  onQueryChange: (value: string) => void;
  onSubmitQuery: (value: string) => void;
  onPrevMatch: () => void;
  onNextMatch: () => void;
  onClearQuery: () => void;
  onOpenCommandPalette: () => void;
  onCopyJsonl: () => void;
  onCopyFormattedJson: () => void;
  onExportJsonl: () => void;
  onExportFormattedJson: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  hasExpandedStringified: boolean;
  onRestoreAll: () => void;
}

export const Toolbar = ({
  summary,
  query,
  matchCount,
  currentMatchIndex,
  onQueryChange,
  onSubmitQuery,
  onPrevMatch,
  onNextMatch,
  onClearQuery,
  onOpenCommandPalette,
  onCopyJsonl,
  onCopyFormattedJson,
  onExportJsonl,
  onExportFormattedJson,
  onExpandAll,
  onCollapseAll,
  hasExpandedStringified,
  onRestoreAll,
}: ToolbarProps) => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const shortcut = navigator.platform.toLowerCase().includes("mac") ? "⌘K" : "Ctrl K";
  const hasQuery = query.trim().length > 0;
  const hasMatches = hasQuery && matchCount > 0;

  return (
    <div className="sticky top-11 z-20 flex items-center justify-between gap-2 border-x border-b border-border bg-[var(--background)]/85 px-4 py-2 shadow-sm backdrop-blur-md">
      <form
        className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-surface-100 px-2.5 shadow-sm focus-within:border-border-medium"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmitQuery(inputRef.current?.value ?? query);
        }}
      >
        <Search className="size-3.5 shrink-0 text-text-muted" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSubmitQuery(event.currentTarget.value);
            }
          }}
          placeholder={t("command.placeholder")}
          className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-text-primary outline-none placeholder:font-sans placeholder:text-text-muted"
        />
        {hasQuery ? (
          <button
            type="button"
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-text-muted hover:bg-surface-300 hover:text-text-primary"
            onClick={() => {
              onClearQuery();
              inputRef.current?.focus();
            }}
            aria-label={t("search.clear")}
          >
            <X className="size-3" />
          </button>
        ) : null}
        <span className="shrink-0 font-mono text-[10px] text-text-muted">
          {hasMatches ? `${currentMatchIndex + 1}/${matchCount}` : summary}
        </span>
        <div className="flex shrink-0 items-center gap-0.5 border-l border-border pl-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-5 w-5 px-0"
            onClick={onPrevMatch}
            disabled={!hasMatches}
            aria-label={t("search.prev")}
          >
            <ChevronUp className="size-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-5 w-5 px-0"
            onClick={onNextMatch}
            disabled={!hasMatches}
            aria-label={t("search.next")}
          >
            <ChevronDown className="size-3" />
          </Button>
        </div>
      </form>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5"
          onClick={onOpenCommandPalette}
          title={`${t("command.open")} · ${shortcut}`}
        >
          <PanelTopOpen className="size-3.5" />
          <span className="hidden sm:inline">{t("command.openShort")}</span>
        </Button>
        <Button
          variant="default"
          size="sm"
          className="gap-1.5"
          onClick={hasExpandedStringified ? onCollapseAll : onExpandAll}
          aria-pressed={hasExpandedStringified}
        >
          {hasExpandedStringified ? (
            <ChevronsDownUp className="size-3.5" />
          ) : (
            <ChevronsUpDown className="size-3.5" />
          )}
          <span className="hidden sm:inline">
            {t(hasExpandedStringified ? "toolbar.collapseAll" : "toolbar.expandAll")}
          </span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 px-0"
              aria-label={t("toolbar.more")}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="text-[11px]" onSelect={onCopyJsonl}>
              <List className="mr-2 size-3.5" />
              {t("toolbar.copyJsonl")}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-[11px]" onSelect={onCopyFormattedJson}>
              <ClipboardCopy className="mr-2 size-3.5" />
              {t("toolbar.copyFormattedJson")}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-[11px]" onSelect={onExportJsonl}>
              <Download className="mr-2 size-3.5" />
              {t("toolbar.exportJsonl")}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-[11px]" onSelect={onExportFormattedJson}>
              <Braces className="mr-2 size-3.5" />
              {t("toolbar.exportJson")}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-[11px]" onSelect={onRestoreAll}>
              <RotateCcw className="mr-2 size-3.5" />
              {t("toolbar.restoreAll")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};
