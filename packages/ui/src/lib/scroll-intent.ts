export type ScrollIntent =
  | { kind: "record"; recordId: string }
  | { kind: "path"; recordId: string; pathText: string };

interface ScrollRecord {
  id: string;
}

interface ScrollRow {
  kind: string;
  source: { pathText: string };
}

export const issueScrollIntent = (target: ScrollIntent): ScrollIntent => ({ ...target });

export const retainVisibleScrollIntent = (
  intent: ScrollIntent | null,
  visibleRecordIds: ReadonlySet<string>,
) => (intent && visibleRecordIds.has(intent.recordId) ? intent : null);

export const resolveRecordScrollIndex = (
  records: readonly ScrollRecord[],
  intent: ScrollIntent | null,
) => (intent ? records.findIndex((record) => record.id === intent.recordId) : -1);

export const targetsPathInRecord = (
  intent: ScrollIntent | null,
  recordId: string,
): intent is Extract<ScrollIntent, { kind: "path" }> =>
  intent?.kind === "path" && intent.recordId === recordId;

export const resolvePathScrollIndex = (
  rows: readonly ScrollRow[],
  recordId: string,
  intent: ScrollIntent | null,
) => {
  if (!targetsPathInRecord(intent, recordId)) {
    return -1;
  }

  return rows.findIndex((row) => row.kind !== "close" && row.source.pathText === intent.pathText);
};
