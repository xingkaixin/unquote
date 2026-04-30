import type { JsonlRecord } from "@unquote/core";
import type { SearchMatch } from "../lib/tree";
import { JsonTree } from "./json-tree";

interface RecordListProps {
  records: JsonlRecord[];
  expandedStringifiedPaths: Set<string>;
  restoredRecordIds: Set<string>;
  searchMatches: SearchMatch[];
  activeMatch: { recordId: string; pathText: string } | null;
  onTogglePath: (path: string) => void;
  onCopyRecord: (record: JsonlRecord) => void;
  onCopyPath: (path: string) => void;
  onCopyNode: (recordId: string, row: import("../lib/tree").TreeRow) => void;
  onRestoreRecord: (recordId: string) => void;
  onHoverPath: (path: string | null) => void;
}

export const RecordList = ({
  records,
  expandedStringifiedPaths,
  restoredRecordIds,
  searchMatches,
  activeMatch,
  onTogglePath,
  onCopyRecord,
  onCopyPath,
  onCopyNode,
  onRestoreRecord,
  onHoverPath,
}: RecordListProps) => (
  <div className="flex flex-col gap-3">
    {records.map((record, index) => (
      <JsonTree
        key={record.id}
        record={record}
        expandedStringifiedPaths={expandedStringifiedPaths}
        restoredRecordIds={restoredRecordIds}
        eager={index < 6}
        searchMatches={searchMatches.filter((m) => m.recordId === record.id)}
        activeMatch={activeMatch?.recordId === record.id ? activeMatch : null}
        onTogglePath={onTogglePath}
        onCopyRecord={() => onCopyRecord(record)}
        onCopyPath={onCopyPath}
        onCopyNode={(row) => onCopyNode(record.id, row)}
        onRestoreRecord={() => onRestoreRecord(record.id)}
        onHoverPath={onHoverPath}
      />
    ))}
  </div>
);
