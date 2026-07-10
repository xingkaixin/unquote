import { Clock3, Hash } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "../i18n/context";
import type {
  AgentContentBlock,
  AgentConversationItem,
  AgentTimelineEvent,
} from "../lib/agent-session";
import type { AgentDetailSelection } from "./agent-session-view";
import { formatTimestamp, roleConfig } from "./agent-session-format";
import { Badge } from "./badge";
import { Card, CardContent, CardHeader, CardTitle } from "./card";

const BlockText = ({ block }: { block: AgentContentBlock | undefined }) => {
  if (!block) {
    return null;
  }

  const codeLike = block.type === "tool_use" || block.toolCallId;
  return (
    <pre
      className={`mt-2 max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border px-3 py-2 text-[12px] leading-5 ${
        codeLike
          ? "bg-surface-50 font-mono text-text-primary"
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
  const { t } = useTranslation();
  const config = roleConfig(item.role, t);
  const Icon = config.icon;
  const timestamp = formatTimestamp(event?.timestamp, event?.timestampLabel);

  return (
    <article className={`flex ${config.align === "end" ? "justify-end" : "justify-start"}`}>
      <button
        type="button"
        aria-label={`${t("agent.conversation")}: ${config.label}`}
        aria-pressed={selected}
        className={`min-w-0 max-w-[min(48rem,100%)] rounded-md border px-3 py-2 text-left shadow-sm transition-colors ${
          selected
            ? "border-accent bg-[rgba(229,112,62,0.08)]"
            : "border-border bg-surface-100 hover:border-accent/50"
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
}

export const AgentConversationPane = ({
  items,
  eventById,
  selectedConversationId,
  detailSelection,
  onSelectItem,
}: AgentConversationPaneProps) => {
  const { t } = useTranslation();
  const conversationRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    if (!selectedConversationId) {
      return;
    }

    conversationRefs.current
      .get(selectedConversationId)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [detailSelection, selectedConversationId]);

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader>
        <CardTitle>{t("agent.conversation")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {items.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-[12px] text-text-muted">
            {t("agent.noConversation")}
          </div>
        ) : (
          items.map((item) => (
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
              <ConversationItem
                item={item}
                event={eventById.get(item.eventId)}
                selected={selectedConversationId === item.id}
                onSelect={(itemId) => onSelectItem(itemId, item.recordId)}
              />
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
};
