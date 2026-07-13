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
  Search,
  X,
} from "lucide-react";
import { useRef, type ReactNode } from "react";
import { useTranslation } from "../i18n/context";
import { Button } from "./button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

interface ToolbarProps {
  leading?: ReactNode;
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
}

export const Toolbar = ({
  leading,
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
}: ToolbarProps) => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const shortcut = navigator.platform.toLowerCase().includes("mac") ? "⌘K" : "Ctrl K";
  const hasQuery = query.trim().length > 0;
  const hasMatches = hasQuery && matchCount > 0;

  return (
    <div className="uq-glass sticky top-[52px] z-20 flex items-center gap-2 border-b border-border px-4 py-2">
      {leading}
      <form
        className="flex h-[34px] min-w-0 flex-1 items-center gap-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmitQuery(inputRef.current?.value ?? query);
        }}
      >
        <Search className="size-3.5 shrink-0 text-text-muted" />
        <input
          aria-label={t("search.inputLabel")}
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
          className="uq-search min-w-0 flex-1 bg-transparent font-mono text-[11.5px] text-text-primary outline-none placeholder:text-text-muted"
        />
        {hasQuery ? (
          <button
            type="button"
            className="uq-icon-button inline-flex size-5 shrink-0 items-center justify-center text-text-muted hover:bg-surface-200 hover:text-text-display focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onClick={() => {
              onClearQuery();
              inputRef.current?.focus();
            }}
            aria-label={t("search.clear")}
          >
            <X className="size-3" />
          </button>
        ) : null}
        <span className="max-w-[42vw] shrink-0 truncate font-mono text-[10px] text-text-muted sm:max-w-64">
          {hasMatches ? `${currentMatchIndex + 1}/${matchCount}` : summary}
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="uq-icon-button h-5 w-5 px-0"
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
            className="uq-icon-button h-5 w-5 px-0"
            onClick={onNextMatch}
            disabled={!hasMatches}
            aria-label={t("search.next")}
          >
            <ChevronDown className="size-3" />
          </Button>
        </div>
      </form>
      <div className="flex shrink-0 items-center gap-1 border-l border-border pl-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-[34px] gap-1.5 px-3"
          onClick={onOpenCommandPalette}
          title={`${t("command.open")} · ${shortcut}`}
        >
          <PanelTopOpen className="size-3.5" />
          <span className="hidden sm:inline">{t("command.openShort")}</span>
        </Button>
        <Button
          variant={hasExpandedStringified ? "secondary" : "default"}
          size="sm"
          className="h-[34px] gap-1.5 px-3"
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
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="uq-icon-button size-[34px] px-0"
                aria-label={t("toolbar.more")}
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="text-[11px]" onClick={onCopyJsonl}>
              <List className="mr-2 size-3.5" />
              {t("toolbar.copyJsonl")}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-[11px]" onClick={onCopyFormattedJson}>
              <ClipboardCopy className="mr-2 size-3.5" />
              {t("toolbar.copyFormattedJson")}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-[11px]" onClick={onExportJsonl}>
              <Download className="mr-2 size-3.5" />
              {t("toolbar.exportJsonl")}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-[11px]" onClick={onExportFormattedJson}>
              <Braces className="mr-2 size-3.5" />
              {t("toolbar.exportJson")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};
