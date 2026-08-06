import { Bot, Brain, FileJson, TerminalSquare, UserRound, Wrench } from "lucide-react";
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
}

export const roleConfig = (
  role: AgentConversationRole,
  t: ReturnType<typeof useTranslation>["t"],
): RoleConfig => {
  switch (role) {
    case "user":
      return { label: t("agent.role.user"), icon: UserRound };
    case "assistant":
      return { label: t("agent.role.assistant"), icon: Bot };
    case "thinking":
      return { label: t("agent.role.thinking"), icon: Brain };
    case "tool_call":
      return { label: t("agent.role.toolCall"), icon: Wrench };
    case "tool_result":
      return { label: t("agent.role.toolResult"), icon: TerminalSquare };
    case "system":
      return { label: t("agent.role.system"), icon: FileJson };
  }
};

export interface CategoryConfig {
  label: string;
  dot: string;
}

export const categoryConfig = (
  category: AgentEventCategory,
  t: ReturnType<typeof useTranslation>["t"],
): CategoryConfig => {
  switch (category) {
    case "user":
      return { label: t("agent.category.user"), dot: "var(--dot-message)" };
    case "assistant":
      return { label: t("agent.category.assistant"), dot: "var(--dot-message)" };
    case "thinking":
      return { label: t("agent.category.thinking"), dot: "var(--dot-message)" };
    case "tool":
      return { label: t("agent.category.tool"), dot: "var(--dot-tool)" };
    case "system":
      return { label: t("agent.category.system"), dot: "var(--dot-event)" };
    case "meta":
      return { label: t("agent.category.meta"), dot: "var(--dot-event)" };
    case "unknown":
      return { label: t("agent.category.unknown"), dot: "var(--dot-error)" };
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

export const formatEventMeta = (
  line: number,
  time: string,
  turnIndex: number | undefined,
  t: ReturnType<typeof useTranslation>["t"],
) =>
  [
    t("agent.line", { line }),
    time,
    turnIndex === undefined ? "" : t("agent.turn", { turn: turnIndex }),
  ]
    .filter(Boolean)
    .join(" · ");
