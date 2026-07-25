export type ExpandedStringifiedPathsByRecord = ReadonlyMap<string, ReadonlySet<string>>;

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

export const replaceExpandedStringifiedPaths = (
  pathsByRecord: ExpandedStringifiedPathsByRecord,
  recordId: string,
  paths: Iterable<string>,
): ExpandedStringifiedPathsByRecord =>
  replaceExpandedStringifiedPathsBatch(pathsByRecord, [[recordId, paths]]);

export const toggleExpandedStringifiedPath = (
  pathsByRecord: ExpandedStringifiedPathsByRecord,
  recordId: string,
  path: string,
): ExpandedStringifiedPathsByRecord => {
  const nextPaths = new Set(getExpandedStringifiedPaths(pathsByRecord, recordId));
  if (nextPaths.has(path)) {
    nextPaths.delete(path);
  } else {
    nextPaths.add(path);
  }

  return replaceExpandedStringifiedPaths(pathsByRecord, recordId, nextPaths);
};

export const clearExpandedStringifiedPaths = (
  pathsByRecord: ExpandedStringifiedPathsByRecord,
  recordIds: Iterable<string>,
): ExpandedStringifiedPathsByRecord => {
  let next: Map<string, ReadonlySet<string>> | null = null;

  for (const recordId of recordIds) {
    if (pathsByRecord.has(recordId)) {
      next ??= new Map(pathsByRecord);
      next.delete(recordId);
    }
  }

  return next ?? pathsByRecord;
};
