import type { JsonlRecord } from "@unquote/core";
import { ChevronsDownUp, ChevronsUpDown, Copy } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "../i18n/context";
import { parseTreePath } from "../lib/path-codec";
import type { SearchMatch } from "../lib/record-search";
import type { RecordViewActions } from "../lib/record-view";
import type { ScrollIntent } from "../lib/scroll-intent";
import { Button } from "./button";
import { JsonTree } from "./json-tree";

export interface RecordTreePaneProps {
  record: JsonlRecord | null;
  expandedStringifiedPaths: ReadonlySet<string>;
  searchMatches: SearchMatch[];
  activeMatchPath: string | null;
  scrollIntent: ScrollIntent | null;
  selectedPath: string | null;
  expandedNestedCount: number;
  actions: RecordViewActions;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}

const formatBreadcrumb = (selectedPath: string | null) => {
  const segments = selectedPath ? parseTreePath(selectedPath) : null;
  return segments?.length ? segments.map((segment) => segment.value).join(" › ") : "$";
};

export const RecordTreePane = ({
  record,
  expandedStringifiedPaths,
  searchMatches,
  activeMatchPath,
  scrollIntent,
  selectedPath,
  expandedNestedCount,
  actions,
  onExpandAll,
  onCollapseAll,
}: RecordTreePaneProps) => {
  const { t } = useTranslation();

  // The lazy-mount frontier that used to request Full Records lives here now:
  // the pane shows exactly one record, so the record it shows is the request.
  useEffect(() => {
    if (record?.status === "preview") {
      actions.requestFullRecord(record);
    }
  }, [actions, record]);

  if (!record) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6">
        <p className="m-0 text-[12px] text-text-tertiary">{t("tree.empty")}</p>
      </div>
    );
  }

  return (
    <div id={record.id} className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-border bg-surface-100 px-4 py-2.5">
        <span className="min-w-0 truncate font-mono text-[12px] text-text-secondary">
          {formatBreadcrumb(selectedPath)}
        </span>
        <span className="flex-1" />
        <Button
          data-benchmark-action="expand-all"
          variant="outline"
          size="sm"
          className="h-6 gap-1.5 rounded-sm px-2.5"
          onClick={onExpandAll}
        >
          <ChevronsUpDown className="size-3" />
          {t("toolbar.expandAll")}
        </Button>
        <Button
          data-benchmark-action="collapse-all"
          variant="outline"
          size="sm"
          className="h-6 gap-1.5 rounded-sm px-2.5"
          disabled={expandedNestedCount === 0}
          onClick={onCollapseAll}
        >
          <ChevronsDownUp className="size-3" />
          {t("toolbar.collapseAll")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="uq-icon-button h-6 w-6 px-0"
          aria-label={t("tree.copyRecord")}
          onClick={() => actions.copyRecord(record)}
        >
          <Copy className="size-3.5" />
        </Button>
      </div>
      <JsonTree
        record={record}
        expandedStringifiedPaths={expandedStringifiedPaths}
        searchMatches={searchMatches}
        activeMatchPath={activeMatchPath}
        scrollIntent={scrollIntent}
        selectedPath={selectedPath}
        actions={actions}
      />
    </div>
  );
};
