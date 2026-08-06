import { useTranslation } from "../i18n/context";
import { NodeInspector, type NodeInspectorProps } from "./node-inspector";
import { RecordFilterBar, type RecordFilterBarProps } from "./record-filter-bar";
import { RecordRail, type RecordRailProps } from "./record-rail";
import { RecordTreePane, type RecordTreePaneProps } from "./record-tree-pane";
import { WorkspaceColumns } from "./workspace-columns";

export interface JsonWorkspaceProps {
  isDesktop: boolean;
  filterBar: RecordFilterBarProps;
  rail: RecordRailProps;
  tree: RecordTreePaneProps;
  inspector: NodeInspectorProps;
}

export const JsonWorkspace = ({
  isDesktop,
  filterBar,
  rail,
  tree,
  inspector,
}: JsonWorkspaceProps) => {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RecordFilterBar {...filterBar} />
      <WorkspaceColumns
        isDesktop={isDesktop}
        leftWidth={340}
        rightWidth={310}
        leftMobileHeight="30vh"
        rightLabel={t("inspector.title")}
        left={<RecordRail {...rail} />}
        center={<RecordTreePane {...tree} />}
        right={<NodeInspector {...inspector} />}
      />
    </div>
  );
};
