import { Braces, CaseSensitive, ChevronDown, ChevronUp, Regex, Search, X } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "../i18n/context";
import { Button } from "./button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

interface SearchBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  regex: boolean;
  onRegexChange: (regex: boolean) => void;
  caseSensitive: boolean;
  onCaseSensitiveChange: (caseSensitive: boolean) => void;
  jq: boolean;
  onJqChange: (jq: boolean) => void;
  matchCount: number;
  currentIndex: number;
  onPrev: () => void;
  onNext: () => void;
}

export const SearchBar = ({
  query,
  onQueryChange,
  regex,
  onRegexChange,
  caseSensitive,
  onCaseSensitiveChange,
  jq,
  onJqChange,
  matchCount,
  currentIndex,
  onPrev,
  onNext,
}: SearchBarProps) => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  const hasQuery = query.length > 0;
  const showNav = hasQuery && matchCount > 0;

  return (
    <div className="flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-surface-100 px-2 py-1">
      <Search className="size-3.5 shrink-0 text-text-muted" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder={t("search.placeholder")}
        className="min-w-0 flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-muted"
      />
      {hasQuery ? (
        <button
          type="button"
          onClick={() => {
            onQueryChange("");
            inputRef.current?.focus();
          }}
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-muted hover:bg-surface-300 hover:text-text-secondary"
          aria-label={t("search.clear")}
        >
          <X className="size-3" />
        </button>
      ) : null}
      {showNav ? (
        <>
          <span className="shrink-0 font-mono text-[11px] text-text-muted">
            {currentIndex + 1}/{matchCount}
          </span>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 px-0"
              onClick={onPrev}
              aria-label={t("search.prev")}
            >
              <ChevronUp className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 px-0"
              onClick={onNext}
              aria-label={t("search.next")}
            >
              <ChevronDown className="size-3" />
            </Button>
          </div>
        </>
      ) : null}
      <TooltipProvider>
        <div className="flex shrink-0 items-center gap-0.5 border-l border-border pl-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={jq ? "secondary" : "ghost"}
                size="sm"
                className="h-5 w-5 px-0"
                onClick={() => {
                  if (!jq) onRegexChange(false);
                  onJqChange(!jq);
                }}
                aria-label={t("search.jq")}
              >
                <Braces className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("search.jq")}</TooltipContent>
          </Tooltip>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 border-l border-border pl-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={regex ? "secondary" : "ghost"}
                size="sm"
                className="h-5 w-5 px-0"
                onClick={() => {
                  if (!regex) onJqChange(false);
                  onRegexChange(!regex);
                }}
                aria-label={t("search.regex")}
              >
                <Regex className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("search.regex")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={caseSensitive ? "secondary" : "ghost"}
                size="sm"
                className="h-5 w-5 px-0"
                onClick={() => onCaseSensitiveChange(!caseSensitive)}
                aria-label={t("search.caseSensitive")}
              >
                <CaseSensitive className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("search.caseSensitive")}</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </div>
  );
};
