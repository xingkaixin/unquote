export type ExpandedStringifiedPathsByRecord = ReadonlyMap<string, ReadonlySet<string>>;

const noExpandedStringifiedPaths: ReadonlySet<string> = new Set();

export const getExpandedStringifiedPaths = (
  pathsByRecord: ExpandedStringifiedPathsByRecord,
  recordId: string,
) => pathsByRecord.get(recordId) ?? noExpandedStringifiedPaths;

const pathsAreEqual = (left: ReadonlySet<string>, right: ReadonlySet<string>) =>
  left.size === right.size && [...left].every((path) => right.has(path));

export const addExpandedStringifiedPaths = (
  pathsByRecord: ExpandedStringifiedPathsByRecord,
  recordId: string,
  paths: Iterable<string>,
): ExpandedStringifiedPathsByRecord => {
  const current = getExpandedStringifiedPaths(pathsByRecord, recordId);
  let nextPaths: Set<string> | null = null;

  for (const path of paths) {
    if (!current.has(path)) {
      nextPaths ??= new Set(current);
      nextPaths.add(path);
    }
  }

  if (!nextPaths) {
    return pathsByRecord;
  }

  const next = new Map(pathsByRecord);
  next.set(recordId, nextPaths);
  return next;
};

export const mergeExpandedStringifiedPaths = (
  pathsByRecord: ExpandedStringifiedPathsByRecord,
  additionalPathsByRecord: ExpandedStringifiedPathsByRecord,
): ExpandedStringifiedPathsByRecord => {
  let next = pathsByRecord;
  for (const [recordId, paths] of additionalPathsByRecord) {
    next = addExpandedStringifiedPaths(next, recordId, paths);
  }
  return next;
};

export const replaceExpandedStringifiedPaths = (
  pathsByRecord: ExpandedStringifiedPathsByRecord,
  recordId: string,
  paths: Iterable<string>,
): ExpandedStringifiedPathsByRecord => {
  const nextPaths = new Set(paths);
  const current = pathsByRecord.get(recordId);

  if (nextPaths.size === 0) {
    if (!current) {
      return pathsByRecord;
    }
    const next = new Map(pathsByRecord);
    next.delete(recordId);
    return next;
  }

  if (current && pathsAreEqual(current, nextPaths)) {
    return pathsByRecord;
  }

  const next = new Map(pathsByRecord);
  next.set(recordId, nextPaths);
  return next;
};

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
