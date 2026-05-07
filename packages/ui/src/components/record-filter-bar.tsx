import { CircleAlert, Filter, SearchCheck, Sparkles } from "lucide-react";
import type { RecordFilterMode } from "../lib/tree";
import { useTranslation } from "../i18n/context";
import { Button } from "./button";

interface RecordFilterBarProps {
  mode: RecordFilterMode;
  visibleCount: number;
  totalCount: number;
  onModeChange: (mode: RecordFilterMode) => void;
}

const filterOptions = [
  { mode: "all", label: "filter.all", icon: Filter },
  { mode: "matches", label: "filter.matches", icon: SearchCheck },
  { mode: "errors", label: "filter.errors", icon: CircleAlert },
  { mode: "nested", label: "filter.nested", icon: Sparkles },
] as const;

export const RecordFilterBar = ({
  mode,
  visibleCount,
  totalCount,
  onModeChange,
}: RecordFilterBarProps) => {
  const { t } = useTranslation();

  return (
    <div className="flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-surface-100 px-2 py-1">
      <span className="shrink-0 font-mono text-[10px] text-text-muted">
        {visibleCount}/{totalCount}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
        {filterOptions.map((option) => {
          const Icon = option.icon;
          const active = mode === option.mode;
          return (
            <Button
              key={option.mode}
              variant={active ? "secondary" : "ghost"}
              size="sm"
              className="h-6 min-w-0 flex-1 gap-1 px-1.5 text-[11px]"
              onClick={() => onModeChange(option.mode)}
              aria-pressed={active}
            >
              <Icon className="size-3" />
              <span className="truncate">{t(option.label)}</span>
            </Button>
          );
        })}
      </div>
    </div>
  );
};
