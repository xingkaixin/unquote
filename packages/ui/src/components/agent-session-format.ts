import BrainIcon from "@phosphor-icons/core/regular/brain.svg?react";
import FileCodeIcon from "@phosphor-icons/core/regular/file-code.svg?react";
import RobotIcon from "@phosphor-icons/core/regular/robot.svg?react";
import TerminalWindowIcon from "@phosphor-icons/core/regular/terminal-window.svg?react";
import UserIcon from "@phosphor-icons/core/regular/user.svg?react";
import WrenchIcon from "@phosphor-icons/core/regular/wrench.svg?react";
import type { ComponentType } from "react";
import type { useTranslation } from "../i18n/context";
import type { Locale, MessageKey } from "../i18n/i18n";
import type {
  AgentConversationRole,
  AgentEventCategory,
  AgentParseWarningKind,
} from "../lib/agent-session";

const timestampFormatters: Record<Locale, Intl.DateTimeFormat> = {
  en: new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "medium" }),
  "zh-CN": new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "medium" }),
  ja: new Intl.DateTimeFormat("ja", { dateStyle: "medium", timeStyle: "medium" }),
};

export const agentParseWarningMessageKey: Record<AgentParseWarningKind, MessageKey> = {
  "invalid-json": "agent.warning.invalidJson",
  "projection-failed": "agent.warning.projectionFailed",
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
      return { label: t("agent.role.user"), icon: UserIcon };
    case "assistant":
      return { label: t("agent.role.assistant"), icon: RobotIcon };
    case "thinking":
      return { label: t("agent.role.thinking"), icon: BrainIcon };
    case "tool_call":
      return { label: t("agent.role.toolCall"), icon: WrenchIcon };
    case "tool_result":
      return { label: t("agent.role.toolResult"), icon: TerminalWindowIcon };
    case "system":
      return { label: t("agent.role.system"), icon: FileCodeIcon };
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
