import { useVirtualizer } from "@tanstack/react-virtual";
import { FileJson2 } from "lucide-react";
import { useLayoutEffect, useMemo, useRef } from "react";
import { useTranslation } from "../i18n/context";
import { preferredScrollBehavior } from "../lib/motion-preference";
import type { MessageKey } from "../i18n/i18n";
import type {
  AgentContentBlock,
  AgentConversationEntry,
  AgentDetailSelection,
  AgentSessionModel,
  AgentToolStatus,
} from "../lib/agent-session";
import { formatAgentFieldValue } from "../lib/agent-session/agent-value-format";
import { formatEventMeta, formatTimestamp, roleConfig } from "./agent-session-format";
import { Button } from "./button";

export const conversationVirtualizationThreshold = 160;
const conversationItemEstimateSize = 96;
const conversationItemGap = 24;

const statusLabel: Record<AgentToolStatus, MessageKey> = {
  pending: "agent.status.pending",
  completed: "agent.status.completed",
  failed: "agent.status.failed",
};

const statusTone: Record<AgentToolStatus, string> = {
  pending: "border-border-medium text-text-tertiary",
  completed: "border-success text-success",
  failed: "border-error text-error",
};

interface ToolField {
  key: string;
  value: string;
}

// Tool arguments arrive as text that is truncated at the adapter boundary, so a
// parse failure is expected and falls back to the raw block text.
const parseToolFields = (text: string): ToolField[] | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  return Object.entries(parsed).map(([key, value]) => ({
    key,
    value: formatAgentFieldValue(value),
  }));
};

const ToolCard = ({
  block,
  title,
  status,
  expanded,
  selectLabel,
  onSelect,
}: {
  block: Extract<AgentContentBlock, { type: "tool_use" | "tool_result" }>;
  title: string;
  status: AgentToolStatus;
  expanded: boolean;
  selectLabel: string;
  onSelect: () => void;
}) => {
  const { t } = useTranslation();
  const fields = expanded ? parseToolFields(block.text) : null;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface-100">
      <button
        type="button"
        data-agent-tool-card
        aria-label={selectLabel}
        aria-pressed={expanded}
        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
        onClick={onSelect}
      >
        <span className="shrink-0 font-mono text-[12px] text-accent">{expanded ? "▾" : "▸"}</span>
        <span className="shrink-0 whitespace-nowrap font-mono text-[12.5px] font-medium text-text-primary">
          {title}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text-secondary">
          {block.text}
        </span>
        <span
          className={`shrink-0 whitespace-nowrap rounded-xs border px-1.5 py-0.5 font-mono text-[10.5px] ${statusTone[status]}`}
        >
          {t(statusLabel[status])}
        </span>
      </button>
      {expanded ? (
        <div className="flex flex-col gap-2.5 border-t border-border bg-surface-50 px-3.5 py-3">
          {fields ? (
            fields.map((field) => (
              <div
                key={field.key}
                className="flex min-w-0 gap-3 font-mono text-[11.5px] leading-[19px]"
              >
                <span className="w-[110px] shrink-0 text-code-key">{field.key}</span>
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-text-primary">
                  {field.value}
                </span>
              </div>
            ))
          ) : (
            <pre className="m-0 max-h-[28rem] overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-[19px] text-text-primary">
              {block.text}
            </pre>
          )}
        </div>
      ) : null}
    </div>
  );
};

const ConversationTurn = ({
  entry,
  model,
  selected,
  onSelect,
  onOpenRecord,
}: {
  entry: AgentConversationEntry;
  model: AgentSessionModel;
  selected: boolean;
  onSelect: (itemId: string) => void;
  onOpenRecord: (recordId: string) => void;
}) => {
  const { locale, t } = useTranslation();
  const { item, event } = entry;
  const config = roleConfig(item.role, t);
  const Icon = config.icon;
  const time = formatTimestamp(event.timestamp, event.timestampLabel, locale);
  const block = item.block;
  const selectLabel = `${t("agent.conversation")}: ${config.label}`;
  const toolName = model.resolveToolName(item);

  return (
    <article className="flex flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="size-3.5 shrink-0 text-text-tertiary" />
        <span className="shrink-0 text-[12.5px] font-semibold text-text-primary">
          {config.label}
        </span>
        <span className="min-w-0 truncate font-mono text-[10.5px] text-text-tertiary">
          {formatEventMeta(event.lineNumber, time, item.turnIndex, t)}
        </span>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="uq-icon-button h-6 w-6 shrink-0 px-0"
          aria-label={t("agent.openInJsonl")}
          onClick={() => onOpenRecord(event.recordId)}
        >
          <FileJson2 className="size-3.5" />
        </Button>
      </div>
      {block?.type === "tool_use" || block?.type === "tool_result" ? (
        <ToolCard
          block={block}
          title={
            block.type === "tool_use"
              ? (toolName ?? config.label)
              : toolName
                ? t("agent.toolOutput", { tool: toolName })
                : config.label
          }
          status={model.resolveToolStatus(item)}
          expanded={selected}
          selectLabel={selectLabel}
          onSelect={() => onSelect(item.id)}
        />
      ) : (
        <button
          type="button"
          aria-label={selectLabel}
          aria-pressed={selected}
          className={`w-full border-l-2 py-0.5 pl-4 text-left text-[15px] leading-[26px] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent ${
            selected ? "border-l-accent text-text-primary" : "border-l-border text-text-secondary"
          }`}
          onClick={() => onSelect(item.id)}
        >
          {block?.text ?? ""}
        </button>
      )}
    </article>
  );
};

interface AgentConversationPaneProps {
  entries: readonly AgentConversationEntry[];
  model: AgentSessionModel;
  selectedConversationId: string | undefined;
  detailSelection: AgentDetailSelection | null;
  onSelectItem: (itemId: string) => void;
  onOpenRecord: (recordId: string) => void;
}

export const AgentConversationPane = ({
  entries,
  model,
  selectedConversationId,
  detailSelection,
  onSelectItem,
  onOpenRecord,
}: AgentConversationPaneProps) => {
  const { t } = useTranslation();
  const conversationRefs = useRef(new Map<string, HTMLDivElement>());
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldVirtualize = entries.length > conversationVirtualizationThreshold;
  const indexById = useMemo(() => {
    const map = new Map<string, number>();
    entries.forEach(({ item }, index) => map.set(item.id, index));
    return map;
  }, [entries]);
  const conversationVirtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => conversationItemEstimateSize,
    overscan: 4,
    gap: conversationItemGap,
    getItemKey: (index) => entries[index]?.item.id ?? index,
    enabled: shouldVirtualize,
  });
  const virtualItems = conversationVirtualizer.getVirtualItems();

  // Scrolling must react to selection changes only; the closure reads the
  // latest items/virtualizer state without depending on them, so a rebuilt
  // items array does not re-scroll to an already-selected item.
  useLayoutEffect(() => {
    if (!selectedConversationId) {
      return;
    }

    if (shouldVirtualize) {
      const index = indexById.get(selectedConversationId);
      if (index !== undefined) {
        conversationVirtualizer.scrollToIndex(index, { align: "center" });
      }
      return;
    }

    conversationRefs.current
      .get(selectedConversationId)
      ?.scrollIntoView({ block: "center", behavior: preferredScrollBehavior() });
  }, [detailSelection, selectedConversationId]);

  const renderTurn = (entry: AgentConversationEntry) => (
    <ConversationTurn
      entry={entry}
      model={model}
      selected={selectedConversationId === entry.item.id}
      onSelect={onSelectItem}
      onOpenRecord={onOpenRecord}
    />
  );

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[780px] flex-col px-6 pb-14 pt-8">
        {entries.length === 0 ? (
          <p className="m-0 rounded-md border border-dashed border-border px-3 py-6 text-center text-[12px] text-text-tertiary">
            {t("agent.noConversation")}
          </p>
        ) : shouldVirtualize ? (
          <div
            className="relative w-full"
            style={{ height: `${conversationVirtualizer.getTotalSize()}px` }}
          >
            {virtualItems.map((virtualItem) => {
              const entry = entries[virtualItem.index];
              if (!entry) {
                return null;
              }

              return (
                <div
                  key={entry.item.id}
                  ref={(node) => {
                    if (node) {
                      conversationVirtualizer.measureElement(node);
                    }
                  }}
                  data-index={virtualItem.index}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${virtualItem.start}px)` }}
                >
                  {renderTurn(entry)}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {entries.map((entry) => (
              <div
                key={entry.item.id}
                ref={(node) => {
                  if (node) {
                    conversationRefs.current.set(entry.item.id, node);
                  } else {
                    conversationRefs.current.delete(entry.item.id);
                  }
                }}
              >
                {renderTurn(entry)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
