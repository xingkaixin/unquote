import type { MessageKey } from "../i18n/i18n";
import { useTranslation } from "../i18n/context";
import type { RecordFilterMode } from "../lib/record-filter";
import { Button } from "./button";

export interface RecordFilterBarProps {
  mode: RecordFilterMode;
  onChange: (mode: RecordFilterMode) => void;
  shown: number;
  total: number;
}

// `matches` and `errors` stay reachable from the command palette and the status
// bar's failed count, so the bar itself only carries the content-shape filters.
const barFilters: ReadonlyArray<{ mode: RecordFilterMode; label: MessageKey }> = [
  { mode: "all", label: "filter.all" },
  { mode: "tool", label: "filter.tools" },
  { mode: "message", label: "filter.messages" },
  { mode: "events", label: "filter.events" },
  { mode: "nested", label: "filter.nested" },
];

export const RecordFilterBar = ({ mode, onChange, shown, total }: RecordFilterBarProps) => {
  const { t } = useTranslation();

  return (
    <div className="flex h-[38px] shrink-0 items-center gap-2 border-b border-border bg-surface-50 px-3.5">
      {barFilters.map((filter) => (
        <Button
          key={filter.mode}
          type="button"
          variant={mode === filter.mode ? "selected" : "outline"}
          size="sm"
          className="h-6 rounded-sm px-2.5"
          aria-pressed={mode === filter.mode}
          onClick={() => onChange(filter.mode)}
        >
          {t(filter.label)}
        </Button>
      ))}
      <span className="flex-1" />
      <span className="shrink-0 font-mono text-[10.5px] text-text-tertiary">
        {t("filter.hint", { shown, total })}
      </span>
    </div>
  );
};
