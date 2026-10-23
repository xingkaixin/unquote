import { useState } from "react";
import type { JsonlRecord } from "@unquote/core";
import { useTranslation } from "../i18n/context";
import {
  type AgentDetailSelection,
  type AgentSession,
  type AgentSessionModel,
} from "../lib/agent-session";
import type { PublishedSourceRevision } from "../lib/published-source";
import { AgentConversationPane } from "./agent-conversation-pane";
import { AgentFactsPane } from "./agent-facts-pane";
import { AgentTimelinePane } from "./agent-timeline-pane";
import { deferredComponent } from "./deferred-component";
import { DeferredLoadBoundary } from "./deferred-load-boundary";
import { WorkspaceColumns } from "./workspace-columns";

const TurnReportDialog = deferredComponent(() =>
  import("./turn-report-dialog").then(({ TurnReportDialog }) => TurnReportDialog),
);

// Present only while the parsed Records belong to the current Source Revision.
export interface AgentReportSource {
  source: PublishedSourceRevision;
  records: readonly JsonlRecord[];
}

interface AgentSessionViewProps {
  session: AgentSession;
  model: AgentSessionModel;
  isDesktop: boolean;
  detailSelection: AgentDetailSelection | null;
  reportSource: AgentReportSource | undefined;
  onDetailSelectionChange: (selection: AgentDetailSelection) => void;
  onOpenRecord: (recordId: string) => void;
}

export const AgentSessionView = ({
  session,
  model,
  isDesktop,
  detailSelection,
  reportSource,
  onDetailSelectionChange,
  onOpenRecord,
}: AgentSessionViewProps) => {
  const { t } = useTranslation();
  const detail = model.resolveDetail(detailSelection);
  const [selectedTurns, setSelectedTurns] = useState<ReadonlySet<number>>(() => new Set());
  const [reportOpen, setReportOpen] = useState(false);

  const toggleTurn = (turn: number) =>
    setSelectedTurns((current) => {
      const next = new Set(current);
      if (!next.delete(turn)) next.add(turn);
      return next;
    });

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
            selectedTurns={selectedTurns}
            onSelectItem={(itemId) => selectDetail(model.selectConversation(itemId))}
            onOpenRecord={onOpenRecord}
            onToggleTurn={toggleTurn}
            onClearTurns={() => setSelectedTurns(new Set())}
            onExportTurns={reportSource ? () => setReportOpen(true) : undefined}
          />
        }
        right={<AgentFactsPane session={session} model={model} onOpenRecord={onOpenRecord} />}
      />
      {reportOpen && reportSource ? (
        <DeferredLoadBoundary resetKey="turn-report">
          <TurnReportDialog
            key={reportSource.source.sourceRevision}
            source={reportSource.source}
            records={reportSource.records}
            format={session.fileType}
            model={model}
            turns={[...selectedTurns].sort((a, b) => a - b)}
            onClose={() => setReportOpen(false)}
          />
        </DeferredLoadBoundary>
      ) : null}
    </div>
  );
};
