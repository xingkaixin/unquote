import type { MessageKey } from "../i18n/i18n";
import { useTranslation } from "../i18n/context";
import { formatClockTime } from "../lib/format";
import type {
  AgentCanonicalSelection,
  AgentTrajectoryItem,
  AgentTrajectoryStatus,
  AgentTrajectoryToolItem,
} from "../lib/agent-session/types";
import {
  truncateTrajectoryDisplayText,
  type AgentTrajectoryPresentationItem,
  type AgentTrajectoryWarningGroup,
} from "../lib/agent-session/trajectory-presentation";
import {
  formatTrajectoryDuration,
  trajectoryKindMessageKey,
  trajectoryStatusMessageKey,
  trajectoryWarningMessageKey,
} from "./agent-trajectory-format";
import { Button } from "./button";

const statusTone: Record<AgentTrajectoryStatus, string> = {
  completed: "border-success text-success",
  running: "border-warning text-warning",
  failed: "border-error text-error",
  aborted: "border-error text-error",
};

interface DetailAction {
  readonly id: "record" | "call" | "result" | "completion";
  readonly labelKey:
    | "trajectory.openRecord"
    | "trajectory.openCall"
    | "trajectory.openResult"
    | "trajectory.openCompletion";
  readonly selection: AgentCanonicalSelection;
}

interface TokenUsageFact {
  readonly labelKey: MessageKey;
  readonly value: number;
}

const selectionIdentity = (selection: AgentCanonicalSelection) =>
  JSON.stringify([
    selection.kind,
    selection.recordId,
    selection.kind === "record" ? null : selection.id,
  ]);

const nonEmptyText = (value: string | undefined) => {
  const text = value?.trim();
  return text || undefined;
};

const boundedNonEmptyText = (value: string | undefined) => {
  const text = nonEmptyText(value);
  return text ? truncateTrajectoryDisplayText(text) : undefined;
};

const finiteNumber = (value: number | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const finiteNonNegativeNumber = (value: number | undefined) => {
  const number = finiteNumber(value);
  return number !== undefined && number >= 0 ? number : undefined;
};

const toolEndpointActions = (item: AgentTrajectoryToolItem): DetailAction[] => {
  const actions: DetailAction[] = [];
  if (item.callSelection) {
    actions.push({ id: "call", labelKey: "trajectory.openCall", selection: item.callSelection });
  }
  if (item.resultSelection) {
    actions.push({
      id: "result",
      labelKey: "trajectory.openResult",
      selection: item.resultSelection,
    });
  }
  if (item.completionSelection) {
    actions.push({
      id: "completion",
      labelKey: "trajectory.openCompletion",
      selection: item.completionSelection,
    });
  }
  return actions;
};

const detailActionsFor = (item: AgentTrajectoryItem): DetailAction[] => {
  if (item.kind !== "tool") {
    return [{ id: "record", labelKey: "trajectory.openRecord", selection: item.selection }];
  }

  const endpointActions = toolEndpointActions(item);
  return endpointActions.length > 0
    ? endpointActions
    : [{ id: "record", labelKey: "trajectory.openRecord", selection: item.selection }];
};

const warningActionVisibility = (
  warningGroups: readonly AgentTrajectoryWarningGroup[],
  actions: readonly DetailAction[],
) => {
  const displayedSelections = new Set(actions.map((action) => selectionIdentity(action.selection)));
  return warningGroups.map((group) => {
    const identity = selectionIdentity(group.warning.selection);
    if (displayedSelections.has(identity)) {
      return false;
    }
    displayedSelections.add(identity);
    return true;
  });
};

const tokenUsageFactsFor = (item: AgentTrajectoryItem): TokenUsageFact[] => {
  if (item.kind !== "assistant" && item.kind !== "reasoning") {
    return [];
  }

  const tokenUsage = item.tokenUsage;
  if (!tokenUsage) {
    return [];
  }

  const candidates: readonly [MessageKey, number | undefined][] = [
    ["trajectory.token.input", tokenUsage.inputTokens],
    ["trajectory.token.output", tokenUsage.outputTokens],
    ["trajectory.token.cacheWrite", tokenUsage.cacheCreationInputTokens],
    ["trajectory.token.cacheRead", tokenUsage.cacheReadInputTokens],
    ["trajectory.token.reasoning", tokenUsage.reasoningOutputTokens],
  ];
  const facts: TokenUsageFact[] = [];
  for (const [labelKey, candidate] of candidates) {
    const value = finiteNonNegativeNumber(candidate);
    if (value !== undefined) {
      facts.push({ labelKey, value });
    }
  }
  return facts;
};

const DetailFact = ({
  label,
  value,
  preserveWhitespace = false,
}: {
  label: string;
  value: string | number;
  preserveWhitespace?: boolean;
}) => (
  <div className="flex min-w-0 flex-col gap-1">
    <dt className="uq-label">{label}</dt>
    <dd
      className={`m-0 break-words font-mono text-[11px] text-text-secondary ${
        preserveWhitespace ? "whitespace-pre-wrap" : ""
      }`}
    >
      {value}
    </dd>
  </div>
);

const UnattachedWarningGroups = ({
  groups,
  onOpenUnattachedWarning,
}: {
  groups: readonly AgentTrajectoryWarningGroup[];
  onOpenUnattachedWarning: (selection: AgentCanonicalSelection) => void;
}) => {
  const { t } = useTranslation();
  if (groups.length === 0) {
    return null;
  }

  return (
    <section
      className="flex flex-col gap-2"
      aria-labelledby="trajectory-detail-unattached-warnings"
    >
      <h3 id="trajectory-detail-unattached-warnings" className="uq-label m-0">
        {t("trajectory.warnings")}
      </h3>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {groups.map((group) => {
          const warning = group.warning;
          return (
            <li
              key={warning.kind}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning px-2 py-1.5 text-[11px] text-warning"
            >
              <span>
                {t(trajectoryWarningMessageKey(warning))} · {group.count} ·{" "}
                {t("trajectory.line", { line: warning.lineNumber })}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`${t("trajectory.openRecord")}: ${t("trajectory.line", {
                  line: warning.lineNumber,
                })}`}
                onClick={() => onOpenUnattachedWarning(warning.selection)}
              >
                {t("trajectory.openRecord")}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export interface AgentTrajectoryDetailProps {
  item: AgentTrajectoryPresentationItem | null;
  unattachedWarningGroups: readonly AgentTrajectoryWarningGroup[];
  onOpenSelection: (selection: AgentCanonicalSelection) => void;
  onOpenUnattachedWarning: (selection: AgentCanonicalSelection) => void;
}

export const AgentTrajectoryDetail = ({
  item,
  unattachedWarningGroups,
  onOpenSelection,
  onOpenUnattachedWarning,
}: AgentTrajectoryDetailProps) => {
  const { locale, t } = useTranslation();

  if (!item) {
    return (
      <div
        data-trajectory-detail-item-token=""
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4"
      >
        <h2 className="uq-label m-0">{t("trajectory.detail")}</h2>
        <p className="m-0 text-[12px] text-text-tertiary">{t("trajectory.detailEmpty")}</p>
        <UnattachedWarningGroups
          groups={unattachedWarningGroups}
          onOpenUnattachedWarning={onOpenUnattachedWarning}
        />
      </div>
    );
  }

  const trajectoryItem = item.item;
  const actions = detailActionsFor(trajectoryItem);
  const warningActions = warningActionVisibility(item.warningGroups, actions);
  const canonicalLabel = boundedNonEmptyText(item.detail?.event.label);
  const toolName =
    trajectoryItem.kind === "tool" ? boundedNonEmptyText(trajectoryItem.toolName) : undefined;
  const callId =
    trajectoryItem.kind === "tool" &&
    trajectoryItem.callId !== undefined &&
    trajectoryItem.callId.length > 0
      ? truncateTrajectoryDisplayText(trajectoryItem.callId)
      : undefined;
  const turnIndex = trajectoryItem.turnIndex ?? item.turn?.turnIndex;
  const metadata = [
    t("trajectory.line", { line: trajectoryItem.lineNumber }),
    turnIndex === undefined ? "" : t("trajectory.turn", { turn: turnIndex }),
  ].filter(Boolean);
  const time =
    finiteNumber(trajectoryItem.timestamp) === undefined
      ? ""
      : formatClockTime(trajectoryItem.timestamp, locale);
  const duration =
    trajectoryItem.kind === "tool"
      ? formatTrajectoryDuration(trajectoryItem.durationMs, locale)
      : "";
  const derivedStep =
    trajectoryItem.kind === "assistant" || trajectoryItem.kind === "reasoning"
      ? trajectoryItem.step
      : undefined;
  const tokenUsageFacts = tokenUsageFactsFor(trajectoryItem);
  const kind = t(trajectoryKindMessageKey[trajectoryItem.kind]);
  const summary = truncateTrajectoryDisplayText(item.summary) || kind;
  const status = t(trajectoryStatusMessageKey[trajectoryItem.status]);
  const hasDetailFacts = Boolean(time || duration || toolName || callId || derivedStep);

  return (
    <div
      data-trajectory-detail-item-token={item.ordinal}
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4"
    >
      <h2 className="uq-label m-0">{t("trajectory.detail")}</h2>

      <div className="flex min-w-0 flex-col gap-2">
        <p className="m-0 break-words text-[14px] leading-5 text-text-primary">{summary}</p>
        {canonicalLabel ? (
          <p className="m-0 break-words font-mono text-[11px] text-text-secondary">
            {canonicalLabel}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-xs border border-border-medium px-1.5 py-0.5 font-mono text-[10.5px] text-text-secondary">
            {kind}
          </span>
          <span
            className={`rounded-xs border px-1.5 py-0.5 font-mono text-[10.5px] ${statusTone[trajectoryItem.status]}`}
          >
            {status}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-2 gap-y-1 font-mono text-[11px] text-text-secondary">
        {metadata.map((entry) => (
          <span key={entry}>{entry}</span>
        ))}
      </div>

      {hasDetailFacts ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-3">
          {time ? <DetailFact label={t("trajectory.time")} value={time} /> : null}
          {duration ? <DetailFact label={t("trajectory.duration")} value={duration} /> : null}
          {toolName ? <DetailFact label={t("trajectory.kind.tool")} value={toolName} /> : null}
          {callId ? (
            <DetailFact label={t("trajectory.callId")} value={callId} preserveWhitespace />
          ) : null}
          {derivedStep ? (
            <DetailFact
              label={t("trajectory.derivedStep", { step: derivedStep.index })}
              value={t("trajectory.derivedStepHint")}
            />
          ) : null}
        </dl>
      ) : null}

      {tokenUsageFacts.length > 0 ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-3 border-t border-border pt-3">
          {tokenUsageFacts.map((fact) => (
            <DetailFact key={fact.labelKey} label={t(fact.labelKey)} value={fact.value} />
          ))}
        </dl>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button
            key={action.id}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenSelection(action.selection)}
          >
            {t(action.labelKey)}
          </Button>
        ))}
      </div>

      {item.warningGroups.length > 0 ? (
        <section className="flex flex-col gap-2" aria-labelledby="trajectory-detail-warnings">
          <h3 id="trajectory-detail-warnings" className="uq-label m-0">
            {t("trajectory.warnings")}
          </h3>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {item.warningGroups.map((group, index) => {
              const warning = group.warning;
              return (
                <li
                  key={warning.kind}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning px-2 py-1.5 text-[11px] text-warning"
                >
                  <span>
                    {t(trajectoryWarningMessageKey(warning))} · {group.count} ·{" "}
                    {t("trajectory.line", { line: warning.lineNumber })}
                  </span>
                  {warningActions[index] ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`${t("trajectory.openRecord")}: ${t("trajectory.line", {
                        line: warning.lineNumber,
                      })}`}
                      onClick={() => onOpenSelection(warning.selection)}
                    >
                      {t("trajectory.openRecord")}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      <UnattachedWarningGroups
        groups={unattachedWarningGroups}
        onOpenUnattachedWarning={onOpenUnattachedWarning}
      />
    </div>
  );
};
