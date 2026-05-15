import {
  Activity,
  Bot,
  CircleAlert,
  Filter,
  MessageSquareText,
  SearchCheck,
  Sparkles,
  Tags,
  Wrench,
} from "lucide-react";
import type { RecordFilterMode } from "../lib/tree";
import { useTranslation } from "../i18n/context";
import { Button } from "./button";

interface RecordFilterBarProps {
  mode: RecordFilterMode;
  visibleCount: number;
  totalCount: number;
  insightQuery: string;
  onModeChange: (mode: RecordFilterMode) => void;
  onInsightQueryChange: (value: string) => void;
}

const filterOptions = [
  { mode: "all", label: "filter.all", icon: Filter },
  { mode: "matches", label: "filter.matches", icon: SearchCheck },
  { mode: "errors", label: "filter.errors", icon: CircleAlert },
  { mode: "nested", label: "filter.nested", icon: Sparkles },
  { mode: "tool", label: "filter.tools", icon: Wrench },
  { mode: "message", label: "filter.messages", icon: MessageSquareText },
  { mode: "events", label: "filter.events", icon: Activity },
] as const;

export const RecordFilterBar = ({
  mode,
  visibleCount,
  totalCount,
  insightQuery,
  onModeChange,
  onInsightQueryChange,
}: RecordFilterBarProps) => {
  const { t } = useTranslation();

  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-md border border-border bg-surface-100 px-2 py-1">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 font-mono text-[10px] text-text-muted">
          {visibleCount}/{totalCount}
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5 overflow-hidden">
          {filterOptions.map((option) => {
            const Icon = option.icon;
            const active = mode === option.mode;
            return (
              <Button
                key={option.mode}
                variant={active ? "secondary" : "ghost"}
                size="sm"
                className="h-6 min-w-0 gap-1 px-1.5 text-[11px]"
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
      <label
        className={`flex h-6 min-w-0 items-center gap-1.5 rounded-md border px-2 ${
          mode === "insight"
            ? "border-accent/50 bg-accent/10 text-accent"
            : "border-border bg-surface-50 text-text-muted"
        }`}
      >
        <Bot className="size-3 shrink-0" />
        <input
          value={insightQuery}
          onChange={(event) => onInsightQueryChange(event.target.value)}
          placeholder={t("filter.insightPlaceholder")}
          aria-label={t("filter.insightValue")}
          className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-text-primary outline-none placeholder:text-text-muted"
        />
        <Tags className="size-3 shrink-0" />
      </label>
    </div>
  );
};
