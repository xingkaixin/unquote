import {
  Bot,
  Brain,
  CircleAlert,
  FileJson,
  Hash,
  TerminalSquare,
  UserRound,
  Wrench,
} from "lucide-react";
import type { ComponentType } from "react";
import type { useTranslation } from "../i18n/context";
import type { Locale } from "../i18n/i18n";
import type { AgentConversationRole, AgentEventCategory } from "../lib/agent-session";

const timestampFormatters: Record<Locale, Intl.DateTimeFormat> = {
  en: new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "medium" }),
  "zh-CN": new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "medium" }),
};

export interface RoleConfig {
  label: string;
  icon: ComponentType<{ className?: string }>;
  variant: "default" | "warning" | "success" | "danger";
  align: "start" | "end";
}

export const roleConfig = (
  role: AgentConversationRole,
  t: ReturnType<typeof useTranslation>["t"],
): RoleConfig => {
  switch (role) {
    case "user":
      return { label: t("agent.role.user"), icon: UserRound, variant: "default", align: "end" };
    case "assistant":
      return { label: t("agent.role.assistant"), icon: Bot, variant: "default", align: "start" };
    case "thinking":
      return { label: t("agent.role.thinking"), icon: Brain, variant: "default", align: "start" };
    case "tool_call":
      return { label: t("agent.role.toolCall"), icon: Wrench, variant: "warning", align: "start" };
    case "tool_result":
      return {
        label: t("agent.role.toolResult"),
        icon: TerminalSquare,
        variant: "warning",
        align: "start",
      };
    case "system":
      return { label: t("agent.role.system"), icon: FileJson, variant: "default", align: "start" };
  }
};

export const categoryConfig = (
  category: AgentEventCategory,
  t: ReturnType<typeof useTranslation>["t"],
) => {
  switch (category) {
    case "user":
      return { label: t("agent.category.user"), icon: UserRound, tone: "text-text-secondary" };
    case "assistant":
      return { label: t("agent.category.assistant"), icon: Bot, tone: "text-text-secondary" };
    case "thinking":
      return { label: t("agent.category.thinking"), icon: Brain, tone: "text-text-secondary" };
    case "tool":
      return { label: t("agent.category.tool"), icon: Wrench, tone: "text-warning" };
    case "system":
      return { label: t("agent.category.system"), icon: FileJson, tone: "text-text-muted" };
    case "meta":
      return { label: t("agent.category.meta"), icon: Hash, tone: "text-text-muted" };
    case "unknown":
      return { label: t("agent.category.unknown"), icon: CircleAlert, tone: "text-error" };
  }
};

export const formatTimestamp = (
  timestamp: number | undefined,
  timestampLabel: string | undefined,
  locale: Locale,
) => {
  const date = new Date(timestamp ?? timestampLabel ?? Number.NaN);
  if (Number.isNaN(date.getTime())) {
    return timestampLabel ?? "";
  }
  return timestampFormatters[locale].format(date);
};
