import CaretDownIcon from "@phosphor-icons/core/regular/caret-down.svg?react";
import CaretUpIcon from "@phosphor-icons/core/regular/caret-up.svg?react";
import MagnifyingGlassIcon from "@phosphor-icons/core/regular/magnifying-glass.svg?react";
import XIcon from "@phosphor-icons/core/regular/x.svg?react";
import { useRef } from "react";
import { useTranslation } from "../i18n/context";
import type { SearchStatus } from "../lib/search-lifecycle";
import { Button } from "./button";

export interface SearchFieldProps {
  query: string;
  matchCount: number;
  currentMatchIndex: number;
  disabled: boolean;
  searchStatus?: SearchStatus;
  errorLabel?: string | null;
  regex?: boolean;
  jq?: boolean;
  caseSensitive?: boolean;
  onQueryChange: (value: string) => void;
  onSubmitQuery: (value: string) => void;
  onClearQuery: () => void;
  onPrevMatch: () => void;
  onNextMatch: () => void;
}

const badgeClass =
  "shrink-0 rounded-xs border border-border bg-surface-200 px-1 py-0.5 font-mono text-[10px] leading-none text-text-secondary";

export const SearchField = ({
  query,
  matchCount,
  currentMatchIndex,
  disabled,
  searchStatus,
  errorLabel = null,
  regex = false,
  jq = false,
  caseSensitive = false,
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
  const showZeroMatches =
    hasQuery && !errorLabel && searchStatus === "complete" && matchCount === 0;

  return (
    <form
      className="flex min-h-8 min-w-0 flex-1 items-center gap-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent"
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
            const canStepMatches =
              hasMatches &&
              !errorLabel &&
              searchStatus !== "pending" &&
              event.currentTarget.value === query;
            if (canStepMatches) {
              if (event.shiftKey) {
                onPrevMatch();
              } else {
                onNextMatch();
              }
              return;
            }
            onSubmitQuery(event.currentTarget.value);
          }
        }}
        placeholder={t("command.placeholder")}
        className="uq-search min-w-0 flex-1 bg-transparent font-mono text-[12px] text-text-primary outline-none disabled:opacity-40"
      />
      {jq ? (
        <span className={badgeClass} title={t("search.jq")}>
          jq
        </span>
      ) : null}
      {regex ? (
        <span className={badgeClass} title={t("search.regex")}>
          .*
        </span>
      ) : null}
      {caseSensitive ? (
        <span className={badgeClass} title={t("search.caseSensitive")}>
          Aa
        </span>
      ) : null}
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
      {hasQuery && errorLabel ? (
        <span role="status" className="shrink-0 font-mono text-[10.5px] text-error">
          {errorLabel}
        </span>
      ) : hasQuery && searchStatus === "pending" ? (
        <span role="status" className="shrink-0 font-mono text-[10.5px] text-text-tertiary">
          {t("search.searching")}
        </span>
      ) : hasMatches ? (
        <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-text-tertiary">
          {`${currentMatchIndex + 1}/${matchCount}`}
        </span>
      ) : showZeroMatches ? (
        <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-text-tertiary">
          0/0
        </span>
      ) : null}
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          radius="xs"
          className="uq-icon-button"
          onClick={onPrevMatch}
          disabled={!hasMatches}
          aria-label={t("search.prev")}
        >
          <CaretUpIcon className="size-3" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          radius="xs"
          className="uq-icon-button"
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
