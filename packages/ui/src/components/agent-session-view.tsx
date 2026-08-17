import { useTranslation } from "../i18n/context";
import {
  type AgentDetailSelection,
  type AgentSession,
  type AgentSessionModel,
} from "../lib/agent-session";
import { AgentConversationPane } from "./agent-conversation-pane";
import { AgentFactsPane } from "./agent-facts-pane";
import { AgentTimelinePane } from "./agent-timeline-pane";
import { WorkspaceColumns } from "./workspace-columns";

interface AgentSessionViewProps {
  session: AgentSession;
  model: AgentSessionModel;
  isDesktop: boolean;
  detailSelection: AgentDetailSelection | null;
  onDetailSelectionChange: (selection: AgentDetailSelection) => void;
  onOpenRecord: (recordId: string) => void;
}

export const AgentSessionView = ({
  session,
  model,
  isDesktop,
  detailSelection,
  onDetailSelectionChange,
  onOpenRecord,
}: AgentSessionViewProps) => {
  const { t } = useTranslation();
  const detail = model.resolveDetail(detailSelection);

  const selectDetail = (selection: AgentDetailSelection | null) => {
    if (selection) {
      onDetailSelectionChange(selection);
    }
  };

  return (
    <div className="uq-agent-shell flex min-h-0 flex-1 flex-col">
      <WorkspaceColumns
        isDesktop={isDesktop}
        leftWidth={250}
        rightWidth={276}
        leftMobileHeight="30vh"
        rightLabel={t("agent.overview")}
        left={
          <AgentTimelinePane
            events={model.events}
            highlightedRecordId={detail?.recordId}
            onSelectEvent={(eventId) => selectDetail(model.selectEvent(eventId))}
          />
        }
        center={
          <AgentConversationPane
            entries={model.conversation}
            model={model}
            selectedConversationId={detail?.conversationItem?.id}
            detailSelection={detailSelection}
            onSelectItem={(itemId) => selectDetail(model.selectConversation(itemId))}
            onOpenRecord={onOpenRecord}
          />
        }
        right={<AgentFactsPane session={session} model={model} onOpenRecord={onOpenRecord} />}
      />
    </div>
  );
};
