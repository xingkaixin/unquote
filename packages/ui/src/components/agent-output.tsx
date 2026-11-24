import { useEffect, useMemo } from "react";
import type { ComponentType } from "react";
import type { JsonlRecord } from "@unquote/core";
import { useDeferredComponent } from "../hooks/use-deferred-component";
import type { AgentDetailSelection, AgentSession } from "../lib/agent-session/session-types";
import { createAgentSessionModel } from "../lib/agent-session/model";
import type { TrajectoryFilters } from "../lib/trajectory-filters";
import type { OutputView } from "../lib/output-view";
import type { AgentTrajectoryViewProps } from "./agent-trajectory-view";
import { AgentSessionView, type AgentReportSource } from "./agent-session-view";
import { DeferredLoadError } from "./deferred-load-error";

let loadedAgentTrajectoryView: ComponentType<AgentTrajectoryViewProps> | null = null;

let trajectoryViewPromise: Promise<ComponentType<AgentTrajectoryViewProps>> | null = null;

const loadAgentTrajectoryView = (): Promise<ComponentType<AgentTrajectoryViewProps>> => {
  trajectoryViewPromise ??= import("./agent-trajectory-view").then(
    ({ AgentTrajectoryView }) => {
      loadedAgentTrajectoryView = AgentTrajectoryView;
      return AgentTrajectoryView;
    },
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Loader rejections are not restricted to Error instances.
    (error: unknown) => {
      trajectoryViewPromise = null;
      throw error;
    },
  );
  return trajectoryViewPromise;
};

interface AgentOutputProps {
  session: AgentSession;
  outputView: Exclude<OutputView, "json">;
  isDesktop: boolean;
  filters: TrajectoryFilters;
  detailSelection: AgentDetailSelection | null;
  reportSource: AgentReportSource | undefined;
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
  reportSource,
  resolveRecordById,
  requestFullRecordById,
  onDetailSelectionChange,
  onOpenRecord,
  onOpenTrajectoryRecord,
}: AgentOutputProps) => {
  const model = useMemo(() => createAgentSessionModel(session), [session]);
  const trajectoryView = useDeferredComponent(
    loadAgentTrajectoryView,
    outputView === "trajectory" && loadedAgentTrajectoryView === null,
  );
  const LoadedAgentTrajectoryView = loadedAgentTrajectoryView ?? trajectoryView.component;

  useEffect(() => {
    void loadAgentTrajectoryView().catch(() => undefined);
  }, []);

  if (outputView === "agent") {
    return (
      <AgentSessionView
        session={session}
        model={model}
        isDesktop={isDesktop}
        detailSelection={detailSelection}
        reportSource={reportSource}
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
