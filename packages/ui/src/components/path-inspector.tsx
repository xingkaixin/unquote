import type { JsonNode } from "@unquote/core";
import {
  Braces,
  Bug,
  ClipboardCopy,
  Copy,
  Focus,
  MoreHorizontal,
  ScanSearch,
  TextCursorInput,
  Undo2,
  X,
} from "lucide-react";
import type { MessageKey } from "../i18n/i18n";
import type { NodeSourceState } from "../lib/tree";
import { useTranslation } from "../i18n/context";
import { Badge } from "./badge";
import { Button } from "./button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

export interface PathInspectorSelection {
  recordId: string;
  recordLine: number;
  pathText: string;
  jsonPath: string;
  jqPath: string;
  rawKey: string;
  kind: JsonNode["kind"];
  sourceState: NodeSourceState;
}

interface PathInspectorProps {
  selection: PathInspectorSelection;
  focused: boolean;
  onCopy: (value: string) => void;
  onCopySubtree: () => void;
  onCopyEscapedString: () => void;
  onCopyValue: () => void;
  onCopyDebugBundle: () => void;
  onFocus: () => void;
  onClearFocus: () => void;
  onClear: () => void;
  canCopyEscapedString: boolean;
}

const getSourceLabelKey = (sourceState: NodeSourceState): MessageKey => {
  switch (sourceState) {
    case "stringified":
      return "path.source.stringified";
    case "inside-stringified":
      return "path.source.insideStringified";
    case "source":
      return "path.source.source";
  }
};

export const PathInspector = ({
  selection,
  focused,
  onCopy,
  onCopySubtree,
  onCopyEscapedString,
  onCopyValue,
  onCopyDebugBundle,
  onFocus,
  onClearFocus,
  onClear,
  canCopyEscapedString,
}: PathInspectorProps) => {
  const { t } = useTranslation();
  const sourceKey = getSourceLabelKey(selection.sourceState);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-100 px-3 py-2 shadow-sm">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <Badge className="gap-1 border-transparent bg-surface-300 text-text-primary">
          <ScanSearch className="size-3" />
          {t("path.inspector")}
        </Badge>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-primary">
          {selection.jsonPath}
        </span>
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-text-muted">
          <span>
            {t("path.rawKey")}: <span className="font-mono">{selection.rawKey}</span>
          </span>
          <span>
            {t("path.type")}: <span className="font-mono">{selection.kind}</span>
          </span>
          <span>
            {t("path.source")}: {t(sourceKey)}
          </span>
          <span>
            {t("path.record")}: #{selection.recordLine}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="default" size="sm" onClick={focused ? onClearFocus : onFocus}>
          {focused ? <Undo2 className="size-3.5" /> : <Focus className="size-3.5" />}
          {t(focused ? "path.exitFocus" : "path.focusSubtree")}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 px-0"
              aria-label={t("toolbar.more")}
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="text-[11px]" onSelect={onCopySubtree}>
              <ClipboardCopy className="mr-2 size-3.5" />
              {t("path.copySubtree")}
            </DropdownMenuItem>
            {canCopyEscapedString ? (
              <DropdownMenuItem className="text-[11px]" onSelect={onCopyEscapedString}>
                <Copy className="mr-2 size-3.5" />
                {t("path.copyEscapedString")}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem className="text-[11px]" onSelect={onCopyValue}>
              <TextCursorInput className="mr-2 size-3.5" />
              {t("path.copyValue")}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-[11px]" onSelect={onCopyDebugBundle}>
              <Bug className="mr-2 size-3.5" />
              {t("path.copyDebugBundle")}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-[11px]" onSelect={() => onCopy(selection.jsonPath)}>
              <Copy className="mr-2 size-3.5" />
              {t("path.copyJsonPath")}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-[11px]" onSelect={() => onCopy(selection.jqPath)}>
              <Braces className="mr-2 size-3.5" />
              {t("path.copyJq")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 px-0"
          onClick={onClear}
          aria-label={t("path.clearSelection")}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  );
};
