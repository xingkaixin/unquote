import XIcon from "@phosphor-icons/core/regular/x.svg?react";
import type { MessageKey } from "../i18n/i18n";
import { useTranslation } from "../i18n/context";
import type { NestedFilterScope, RecordFilterMode } from "../lib/record-filter";
import { Button } from "./button";

export interface RecordFilterBarProps {
  mode: RecordFilterMode;
  onChange: (mode: RecordFilterMode) => void;
  shown: number;
  total: number;
  nestedScope: NestedFilterScope;
}

// `matches` and `errors` stay reachable from the command palette and the status
// bar's failed count; show an active chip here only while one of them is active.
const barFilters: ReadonlyArray<{ mode: RecordFilterMode; label: MessageKey }> = [
  { mode: "all", label: "filter.all" },
  { mode: "tool", label: "filter.tools" },
  { mode: "message", label: "filter.messages" },
  { mode: "events", label: "filter.events" },
  { mode: "nested", label: "filter.nested" },
];

export const RecordFilterBar = ({
  mode,
  onChange,
  shown,
  total,
  nestedScope,
}: RecordFilterBarProps) => {
  const { t } = useTranslation();
  const activeExtraFilter =
    mode === "errors"
      ? ({ mode: "errors", label: "filter.errors" } as const)
      : mode === "matches"
        ? ({ mode: "matches", label: "filter.matches" } as const)
        : null;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface-50 px-3.5 py-1">
      <div className="flex min-w-0 basis-full items-center gap-2 overflow-x-auto py-0.5 sm:flex-1">
        {barFilters.map((filter) => {
          const label =
            filter.mode === "nested" && nestedScope === "top-level"
              ? "filter.nestedTopLevel"
              : filter.label;
          return (
            <Button
              key={filter.mode}
              type="button"
              variant={mode === filter.mode ? "selected" : "outline"}
              size="xs"
              radius="sm"
              className="shrink-0 whitespace-nowrap"
              aria-pressed={mode === filter.mode}
              onClick={() => onChange(filter.mode)}
            >
              {t(label)}
            </Button>
          );
        })}
        {activeExtraFilter ? (
          <Button
            key={activeExtraFilter.mode}
            type="button"
            variant="selected"
            size="xs"
            radius="sm"
            className="shrink-0 whitespace-nowrap"
            aria-pressed
            onClick={() => onChange("all")}
          >
            {t(activeExtraFilter.label)}
            <XIcon className="size-3" aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      <span className="shrink-0 whitespace-nowrap font-mono text-[10.5px] text-text-tertiary">
        {t("filter.hint", { shown, total })}
      </span>
    </div>
  );
};
