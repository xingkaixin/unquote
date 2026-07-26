import type { ComponentType } from "react";
import {
  Activity,
  Bot,
  CircleAlert,
  Clock3,
  Layers,
  MessageSquareText,
  Route,
  Sparkles,
  Tags,
  UserRound,
  Wrench,
} from "lucide-react";
import type { MessageKey } from "../i18n/i18n";
import { useTranslation } from "../i18n/context";
import type { RecordInsight } from "../lib/record-insight";
import { Badge } from "./badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

interface RecordInsightSummaryProps {
  insight: RecordInsight;
  compact?: boolean;
}

interface InsightChip {
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  variant?: "default" | "warning" | "success" | "danger";
  className?: string;
}

const kindConfig: Record<
  RecordInsight["kind"],
  {
    label: MessageKey;
    icon: ComponentType<{ className?: string }>;
    variant: "default" | "warning" | "success" | "danger";
  }
> = {
  error: { label: "insight.kind.error", icon: CircleAlert, variant: "danger" },
  tool: { label: "insight.kind.tool", icon: Wrench, variant: "warning" },
  message: { label: "insight.kind.message", icon: MessageSquareText, variant: "default" },
  event: { label: "insight.kind.event", icon: Activity, variant: "default" },
};

export const RecordInsightSummary = ({ insight, compact = false }: RecordInsightSummaryProps) => {
  const { t } = useTranslation();
  const kind = kindConfig[insight.kind];
  const KindIcon = kind.icon;
  const chips: InsightChip[] = [];

  if (insight.timestamp) {
    chips.push({ key: "timestamp", label: insight.timestamp, icon: Clock3 });
  }
  if (insight.level) {
    chips.push({ key: "level", label: insight.level, icon: Tags });
  }
  if (insight.status) {
    chips.push({ key: "status", label: insight.status, icon: Tags });
  }
  if (insight.role) {
    chips.push({ key: "role", label: insight.role, icon: UserRound });
  }
  if (insight.event) {
    chips.push({ key: "event", label: insight.event, icon: Activity });
  }
  if (insight.tool) {
    chips.push({ key: "tool", label: insight.tool, icon: Wrench, variant: "warning" });
  }
  if (insight.error) {
    chips.push({ key: "error", label: insight.error, icon: CircleAlert, variant: "danger" });
  }
  if (!compact && insight.message) {
    chips.push({ key: "message", label: insight.message, icon: MessageSquareText });
  }
  if (insight.nestedJsonCount > 0) {
    chips.push({
      key: "nested",
      label: t("insight.nested", { count: insight.nestedJsonCount }),
      icon: Sparkles,
      variant: "warning",
    });
  }
  if (!compact && insight.maxDepth > 0) {
    chips.push({
      key: "depth",
      label: t("insight.depth", { depth: insight.maxDepth }),
      icon: Layers,
    });
  }
  if (!compact && insight.keyPathCount > 0) {
    chips.push({
      key: "paths",
      label: t("insight.paths", { count: insight.keyPathCount }),
      icon: Route,
    });
  }

  const visibleChips = compact ? chips.slice(0, 4) : chips;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <Badge variant={kind.variant} className="max-w-full shrink-0">
        <KindIcon className="mr-1 size-3 shrink-0" />
        {t(kind.label)}
      </Badge>
      {visibleChips.map((chip) => {
        const Icon = chip.icon;
        return (
          <Tooltip key={chip.key}>
            <TooltipTrigger
              render={
                <Badge
                  variant={chip.variant}
                  className={`max-w-full min-w-0 gap-1 ${chip.className ?? ""}`}
                >
                  <Icon className="size-3 shrink-0" />
                  <span className="min-w-0 truncate">{chip.label}</span>
                </Badge>
              }
            />
            <TooltipContent>{chip.label}</TooltipContent>
          </Tooltip>
        );
      })}
      {compact && chips.length > visibleChips.length ? (
        <Badge>
          <Bot className="mr-1 size-3" />
          {t("insight.more", { count: chips.length - visibleChips.length })}
        </Badge>
      ) : null}
    </div>
  );
};
