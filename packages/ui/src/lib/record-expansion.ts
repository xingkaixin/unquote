export type ExpandedStringifiedPathsByRecord = ReadonlyMap<string, ReadonlySet<string>>;

interface SearchExpansionSuppression {
  revision: number;
  paths: ReadonlySet<string> | "all";
}

export interface StringifiedExpansionState {
  expandedPaths: ExpandedStringifiedPathsByRecord;
  searchExpansionSuppressions: ReadonlyMap<string, SearchExpansionSuppression>;
}

const noExpandedStringifiedPaths: ReadonlySet<string> = new Set();

export const getExpandedStringifiedPaths = (
  pathsByRecord: ExpandedStringifiedPathsByRecord,
  recordId: string,
) => pathsByRecord.get(recordId) ?? noExpandedStringifiedPaths;

export const groupExpandedStringifiedPaths = (
  matches: Iterable<{
    readonly recordId: string;
    readonly stringifiedPathChain: Iterable<string>;
  }>,
): ExpandedStringifiedPathsByRecord => {
  const grouped = new Map<string, Set<string>>();

  for (const match of matches) {
    for (const path of match.stringifiedPathChain) {
      let paths = grouped.get(match.recordId);
      if (!paths) {
        paths = new Set();
        grouped.set(match.recordId, paths);
      }
      paths.add(path);
    }
  }

  return grouped;
};

const pathsAreEqual = (left: ReadonlySet<string>, right: ReadonlySet<string>) =>
  left.size === right.size && [...left].every((path) => right.has(path));

export type ExpansionEntry = readonly [recordId: string, paths: Iterable<string>];

// Every write copies the whole map once, so callers with many records must go
// through the batch entry points: applying single-record writes in a loop makes
// the copy cost quadratic in the record count.
export const addExpandedStringifiedPathsBatch = (
  pathsByRecord: ExpandedStringifiedPathsByRecord,
  entries: Iterable<ExpansionEntry>,
): ExpandedStringifiedPathsByRecord => {
  let next: Map<string, ReadonlySet<string>> | null = null;

  for (const [recordId, paths] of entries) {
    const current = getExpandedStringifiedPaths(next ?? pathsByRecord, recordId);
    let nextPaths: Set<string> | null = null;

    for (const path of paths) {
      if (!current.has(path)) {
        nextPaths ??= new Set(current);
        nextPaths.add(path);
      }
    }

    if (!nextPaths) {
      continue;
    }

    next ??= new Map(pathsByRecord);
    next.set(recordId, nextPaths);
  }

  return next ?? pathsByRecord;
};

export const replaceExpandedStringifiedPathsBatch = (
  pathsByRecord: ExpandedStringifiedPathsByRecord,
  entries: Iterable<ExpansionEntry>,
): ExpandedStringifiedPathsByRecord => {
  let next: Map<string, ReadonlySet<string>> | null = null;

  for (const [recordId, paths] of entries) {
    const nextPaths = new Set(paths);
    const current = (next ?? pathsByRecord).get(recordId);

    if (nextPaths.size === 0) {
      if (!current) {
        continue;
      }
      next ??= new Map(pathsByRecord);
      next.delete(recordId);
      continue;
    }

    if (current && pathsAreEqual(current, nextPaths)) {
      continue;
    }

    next ??= new Map(pathsByRecord);
    next.set(recordId, nextPaths);
  }

  return next ?? pathsByRecord;
};

export const addExpandedStringifiedPaths = (
  pathsByRecord: ExpandedStringifiedPathsByRecord,
  recordId: string,
  paths: Iterable<string>,
): ExpandedStringifiedPathsByRecord =>
  addExpandedStringifiedPathsBatch(pathsByRecord, [[recordId, paths]]);

export const mergeExpandedStringifiedPaths = (
  pathsByRecord: ExpandedStringifiedPathsByRecord,
  additionalPathsByRecord: ExpandedStringifiedPathsByRecord,
): ExpandedStringifiedPathsByRecord =>
  addExpandedStringifiedPathsBatch(pathsByRecord, additionalPathsByRecord);

export const projectExpandedStringifiedPaths = (
  { expandedPaths, searchExpansionSuppressions }: StringifiedExpansionState,
  searchExpandedPaths: ExpandedStringifiedPathsByRecord,
  searchExpansionRevision: number,
) => {
  let projected: Map<string, ReadonlySet<string>> | null = null;
  for (const [recordId, paths] of searchExpandedPaths) {
    const suppression = searchExpansionSuppressions.get(recordId);
    if (suppression?.revision !== searchExpansionRevision) {
      continue;
    }

    projected ??= new Map(searchExpandedPaths);
    const suppressedPaths = suppression.paths;
    if (suppressedPaths === "all") {
      projected.delete(recordId);
    } else {
      projected.set(recordId, new Set([...paths].filter((path) => !suppressedPaths.has(path))));
    }
  }
  return mergeExpandedStringifiedPaths(expandedPaths, projected ?? searchExpandedPaths);
};

export const collapseExpandedStringifiedPaths = <State extends StringifiedExpansionState>(
  state: State,
  recordIds: readonly string[],
  paths: ReadonlySet<string> | "all",
  searchExpandedPaths: ExpandedStringifiedPathsByRecord,
  searchExpansionRevision: number,
): State => {
  const expandedPaths = replaceExpandedStringifiedPathsBatch(
    state.expandedPaths,
    recordIds.map((recordId) => [
      recordId,
      paths === "all"
        ? []
        : [...getExpandedStringifiedPaths(state.expandedPaths, recordId)].filter(
            (path) => !paths.has(path),
          ),
    ]),
  );
  let nextSuppressions: Map<string, SearchExpansionSuppression> | null = null;
  for (const recordId of recordIds) {
    const searchPaths = searchExpandedPaths.get(recordId);
    if (!searchPaths) {
      continue;
    }
    const stored = state.searchExpansionSuppressions.get(recordId);
    const current = stored?.revision === searchExpansionRevision ? stored.paths : undefined;
    if (current === "all") {
      continue;
    }

    let suppressedPaths: ReadonlySet<string> | "all" = "all";
    if (paths !== "all") {
      const nextPaths = new Set(current);
      for (const path of paths) {
        if (searchPaths.has(path)) {
          nextPaths.add(path);
        }
      }
      if (nextPaths.size === (current?.size ?? 0)) {
        continue;
      }
      suppressedPaths = nextPaths;
    }
    nextSuppressions ??= new Map(state.searchExpansionSuppressions);
    nextSuppressions.set(recordId, {
      revision: searchExpansionRevision,
      paths: suppressedPaths,
    });
  }
  return expandedPaths === state.expandedPaths && !nextSuppressions
    ? state
    : {
        ...state,
        expandedPaths,
        searchExpansionSuppressions: nextSuppressions ?? state.searchExpansionSuppressions,
      };
};
