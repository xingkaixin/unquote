import { useTranslation } from "../i18n/context";
import type { AgentSession, AgentSessionModel } from "../lib/agent-session";

export interface AgentFactsPaneProps {
  session: AgentSession;
  model: AgentSessionModel;
}

const metricItems = (
  session: AgentSession,
  model: AgentSessionModel,
  t: ReturnType<typeof useTranslation>["t"],
) => {
  const toolCount = model.conversation.filter(
    ({ item }) => item.role === "tool_call" || item.role === "tool_result",
  ).length;
  return [
    { label: t("agent.metric.events"), value: model.events.length },
    { label: t("agent.metric.messages"), value: model.conversation.length },
    { label: t("agent.metric.turns"), value: session.meta.turnCount },
    { label: t("agent.metric.tools"), value: toolCount },
  ];
};

const Chip = ({ children, tone }: { children: string; tone: string }) => (
  <span className={`rounded-xs border px-1.5 py-0.5 font-mono text-[10.5px] ${tone}`}>
    {children}
  </span>
);

export const AgentFactsPane = ({ session, model }: AgentFactsPaneProps) => {
  const { t } = useTranslation();
  const metrics = metricItems(session, model, t);
  const location = [session.meta.cwd, session.meta.version ? `v${session.meta.version}` : ""]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
      <span className="uq-label">{t("agent.overview")}</span>

      <div
        className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border"
        data-agent-metrics={metrics.length}
      >
        {metrics.map((item) => (
          <div key={item.label} className="flex flex-col gap-1.5 bg-surface-100 px-3 py-2.5">
            <span className="uq-label">{item.label}</span>
            <span className="font-mono text-[16px] text-text-primary">{item.value}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Chip tone="border-success text-success">{session.fileType}</Chip>
        {session.fileName ? (
          <Chip tone="border-border-medium text-text-secondary">{session.fileName}</Chip>
        ) : null}
        {session.parseWarnings.length > 0 ? (
          <Chip tone="border-error text-error">
            {t("agent.warnings", { count: session.parseWarnings.length })}
          </Chip>
        ) : null}
      </div>

      {session.meta.sessionId || location ? (
        <div className="flex flex-col gap-1.5">
          <span className="uq-label">{t("agent.sessionId")}</span>
          {session.meta.sessionId ? (
            <span className="break-all font-mono text-[11px] text-text-secondary">
              {session.meta.sessionId}
            </span>
          ) : null}
          {location ? (
            <span className="break-all font-mono text-[11px] text-text-secondary">{location}</span>
          ) : null}
        </div>
      ) : null}

      {session.meta.model ? (
        <div className="flex flex-col gap-1.5">
          <span className="uq-label">{t("agent.model")}</span>
          <span className="break-all font-mono text-[11px] text-text-secondary">
            {session.meta.model}
          </span>
        </div>
      ) : null}
    </div>
  );
};
