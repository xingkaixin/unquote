import {
  Activity,
  Braces,
  CaseSensitive,
  CircleAlert,
  Filter,
  MessageSquareText,
  Regex,
  Search,
  SearchCheck,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RecordFilterMode } from "../lib/tree";
import { resolveQueryMode } from "../lib/query-interaction";
import type { MessageKey } from "../i18n/i18n";
import { useTranslation } from "../i18n/context";
import { Button } from "./button";

interface CommandPaletteProps {
  open: boolean;
  inputValue: string;
  regex: boolean;
  caseSensitive: boolean;
  jq: boolean;
  matchCount: number;
  pathMatchCount: number;
  visibleCount: number;
  totalCount: number;
  filterMode: RecordFilterMode;
  onClose: () => void;
  onInputChange: (value: string) => void;
  onSearch: (value: string) => void;
  onJumpPath: (value: string) => void;
  onRegexChange: (value: boolean) => void;
  onCaseSensitiveChange: (value: boolean) => void;
  onJqChange: (value: boolean) => void;
  onFilterChange: (mode: RecordFilterMode) => void;
}

interface CommandAction {
  id: string;
  label: MessageKey;
  hint?: string;
  icon: typeof Search;
  active?: boolean;
  run: () => void;
}

const filterOptions: Array<{
  mode: RecordFilterMode;
  label: MessageKey;
  icon: typeof Search;
}> = [
  { mode: "all", label: "filter.all", icon: Filter },
  { mode: "matches", label: "filter.matches", icon: SearchCheck },
  { mode: "errors", label: "filter.errors", icon: CircleAlert },
  { mode: "nested", label: "filter.nested", icon: Sparkles },
  { mode: "tool", label: "filter.tools", icon: Wrench },
  { mode: "message", label: "filter.messages", icon: MessageSquareText },
  { mode: "events", label: "filter.events", icon: Activity },
];

export const CommandPalette = ({
  open,
  inputValue,
  regex,
  caseSensitive,
  jq,
  matchCount,
  pathMatchCount,
  visibleCount,
  totalCount,
  filterMode,
  onClose,
  onInputChange,
  onSearch,
  onJumpPath,
  onRegexChange,
  onCaseSensitiveChange,
  onJqChange,
  onFilterChange,
}: CommandPaletteProps) => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [commandQuery, setCommandQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const mode = resolveQueryMode(inputValue);

  useEffect(() => {
    if (!open) return;
    setCommandQuery("");
    setActiveIndex(0);
  }, [open]);

  const actions = useMemo<CommandAction[]>(
    () =>
      filterOptions.map((option) => ({
        id: `filter-${option.mode}`,
        label: option.label,
        icon: option.icon,
        active: filterMode === option.mode,
        run: () => onFilterChange(option.mode),
      })),
    [filterMode, onFilterChange],
  );

  const visibleActions = useMemo(() => {
    const query = commandQuery.trim().toLowerCase();
    if (!query) {
      return actions;
    }

    return actions.filter((action) => t(action.label).toLowerCase().includes(query));
  }, [actions, commandQuery, t]);

  useEffect(() => {
    setActiveIndex((current) =>
      visibleActions.length === 0 ? 0 : Math.min(current, visibleActions.length - 1),
    );
  }, [visibleActions.length]);

  const activeActionId = visibleActions[activeIndex]?.id;

  const runPrimary = () => {
    const value = inputValue.trim();
    if (!value) {
      visibleActions[activeIndex]?.run();
      onClose();
      return;
    }

    if (mode === "path") {
      onJumpPath(value);
    } else {
      onSearch(value);
    }
    onClose();
  };

  const runAction = (action: CommandAction) => {
    action.run();
    onClose();
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/35 backdrop-blur-sm dark:bg-black/65" />
        <Dialog.Viewport className="fixed inset-0 z-50 px-3 pt-[16vh]">
          <Dialog.Popup
            initialFocus={inputRef}
            className="mx-auto flex max-h-[76vh] w-full max-w-[540px] flex-col overflow-hidden rounded-[var(--radius-overlay)] border border-border-medium bg-surface-100 shadow-lg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <Dialog.Title className="sr-only">{t("command.palette")}</Dialog.Title>
            <div className="flex items-center gap-2 border-b border-border bg-surface-100 px-[18px] py-4">
              <Search className="size-4 shrink-0 text-text-muted" />
              <input
                ref={inputRef}
                role="combobox"
                aria-label={t("search.inputLabel")}
                aria-autocomplete="list"
                aria-expanded="true"
                aria-controls="command-action-list"
                aria-activedescendant={
                  activeActionId ? `command-action-${activeActionId}` : undefined
                }
                value={inputValue}
                onChange={(event) => onInputChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    runPrimary();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    onClose();
                  }
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActiveIndex((current) =>
                      visibleActions.length === 0 ? 0 : (current + 1) % visibleActions.length,
                    );
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActiveIndex((current) =>
                      visibleActions.length === 0
                        ? 0
                        : (current - 1 + visibleActions.length) % visibleActions.length,
                    );
                  }
                }}
                placeholder={t("command.placeholder")}
                className="min-w-0 flex-1 bg-transparent font-mono text-[12px] tracking-[0.04em] text-text-primary outline-none placeholder:text-text-muted"
              />
              <span className="shrink-0 bg-surface-200 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
                {t(mode === "path" ? "command.pathMode" : "command.searchMode")}
              </span>
              <Dialog.Close
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="uq-icon-button h-7 w-7 px-0"
                    aria-label={t("command.close")}
                  >
                    <X className="size-3.5" />
                  </Button>
                }
              />
            </div>
            <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-[18px] py-2">
              <span className="mr-1 font-mono text-[10px] text-text-muted">
                {mode === "path"
                  ? t("command.pathMatches", { count: pathMatchCount })
                  : t("command.searchMatches", { count: matchCount })}
              </span>
              <Button
                variant={jq ? "secondary" : "ghost"}
                size="sm"
                className="h-7 gap-1.5"
                onClick={() => onJqChange(!jq)}
              >
                <Braces className="size-3.5" />
                {t("search.jq")}
              </Button>
              <Button
                variant={regex ? "secondary" : "ghost"}
                size="sm"
                className="h-7 gap-1.5"
                onClick={() => onRegexChange(!regex)}
              >
                <Regex className="size-3.5" />
                {t("search.regex")}
              </Button>
              <Button
                variant={caseSensitive ? "secondary" : "ghost"}
                size="sm"
                className="h-7 gap-1.5"
                onClick={() => onCaseSensitiveChange(!caseSensitive)}
              >
                <CaseSensitive className="size-3.5" />
                {t("search.caseSensitive")}
              </Button>
              <Button variant="secondary" size="sm" className="ml-auto h-7" onClick={runPrimary}>
                {t(mode === "path" ? "path.jump" : "command.search")}
              </Button>
            </div>
            <div className="flex items-center gap-2 px-[18px] py-2">
              <span className="font-mono text-[10px] text-text-muted">
                {t("command.visibleRecords", { shown: visibleCount, total: totalCount })}
              </span>
              <input
                aria-label={t("command.filterCommands")}
                value={commandQuery}
                onChange={(event) => setCommandQuery(event.target.value)}
                placeholder={t("command.filterCommands")}
                className="ml-auto h-7 w-44 border border-border bg-surface-50 px-2 font-mono text-ui-11 text-text-primary outline-none placeholder:text-text-muted"
              />
            </div>
            <div
              id="command-action-list"
              role="listbox"
              aria-label={t("command.recordFilters")}
              className="min-h-0 overflow-y-auto px-2 pb-2"
            >
              {visibleActions.map((action, index) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.id}
                    id={`command-action-${action.id}`}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={index === activeIndex}
                    className={`flex w-full items-center gap-2 px-4 py-3 text-left font-mono text-ui-11 uppercase tracking-[0.08em] ${
                      index === activeIndex
                        ? "bg-surface-50 text-text-primary shadow-[inset_2px_0_0_var(--color-accent)]"
                        : "text-text-secondary"
                    } ${action.active ? "text-accent" : ""}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => runAction(action)}
                  >
                    <Icon className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{t(action.label)}</span>
                    {action.active ? (
                      <span className="font-mono text-[10px] text-accent">
                        {t("command.active")}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
