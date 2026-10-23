import type { ComponentProps } from "react";
import { useTranslation } from "../i18n/context";
import type { Locale } from "../i18n/i18n";
import type {
  AgentSession,
  AgentSessionModel,
  AgentSessionReportedTotals,
} from "../lib/agent-session";
import { agentParseWarningMessageKey } from "./agent-session-format";
import { formatTrajectoryDuration } from "./agent-trajectory-format";
import { Button } from "./button";

export interface AgentFactsPaneProps {
  session: AgentSession;
  model: AgentSessionModel;
  onOpenRecord: (recordId: string) => void;
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
    { label: t("agent.metric.turns"), value: model.turnCount },
    { label: t("agent.metric.tools"), value: toolCount },
  ];
};

// Sub-dollar costs keep four decimals so a cheap session does not read as $0.00.
const formatCostUSD = (value: number, locale: Locale) =>
  new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: value > 0.5 ? 2 : 4,
  }).format(value);

const reportedItems = (
  totals: AgentSessionReportedTotals,
  locale: Locale,
  t: ReturnType<typeof useTranslation>["t"],
) => {
  const count = new Intl.NumberFormat(locale);
  const items: { label: string; value: string }[] = [];
  if (totals.costUSD !== undefined) {
    items.push({ label: t("agent.reported.cost"), value: formatCostUSD(totals.costUSD, locale) });
  }
  if (totals.linesAdded !== undefined && totals.linesRemoved !== undefined) {
    items.push({
      label: t("agent.reported.lines"),
      value: `+${count.format(totals.linesAdded)} −${count.format(totals.linesRemoved)}`,
    });
  }
  if (totals.apiDurationMs !== undefined) {
    items.push({
      label: t("agent.reported.apiTime"),
      value: formatTrajectoryDuration(totals.apiDurationMs, locale),
    });
  }
  if (totals.toolDurationMs !== undefined) {
    items.push({
      label: t("agent.reported.toolTime"),
      value: formatTrajectoryDuration(totals.toolDurationMs, locale),
    });
  }
  return items;
};

const MetricGrid = ({
  items,
  ...props
}: ComponentProps<"div"> & { items: { label: string; value: string | number }[] }) => (
  <div
    className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border"
    {...props}
  >
    {items.map((item) => (
      <div key={item.label} className="flex flex-col gap-1.5 bg-surface-100 px-3 py-2.5">
        <span className="uq-label">{item.label}</span>
        <span className="font-mono text-[16px] text-text-primary">{item.value}</span>
      </div>
    ))}
  </div>
);

const Chip = ({ children, tone }: { children: string; tone: string }) => (
  <span className={`rounded-xs border px-1.5 py-0.5 font-mono text-[10.5px] ${tone}`}>
    {children}
  </span>
);

export const AgentFactsPane = ({ session, model, onOpenRecord }: AgentFactsPaneProps) => {
  const { locale, t } = useTranslation();
  const metrics = metricItems(session, model, t);
  const totals = session.meta.reportedTotals;
  const reported = totals ? reportedItems(totals, locale, t) : [];
  const hiddenWarningCount = Math.max(0, session.parseWarningCount - session.parseWarnings.length);
  const location = [session.meta.cwd, session.meta.version ? `v${session.meta.version}` : ""]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
      <h2 className="uq-label m-0">{t("agent.overview")}</h2>

      {session.meta.title ? (
        <p className="m-0 break-words text-[13px] text-text-primary">{session.meta.title}</p>
      ) : null}

      <MetricGrid items={metrics} data-agent-metrics={metrics.length} />

      {reported.length > 0 ? (
        <section className="flex flex-col gap-2" aria-labelledby="agent-reported-title">
          <h3 id="agent-reported-title" className="uq-label m-0">
            {t("agent.reported", { agent: session.fileType })}
          </h3>
          <MetricGrid items={reported} data-agent-reported={reported.length} />
          {totals?.hasUnknownModelCost ? (
            <p className="m-0 text-[11px] text-text-secondary">
              {t("agent.reported.unknownModelCost")}
            </p>
          ) : null}
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        <Chip tone="border-success text-success">{session.fileType}</Chip>
        {session.fileName ? (
          <Chip tone="border-border-medium text-text-secondary">{session.fileName}</Chip>
        ) : null}
        {session.parseWarningCount > 0 ? (
          <Chip tone="border-error text-error">
            {t("agent.warnings", { count: session.parseWarningCount })}
          </Chip>
        ) : null}
      </div>

      {session.parseWarningCount > 0 ? (
        <section className="flex flex-col gap-2" aria-labelledby="agent-parse-warning-title">
          <h3 id="agent-parse-warning-title" className="uq-label m-0">
            {t("agent.warning.title")}
          </h3>
          {session.parseWarnings.length > 0 ? (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {session.parseWarnings.map((warning) => (
                <li
                  key={`${warning.kind}:${warning.recordId}:${warning.lineNumber}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-error px-2 py-1.5"
                >
                  <span className="flex min-w-0 flex-col gap-0.5 text-[11px]">
                    <span className="text-error">
                      {t(agentParseWarningMessageKey[warning.kind])}
                    </span>
                    <span className="font-mono text-text-secondary">
                      {t("agent.line", { line: warning.lineNumber })}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`${t("agent.warning.openRecord")}: ${t("agent.line", {
                      line: warning.lineNumber,
                    })}`}
                    onClick={() => onOpenRecord(warning.recordId)}
                  >
                    {t("agent.warning.openRecord")}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          {hiddenWarningCount > 0 ? (
            <p className="m-0 text-[11px] text-text-secondary">
              {t("agent.warning.more", { count: hiddenWarningCount })}
            </p>
          ) : null}
        </section>
      ) : null}

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
