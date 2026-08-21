type ExplicitTurnScope = { readonly source: "evidence"; readonly value: string };
type FallbackTurnScope = { readonly source: "fallback-index"; readonly value: number };
type SyntheticTurnScope = { readonly source: "synthetic-event"; readonly value: string };
type AnonymousTurnScope = { readonly source: "anonymous" };

export type ToolCorrelationScope =
  | ExplicitTurnScope
  | FallbackTurnScope
  | SyntheticTurnScope
  | AnonymousTurnScope;

export type TrajectoryTurnScope = Exclude<ToolCorrelationScope, AnonymousTurnScope>;

export interface ToolCorrelationGroup<TCall, TResult, TCompletion = never> {
  calls: TCall[];
  results: TResult[];
  completions: TCompletion[];
}

export interface ToolCorrelationGroups<TCall, TResult, TCompletion = never> {
  readonly evidence: Map<string, Map<string, ToolCorrelationGroup<TCall, TResult, TCompletion>>>;
  readonly fallbackIndex: Map<
    number,
    Map<string, ToolCorrelationGroup<TCall, TResult, TCompletion>>
  >;
  readonly syntheticEvent: Map<
    string,
    Map<string, ToolCorrelationGroup<TCall, TResult, TCompletion>>
  >;
  readonly anonymous: Map<string, ToolCorrelationGroup<TCall, TResult, TCompletion>>;
}

const isFallbackTurnIndex = (value: number | undefined): value is number =>
  typeof value === "number" && Number.isSafeInteger(value);

export const toolCorrelationScope = (
  explicitTurnId: string | undefined,
  fallbackTurnIndex: number | undefined,
): ToolCorrelationScope => {
  if (explicitTurnId) {
    return { source: "evidence", value: explicitTurnId };
  }
  if (isFallbackTurnIndex(fallbackTurnIndex)) {
    return { source: "fallback-index", value: fallbackTurnIndex };
  }
  return { source: "anonymous" };
};

export const syntheticTurnScope = (eventId: string): SyntheticTurnScope => ({
  source: "synthetic-event",
  value: eventId,
});

export const trajectoryTurnId = (scope: TrajectoryTurnScope) =>
  JSON.stringify([scope.source, scope.value]);

export const createToolCorrelationGroups = <
  TCall,
  TResult,
  TCompletion = never,
>(): ToolCorrelationGroups<TCall, TResult, TCompletion> => ({
  evidence: new Map(),
  fallbackIndex: new Map(),
  syntheticEvent: new Map(),
  anonymous: new Map(),
});

const groupsByCallIdFor = <TCall, TResult, TCompletion>(
  groups: ToolCorrelationGroups<TCall, TResult, TCompletion>,
  scope: ToolCorrelationScope,
) => {
  if (scope.source === "evidence") {
    let scopedGroups = groups.evidence.get(scope.value);
    if (!scopedGroups) {
      scopedGroups = new Map();
      groups.evidence.set(scope.value, scopedGroups);
    }
    return scopedGroups;
  }
  if (scope.source === "fallback-index") {
    let scopedGroups = groups.fallbackIndex.get(scope.value);
    if (!scopedGroups) {
      scopedGroups = new Map();
      groups.fallbackIndex.set(scope.value, scopedGroups);
    }
    return scopedGroups;
  }
  if (scope.source === "synthetic-event") {
    let scopedGroups = groups.syntheticEvent.get(scope.value);
    if (!scopedGroups) {
      scopedGroups = new Map();
      groups.syntheticEvent.set(scope.value, scopedGroups);
    }
    return scopedGroups;
  }
  return groups.anonymous;
};

export const toolCorrelationGroupFor = <TCall, TResult, TCompletion>(
  groups: ToolCorrelationGroups<TCall, TResult, TCompletion>,
  scope: ToolCorrelationScope,
  callId: string,
) => {
  const groupsByCallId = groupsByCallIdFor(groups, scope);
  let group = groupsByCallId.get(callId);
  if (!group) {
    group = { calls: [], results: [], completions: [] };
    groupsByCallId.set(callId, group);
  }
  return group;
};

export const forEachToolCorrelationGroup = <TCall, TResult, TCompletion>(
  groups: ToolCorrelationGroups<TCall, TResult, TCompletion>,
  visit: (group: ToolCorrelationGroup<TCall, TResult, TCompletion>) => void,
) => {
  const visitCallIdGroups = (
    groupsByCallId: Map<string, ToolCorrelationGroup<TCall, TResult, TCompletion>>,
  ) => {
    for (const group of groupsByCallId.values()) {
      visit(group);
    }
  };

  for (const groupsByCallId of groups.evidence.values()) {
    visitCallIdGroups(groupsByCallId);
  }
  for (const groupsByCallId of groups.fallbackIndex.values()) {
    visitCallIdGroups(groupsByCallId);
  }
  for (const groupsByCallId of groups.syntheticEvent.values()) {
    visitCallIdGroups(groupsByCallId);
  }
  visitCallIdGroups(groups.anonymous);
};

export const uniqueToolPair = <TCall, TResult, TCompletion>(
  group: ToolCorrelationGroup<TCall, TResult, TCompletion>,
) =>
  group.calls.length === 1 && group.results.length === 1
    ? ([group.calls[0]!, group.results[0]!] as const)
    : null;

export const hasRepeatedToolOccurrences = <TCall, TResult, TCompletion>(
  group: ToolCorrelationGroup<TCall, TResult, TCompletion>,
) => group.calls.length > 1 || group.results.length > 1 || group.completions.length > 1;
