import type { JsonlRecord } from "@unquote/core";
import { useTranslation } from "../i18n/context";
import type { RecordFilterMode } from "../lib/record-filter";
import type { NestedFilterScope } from "../lib/record-filter";
import type { RecordInsight } from "../lib/record-insight";
import type { SearchMatch } from "../lib/record-search";
import type { RecordViewActions } from "../lib/record-view";
import type { ScrollIntent } from "../lib/scroll-intent";
import type { SelectedNodeProjection } from "../lib/selected-node";
import { NodeInspector } from "./node-inspector";
import { RecordFilterBar } from "./record-filter-bar";
import { RecordRail } from "./record-rail";
import { RecordTreePane } from "./record-tree-pane";
import { WorkspaceColumns } from "./workspace-columns";

export interface RecordWorkspaceModel {
  filter: {
    mode: RecordFilterMode;
    shown: number;
    total: number;
    nestedScope: NestedFilterScope;
  };
  records: {
    visible: readonly JsonlRecord[];
    insights: ReadonlyMap<string, RecordInsight>;
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

interface RecordWorkspaceProps {
  isDesktop: boolean;
  model: RecordWorkspaceModel;
}

export const RecordWorkspace = ({ isDesktop, model }: RecordWorkspaceProps) => {
  const { t } = useTranslation();
  const { active, filter, intent, records, scrollIntent } = model;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RecordFilterBar
        mode={filter.mode}
        onChange={intent.setFilter}
        shown={filter.shown}
        total={filter.total}
        nestedScope={filter.nestedScope}
      />
      <WorkspaceColumns
        isDesktop={isDesktop}
        leftWidth={340}
        rightWidth={310}
        leftMobileHeight="30vh"
        rightLabel={t("inspector.title")}
        left={
          <RecordRail
            records={records.visible}
            recordInsights={records.insights}
            turnIndexByRecordId={records.turnIndexByRecordId}
            activeRecordId={active.id}
            scrollIntent={scrollIntent}
            onSelect={intent.selectRecord}
          />
        }
        center={
          <RecordTreePane
            record={active.record}
            expandedStringifiedPaths={active.expandedStringifiedPaths}
            searchMatches={active.searchMatches}
            activeMatchPath={active.activeMatchPath}
            scrollIntent={scrollIntent}
            selectedPath={active.selectedPath}
            expandedNestedCount={active.expandedNestedCount}
            actions={intent.recordView}
            onExpandAll={intent.expandAll}
            onCollapseAll={intent.collapseAll}
          />
        }
        right={
          <NodeInspector
            projection={active.selectedNode}
            hasNestedJson={active.hasNestedJson}
            onCopyValue={intent.copySelectedValue}
            onCopyPath={intent.copySelectedPath}
            onExpandNested={intent.expandAll}
          />
        }
      />
    </div>
  );
};
