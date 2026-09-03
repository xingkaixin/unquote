import CaretDownIcon from "@phosphor-icons/core/regular/caret-down.svg?react";
import CaretUpIcon from "@phosphor-icons/core/regular/caret-up.svg?react";
import MagnifyingGlassIcon from "@phosphor-icons/core/regular/magnifying-glass.svg?react";
import XIcon from "@phosphor-icons/core/regular/x.svg?react";
import { useRef } from "react";
import { useTranslation } from "../i18n/context";
import { Button } from "./button";

export interface SearchFieldProps {
  query: string;
  matchCount: number;
  currentMatchIndex: number;
  disabled: boolean;
  onQueryChange: (value: string) => void;
  onSubmitQuery: (value: string) => void;
  onClearQuery: () => void;
  onPrevMatch: () => void;
  onNextMatch: () => void;
}

export const SearchField = ({
  query,
  matchCount,
  currentMatchIndex,
  disabled,
  onQueryChange,
  onSubmitQuery,
  onClearQuery,
  onPrevMatch,
  onNextMatch,
}: SearchFieldProps) => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const hasQuery = query.trim().length > 0;
  const hasMatches = hasQuery && matchCount > 0;

  return (
    <form
      className="flex h-8 min-w-0 flex-1 items-center gap-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmitQuery(inputRef.current?.value ?? query);
      }}
    >
      <MagnifyingGlassIcon className="size-3.5 shrink-0 text-text-tertiary" />
      <input
        aria-label={t("search.inputLabel")}
        data-benchmark-action="search-input"
        ref={inputRef}
        type="text"
        value={query}
        disabled={disabled}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onSubmitQuery(event.currentTarget.value);
          }
        }}
        placeholder={t("command.placeholder")}
        className="uq-search min-w-0 flex-1 bg-transparent font-mono text-[12px] text-text-primary outline-none disabled:opacity-40"
      />
      {hasQuery ? (
        <button
          type="button"
          className="uq-icon-button inline-flex size-6 shrink-0 items-center justify-center rounded-xs text-text-tertiary hover:bg-surface-200 hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onClick={() => {
            onClearQuery();
            inputRef.current?.focus();
          }}
          aria-label={t("search.clear")}
        >
          <XIcon className="size-3" />
        </button>
      ) : null}
      {hasMatches ? (
        <span className="shrink-0 font-mono text-[10.5px] text-text-tertiary">
          {`${currentMatchIndex + 1}/${matchCount}`}
        </span>
      ) : null}
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="uq-icon-button h-6 w-6 rounded-xs px-0"
          onClick={onPrevMatch}
          disabled={!hasMatches}
          aria-label={t("search.prev")}
        >
          <CaretUpIcon className="size-3" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="uq-icon-button h-6 w-6 rounded-xs px-0"
          onClick={onNextMatch}
          disabled={!hasMatches}
          aria-label={t("search.next")}
        >
          <CaretDownIcon className="size-3" />
        </Button>
      </div>
    </form>
  );
};
