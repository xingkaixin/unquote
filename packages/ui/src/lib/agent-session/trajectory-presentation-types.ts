import type { AgentSessionDetail } from "./model-types";
import type { AgentTrajectoryTokenUsage } from "./session-types";
import type { AgentTrajectoryItem, AgentTrajectoryTurn } from "./trajectory-types";
import type { AgentTrajectoryTimeRange } from "./trajectory-time";
import type { AgentTrajectoryWarningGroup } from "./trajectory-presentation-warnings";

export type AgentTrajectoryLane = "activity" | "model" | "tool";

export interface AgentTrajectoryPresentationSummary {
  readonly turns: number;
  readonly events: number;
  readonly tools: number;
  readonly failures: number;
  readonly durationMs?: number;
  readonly tokens: AgentTrajectoryTokenUsage;
  readonly warningCount: number;
}

export interface AgentTrajectoryPresentationItem {
  readonly ordinal: number;
  readonly item: AgentTrajectoryItem;
  readonly detail: AgentSessionDetail | null;
  readonly summary: string;
  readonly searchText: string;
  readonly lane: AgentTrajectoryLane;
  readonly interval: AgentTrajectoryTimeRange | null;
  readonly warningGroups: readonly AgentTrajectoryWarningGroup[];
  readonly turn: AgentTrajectoryTurn | null;
}

export interface AgentTrajectoryPresentationGroup {
  readonly ordinal: number;
  readonly id: string;
  readonly turn: AgentTrajectoryTurn | null;
  readonly items: readonly AgentTrajectoryPresentationItem[];
}

export interface AgentTrajectoryPresentation {
  readonly items: readonly AgentTrajectoryPresentationItem[];
  readonly groups: readonly AgentTrajectoryPresentationGroup[];
  readonly summary: AgentTrajectoryPresentationSummary;
  readonly unattachedWarningGroups: readonly AgentTrajectoryWarningGroup[];
  readonly timeDomain: AgentTrajectoryTimeRange | null;
  readonly timedItemCount: number;
}
