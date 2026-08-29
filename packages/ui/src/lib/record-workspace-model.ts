import type { JsonlRecord } from "@unquote/core";
import type { RecordInsights } from "./record-derivation";
import type { NestedFilterScope, RecordFilterMode } from "./record-filter";
import type { SearchMatch } from "./record-search";
import type { RecordViewActions } from "./record-view";
import type { ScrollIntent } from "./scroll-intent";
import type { SelectedNodeProjection } from "./selected-node";

export interface RecordWorkspaceModel {
  filter: {
    mode: RecordFilterMode;
    shown: number;
    total: number;
    nestedScope: NestedFilterScope;
  };
  records: {
    visible: readonly JsonlRecord[];
    insights: RecordInsights;
    turnIndexByRecordId: ReadonlyMap<string, number> | null;
  };
  active: {
    id: string;
    record: JsonlRecord | null;
    expandedStringifiedPaths: ReadonlySet<string>;
    searchMatches: SearchMatch[];
    activeMatchPath: string | null;
    selectedPath: string | null;
    selectedNode: SelectedNodeProjection;
    expandedNestedCount: number;
    hasNestedJson: boolean;
  };
  scrollIntent: ScrollIntent | null;
  intent: {
    setFilter: (mode: RecordFilterMode) => void;
    selectRecord: (record: JsonlRecord) => void;
    recordView: RecordViewActions;
    expandAll: () => void;
    collapseAll: () => void;
    copySelectedValue: () => void;
    copySelectedPath: () => void;
  };
}
