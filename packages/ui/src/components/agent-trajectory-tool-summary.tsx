import { useTranslation } from "../i18n/context";
import {
  truncateTrajectoryDisplayText,
  type AgentTrajectoryToolSummary,
} from "../lib/agent-session/trajectory-presentation";
import { formatTrajectoryDuration } from "./agent-trajectory-format";

const MISSING_VALUE = "—";

export interface AgentTrajectoryToolSummaryTableProps {
  summaries: readonly AgentTrajectoryToolSummary[];
  selectedToolName: string | null;
  onToolNameChange: (toolName: string | null) => void;
}

export const AgentTrajectoryToolSummaryTable = ({
  summaries,
  selectedToolName,
  onToolNameChange,
}: AgentTrajectoryToolSummaryTableProps) => {
  const { locale, t } = useTranslation();
  const formatCount = (value: number) => new Intl.NumberFormat(locale).format(value);
  const headerClass = "px-2 py-1 font-normal uq-label";

  return (
    <details data-trajectory-tool-summary className="border-t border-border">
      <summary className="uq-label cursor-pointer px-3 py-1.5">
        {t("trajectory.toolBreakdown")} · {formatCount(summaries.length)}
      </summary>
      <div className="max-h-36 overflow-auto px-1 pb-2">
        <table className="border-collapse text-left text-[11px]">
          <caption className="sr-only">{t("trajectory.toolBreakdown")}</caption>
          <thead>
            <tr>
              <th scope="col" className={headerClass}>
                {t("trajectory.toolFilter")}
              </th>
              <th scope="col" className={`${headerClass} text-right`}>
                {t("trajectory.toolColumn.calls")}
              </th>
              <th scope="col" className={`${headerClass} text-right`}>
                {t("trajectory.toolColumn.failed")}
              </th>
              <th scope="col" className={`${headerClass} text-right`}>
                {t("trajectory.toolColumn.total")}
              </th>
              <th scope="col" className={`${headerClass} text-right`}>
                {t("trajectory.toolColumn.max")}
              </th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {summaries.map((summary) => {
              const selected = summary.toolName === selectedToolName;
              const total = formatTrajectoryDuration(summary.totalDurationMs, locale);
              const max = formatTrajectoryDuration(summary.maxDurationMs, locale);
              const partiallyTimed = summary.timedCalls > 0 && summary.timedCalls < summary.calls;
              return (
                <tr
                  key={summary.toolName}
                  className={selected ? "bg-accent-soft" : "hover:bg-surface-200"}
                >
                  <th scope="row" className="px-1 py-0.5 font-normal">
                    <button
                      type="button"
                      aria-pressed={selected}
                      title={t("trajectory.filterTool", { tool: summary.toolName })}
                      onClick={() => onToolNameChange(selected ? null : summary.toolName)}
                      className="block max-w-80 truncate rounded-sm px-1 py-0.5 text-left text-text-primary focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
                    >
                      {truncateTrajectoryDisplayText(summary.toolName)}
                    </button>
                  </th>
                  <td className="px-2 py-0.5 text-right text-text-secondary">
                    {formatCount(summary.calls)}
                  </td>
                  <td
                    className={`px-2 py-0.5 text-right ${
                      summary.failures > 0 ? "text-error" : "text-text-secondary"
                    }`}
                  >
                    {formatCount(summary.failures)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-0.5 text-right text-text-secondary">
                    {total || MISSING_VALUE}
                    {partiallyTimed ? " " : null}
                    {partiallyTimed ? (
                      <span className="text-text-tertiary">
                        {t("trajectory.toolTimedCount", {
                          timed: summary.timedCalls,
                          calls: summary.calls,
                        })}
                      </span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-2 py-0.5 text-right text-text-secondary">
                    {max || MISSING_VALUE}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
};
