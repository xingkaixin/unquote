import type { JsonlRecord } from "@unquote/core";
import type { SearchMatch } from "../lib/tree";
import { JsonTree } from "./json-tree";

interface RecordListProps {
  records: JsonlRecord[];
  expandedStringifiedPaths: Set<string>;
  restoredRecordIds: Set<string>;
  searchMatches: SearchMatch[];
  activeMatch: { recordId: string; pathText: string } | null;
  scrollTarget: { recordId: string; pathText: string; requestId: number } | null;
  selectedPath: { recordId: string; pathText: string } | null;
  onTogglePath: (path: string) => void;
  onCopyRecord: (record: JsonlRecord) => void;
  onCopyPath: (path: string) => void;
  onCopyNode: (recordId: string, row: import("../lib/tree").TreeRow) => void;
  onSelectNode: (record: JsonlRecord, row: import("../lib/tree").TreeRow) => void;
  onRestoreRecord: (recordId: string) => void;
  onHoverPath: (path: string | null) => void;
}

export const RecordList = ({
  records,
  expandedStringifiedPaths,
  restoredRecordIds,
  searchMatches,
  activeMatch,
  scrollTarget,
  selectedPath,
  onTogglePath,
  onCopyRecord,
  onCopyPath,
  onCopyNode,
  onSelectNode,
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
        scrollTarget={scrollTarget?.recordId === record.id ? scrollTarget : null}
        selectedPath={selectedPath?.recordId === record.id ? selectedPath : null}
        onTogglePath={onTogglePath}
        onCopyRecord={() => onCopyRecord(record)}
        onCopyPath={onCopyPath}
        onCopyNode={(row) => onCopyNode(record.id, row)}
        onSelectNode={(row) => onSelectNode(record, row)}
        onRestoreRecord={() => onRestoreRecord(record.id)}
        onHoverPath={onHoverPath}
      />
    ))}
  </div>
);
