import { useMemo } from "react";
import type { ComponentType } from "react";
import type { JsonlRecord } from "@unquote/core";
import { useDeferredComponent } from "../hooks/use-deferred-component";
import type { AgentDetailSelection, AgentSession } from "../lib/agent-session/types";
import { createAgentSessionModel } from "../lib/agent-session/model";
import type { TrajectoryFilters } from "../lib/trajectory-filters";
import type { OutputView } from "../lib/output-view";
import type { AgentTrajectoryViewProps } from "./agent-trajectory-view";
import { AgentSessionView } from "./agent-session-view";
import { DeferredLoadError } from "./deferred-load-error";

const loadAgentTrajectoryView = (): Promise<ComponentType<AgentTrajectoryViewProps>> =>
  import("./agent-trajectory-view").then(({ AgentTrajectoryView }) => AgentTrajectoryView);

interface AgentOutputProps {
  session: AgentSession;
  outputView: Exclude<OutputView, "json">;
  isDesktop: boolean;
  filters: TrajectoryFilters;
  detailSelection: AgentDetailSelection | null;
  resolveRecordById: (recordId: string) => JsonlRecord | null;
  requestFullRecordById: (recordId: string) => void;
  onDetailSelectionChange: (selection: AgentDetailSelection) => void;
  onOpenRecord: (recordId: string) => void;
  onOpenTrajectoryRecord: (selection: AgentDetailSelection, recordId: string) => void;
}

export const AgentOutput = ({
  session,
  outputView,
  isDesktop,
  filters,
  detailSelection,
  resolveRecordById,
  requestFullRecordById,
  onDetailSelectionChange,
  onOpenRecord,
  onOpenTrajectoryRecord,
}: AgentOutputProps) => {
  const model = useMemo(() => createAgentSessionModel(session), [session]);
  const trajectoryView = useDeferredComponent(loadAgentTrajectoryView, outputView === "trajectory");
  const LoadedAgentTrajectoryView = trajectoryView.component;

  if (outputView === "agent") {
    return (
      <AgentSessionView
        session={session}
        model={model}
        isDesktop={isDesktop}
        detailSelection={detailSelection}
        onDetailSelectionChange={onDetailSelectionChange}
        onOpenRecord={onOpenRecord}
      />
    );
  }

  if (trajectoryView.failed) {
    return <DeferredLoadError onRetry={trajectoryView.retry} />;
  }
  if (!LoadedAgentTrajectoryView) {
    return null;
  }

  return (
    <LoadedAgentTrajectoryView
      model={model}
      resolveRecordById={resolveRecordById}
      requestFullRecordById={requestFullRecordById}
      isDesktop={isDesktop}
      filters={filters}
      detailSelection={detailSelection}
      onDetailSelectionChange={onDetailSelectionChange}
      onOpenRecord={onOpenTrajectoryRecord}
    />
  );
};
