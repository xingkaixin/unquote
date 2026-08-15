import { useVirtualizer } from "@tanstack/react-virtual";
import type { CSSProperties } from "react";
import { useLayoutEffect, useMemo, useRef } from "react";
import { useTranslation } from "../i18n/context";
import type { AgentTrajectoryStatus } from "../lib/agent-session";
import {
  truncateTrajectoryDisplayText,
  type AgentTrajectoryLedgerItemRow,
  type AgentTrajectoryLedgerRow,
  type AgentTrajectoryLedgerTurnHeader,
} from "../lib/agent-session/trajectory-presentation";
import { formatClockTime } from "../lib/format";
import { preferredScrollBehavior } from "../lib/motion-preference";
import {
  formatTrajectoryDuration,
  trajectoryKindMessageKey,
  trajectoryStatusMessageKey,
} from "./agent-trajectory-format";

export const trajectoryLedgerVirtualizationThreshold = 160;
export const trajectoryLedgerRowEstimateSize = 72;

const trajectoryLedgerOverscan = 8;

const statusTone: Record<AgentTrajectoryStatus, string> = {
  completed: "border-success text-success",
  running: "border-warning text-warning",
  failed: "border-error text-error",
  aborted: "border-error text-error",
};

interface LedgerRowLayout {
  readonly virtualIndex?: number;
  readonly style?: CSSProperties;
  readonly onMeasure?: (node: HTMLDivElement | null) => void;
}

const ledgerRowKey = (row: AgentTrajectoryLedgerRow | undefined, index: number) => {
  if (!row) {
    return index;
  }
  return `${row.type}:${row.type === "turn-header" ? row.group.ordinal : row.item.ordinal}`;
};

const LedgerTurnHeader = ({
  row,
  virtualIndex,
  style,
  onMeasure,
}: LedgerRowLayout & { row: AgentTrajectoryLedgerTurnHeader }) => {
  const { t } = useTranslation();
  const turnIndex = row.group.turn?.turnIndex;
  const label =
    row.group.turn === null
      ? t("trajectory.unassigned")
      : turnIndex === undefined
        ? t("trajectory.metric.turns")
        : t("trajectory.turn", { turn: turnIndex });

  return (
    <div
      ref={onMeasure}
      role="presentation"
      data-index={virtualIndex}
      className={
        virtualIndex === undefined ? "px-3 pt-4" : "absolute left-0 top-0 w-full px-3 pt-4"
      }
      style={style}
    >
      <h3 className="uq-label m-0 border-b border-border pb-1.5">{label}</h3>
    </div>
  );
};

const LedgerItemRow = ({
  row,
  selected,
  onSelectItem,
  virtualIndex,
  style,
  onMeasure,
  itemRef,
}: LedgerRowLayout & {
  row: AgentTrajectoryLedgerItemRow;
  selected: boolean;
  onSelectItem: (itemId: string) => void;
  itemRef?: (node: HTMLDivElement | null) => void;
}) => {
  const { locale, t } = useTranslation();
  const { item: presentationItem } = row;
  const item = presentationItem.item;
  const kind = t(trajectoryKindMessageKey[item.kind]);
  const status = t(trajectoryStatusMessageKey[item.status]);
  const turnIndex = item.turnIndex ?? row.group.turn?.turnIndex;
  const time = formatClockTime(item.timestamp, locale);
  const duration = item.kind === "tool" ? formatTrajectoryDuration(item.durationMs, locale) : "";
  const toolName =
    item.kind === "tool" && item.toolName
      ? truncateTrajectoryDisplayText(item.toolName)
      : undefined;
  const callId =
    item.kind === "tool" && item.callId ? truncateTrajectoryDisplayText(item.callId) : undefined;
  const summary = truncateTrajectoryDisplayText(presentationItem.summary) || kind;
  const derivedStep =
    item.kind === "assistant" || item.kind === "reasoning" ? item.step : undefined;
  const metadata = [
    t("trajectory.line", { line: item.lineNumber }),
    turnIndex === undefined ? "" : t("trajectory.turn", { turn: turnIndex }),
    time,
    duration ? `${t("trajectory.duration")}: ${duration}` : "",
    callId ? `${t("trajectory.callId")}: ${callId}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      ref={onMeasure ?? itemRef}
      role="listitem"
      aria-setsize={row.setSize}
      aria-posinset={row.positionInSet}
      data-index={virtualIndex}
      className={virtualIndex === undefined ? "px-2" : "absolute left-0 top-0 w-full px-2"}
      style={style}
    >
      <button
        type="button"
        data-trajectory-item-token={presentationItem.ordinal}
        aria-current={selected ? "true" : undefined}
        aria-label={`${kind}: ${summary}`}
        className={`flex min-h-[72px] w-full min-w-0 flex-col gap-1.5 rounded-md border border-transparent px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent ${
          selected ? "border-accent bg-accent-soft" : "hover:bg-surface-200"
        }`}
        onClick={() => onSelectItem(item.id)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-[12px] font-medium text-text-primary">{kind}</span>
          {toolName ? (
            <span className="min-w-0 truncate font-mono text-[11px] text-text-secondary">
              {toolName}
            </span>
          ) : null}
          {derivedStep ? (
            <span
              title={t("trajectory.derivedStepHint")}
              className="min-w-0 truncate font-mono text-[10px] text-text-tertiary"
            >
              {t("trajectory.derivedStep", { step: derivedStep.index })}
              <span className="sr-only">. {t("trajectory.derivedStepHint")}</span>
            </span>
          ) : null}
          <span className="flex-1" />
          <span
            className={`shrink-0 rounded-xs border px-1.5 py-0.5 font-mono text-[10px] ${statusTone[item.status]}`}
          >
            {status}
          </span>
        </span>
        <span title={summary} className="truncate text-[12px] text-text-secondary">
          {summary}
        </span>
        <span className="truncate font-mono text-[10px] text-text-tertiary">{metadata}</span>
      </button>
    </div>
  );
};

export interface AgentTrajectoryLedgerProps {
  rows: readonly AgentTrajectoryLedgerRow[];
  selectedItemId: string | undefined;
  onSelectItem: (itemId: string) => void;
}

export const AgentTrajectoryLedger = ({
  rows,
  selectedItemId,
  onSelectItem,
}: AgentTrajectoryLedgerProps) => {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const lastScrolledItemId = useRef<string | undefined>(undefined);
  const shouldVirtualize = rows.length > trajectoryLedgerVirtualizationThreshold;
  const itemIndexById = useMemo(() => {
    const indexById = new Map<string, number>();
    rows.forEach((row, index) => {
      if (row.type === "item") {
        indexById.set(row.item.item.id, index);
      }
    });
    return indexById;
  }, [rows]);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => trajectoryLedgerRowEstimateSize,
    overscan: trajectoryLedgerOverscan,
    getItemKey: (index) => ledgerRowKey(rows[index], index),
    enabled: shouldVirtualize,
  });

  useLayoutEffect(() => {
    if (!selectedItemId) {
      lastScrolledItemId.current = undefined;
      return;
    }
    const index = itemIndexById.get(selectedItemId);
    if (index === undefined) {
      lastScrolledItemId.current = undefined;
      return;
    }
    if (lastScrolledItemId.current === selectedItemId) {
      return;
    }

    lastScrolledItemId.current = selectedItemId;
    if (shouldVirtualize) {
      rowVirtualizer.scrollToIndex(index, { align: "center" });
      return;
    }

    itemRefs.current
      .get(selectedItemId)
      ?.scrollIntoView({ block: "center", behavior: preferredScrollBehavior() });
  }, [itemIndexById, rowVirtualizer, selectedItemId, shouldVirtualize]);

  const renderRow = (row: AgentTrajectoryLedgerRow, index: number, layout: LedgerRowLayout = {}) =>
    row.type === "turn-header" ? (
      <LedgerTurnHeader key={ledgerRowKey(row, index)} row={row} {...layout} />
    ) : (
      <LedgerItemRow
        key={ledgerRowKey(row, index)}
        row={row}
        selected={selectedItemId === row.item.item.id}
        onSelectItem={onSelectItem}
        {...(layout.virtualIndex === undefined
          ? {
              itemRef: (node: HTMLDivElement | null) => {
                if (node) {
                  itemRefs.current.set(row.item.item.id, node);
                  return;
                }
                itemRefs.current.delete(row.item.item.id);
              },
            }
          : {})}
        {...layout}
      />
    );

  return (
    <div
      ref={scrollRef}
      role="list"
      aria-label={t("trajectory.ledger")}
      className="min-h-0 flex-1 overflow-y-auto pb-3"
    >
      {rows.length === 0 ? (
        <p className="m-0 px-3 py-6 text-center text-[12px] text-text-tertiary">
          {t("trajectory.empty")}
        </p>
      ) : shouldVirtualize ? (
        <div
          role="presentation"
          data-trajectory-ledger-virtual
          className="relative w-full"
          style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualItem) => {
            const row = rows[virtualItem.index];
            if (!row) {
              return null;
            }

            return renderRow(row, virtualItem.index, {
              virtualIndex: virtualItem.index,
              style: { transform: `translateY(${virtualItem.start}px)` },
              onMeasure: (node) => {
                if (node) {
                  rowVirtualizer.measureElement(node);
                }
              },
            });
          })}
        </div>
      ) : (
        rows.map((row, index) => renderRow(row, index))
      )}
    </div>
  );
};
