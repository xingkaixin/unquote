import { useVirtualizer } from "@tanstack/react-virtual";
import { Clock3, Hash } from "lucide-react";
import { type ReactNode, useLayoutEffect, useMemo, useRef } from "react";
import { useTranslation } from "../i18n/context";
import { preferredScrollBehavior } from "../lib/motion-preference";
import type {
  AgentContentBlock,
  AgentConversationItem,
  AgentTimelineEvent,
} from "../lib/agent-session";
import type { AgentDetailSelection } from "./agent-session-view";
import { formatTimestamp, roleConfig } from "./agent-session-format";
import { Badge } from "./badge";
import { Card, CardHeader, CardTitle } from "./card";

export const conversationVirtualizationThreshold = 160;
const conversationItemEstimateSize = 96;
const conversationItemGap = 12;

const BlockText = ({ block }: { block: AgentContentBlock | undefined }) => {
  if (!block) {
    return null;
  }

  const codeLike = block.type === "tool_use" || block.toolCallId;
  return (
    <pre
      className={`mt-2 max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border px-3 py-2 text-[12px] leading-5 ${
        codeLike
          ? "bg-surface-100 font-mono text-text-primary"
          : "bg-transparent font-sans text-text-secondary"
      }`}
    >
      {block.text}
    </pre>
  );
};

const ConversationItem = ({
  item,
  event,
  selected,
  onSelect,
}: {
  item: AgentConversationItem;
  event: AgentTimelineEvent | undefined;
  selected: boolean;
  onSelect: (itemId: string) => void;
}) => {
  const { locale, t } = useTranslation();
  const config = roleConfig(item.role, t);
  const Icon = config.icon;
  const timestamp = formatTimestamp(event?.timestamp, event?.timestampLabel, locale);

  return (
    <article className={`flex ${config.align === "end" ? "justify-end" : "justify-start"}`}>
      <button
        type="button"
        aria-label={`${t("agent.conversation")}: ${config.label}`}
        aria-pressed={selected}
        className={`min-w-0 max-w-[min(48rem,100%)] rounded-md px-3 py-2 text-left transition-colors ${
          selected
            ? "bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)]"
            : "hover:bg-surface-200"
        }`}
        onClick={() => onSelect(item.id)}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Badge variant={config.variant}>
            <Icon className="mr-1 size-3" />
            {config.label}
          </Badge>
          {item.block?.toolName ? <Badge variant="warning">{item.block.toolName}</Badge> : null}
          {item.block?.status ? <Badge>{item.block.status}</Badge> : null}
          {item.turnIndex ? <Badge>{t("agent.turn", { turn: item.turnIndex })}</Badge> : null}
          <span className="inline-flex items-center gap-1 text-[11px] text-text-muted">
            <Hash className="size-3" />
            {t("agent.line", { line: item.lineNumber })}
          </span>
          {timestamp ? (
            <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-text-muted">
              <Clock3 className="size-3 shrink-0" />
              <span className="truncate">{timestamp}</span>
            </span>
          ) : null}
        </div>
        <BlockText block={item.block} />
      </button>
    </article>
  );
};

interface AgentConversationPaneProps {
  items: AgentConversationItem[];
  eventById: ReadonlyMap<string, AgentTimelineEvent>;
  selectedConversationId: string | undefined;
  detailSelection: AgentDetailSelection | null;
  onSelectItem: (itemId: string, recordId: string) => void;
  headerStart?: ReactNode;
  headerEnd?: ReactNode;
}

export const AgentConversationPane = ({
  items,
  eventById,
  selectedConversationId,
  detailSelection,
  onSelectItem,
  headerStart,
  headerEnd,
}: AgentConversationPaneProps) => {
  const { t } = useTranslation();
  const conversationRefs = useRef(new Map<string, HTMLDivElement>());
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldVirtualize = items.length > conversationVirtualizationThreshold;
  const indexById = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach((item, index) => map.set(item.id, index));
    return map;
  }, [items]);
  const conversationVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => conversationItemEstimateSize,
    overscan: 4,
    gap: conversationItemGap,
    getItemKey: (index) => items[index]?.id ?? index,
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

  const renderItem = (item: AgentConversationItem) => (
    <ConversationItem
      item={item}
      event={eventById.get(item.eventId)}
      selected={selectedConversationId === item.id}
      onSelect={(itemId) => onSelectItem(itemId, item.recordId)}
    />
  );

  return (
    <Card className="flex h-full min-w-0 flex-col overflow-hidden border-transparent hover:border-transparent">
      <CardHeader className="flex-row items-center justify-between gap-2 border-b-0">
        <div className="flex min-w-0 items-center gap-2">
          {headerStart}
          <CardTitle>{t("agent.conversation")}</CardTitle>
        </div>
        {headerEnd}
      </CardHeader>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto px-4 pb-4">
        {items.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-[12px] text-text-muted">
            {t("agent.noConversation")}
          </div>
        ) : shouldVirtualize ? (
          <div
            className="relative w-full"
            style={{ height: `${conversationVirtualizer.getTotalSize()}px` }}
          >
            {virtualItems.map((virtualItem) => {
              const item = items[virtualItem.index];
              if (!item) {
                return null;
              }

              return (
                <div
                  key={item.id}
                  ref={(node) => {
                    if (node) {
                      conversationVirtualizer.measureElement(node);
                    }
                  }}
                  data-index={virtualItem.index}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${virtualItem.start}px)` }}
                >
                  {renderItem(item)}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((item) => (
              <div
                key={item.id}
                ref={(node) => {
                  if (node) {
                    conversationRefs.current.set(item.id, node);
                  } else {
                    conversationRefs.current.delete(item.id);
                  }
                }}
              >
                {renderItem(item)}
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
};
