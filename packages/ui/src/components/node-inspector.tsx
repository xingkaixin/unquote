import type { JsonlRecord } from "@unquote/core";
import { materializeNode } from "@unquote/core";
import { memo, useMemo } from "react";
import { useTranslation } from "../i18n/context";
import {
  inspectorCharLimit,
  isNodeWithinInspectorBudget,
  resolveSelectedNode,
} from "../lib/selected-node";
import type { SelectedPath } from "../lib/workspace-selection";
import { Button } from "./button";

type InspectorValue =
  | { kind: "loading" }
  | { kind: "too-large" }
  | { kind: "value"; text: string; truncated: boolean };

export interface NodeInspectorProps {
  record: JsonlRecord | null;
  selectedPath: SelectedPath | null;
  hasNestedJson: boolean;
  onCopyValue: () => void;
  onCopyPath: () => void;
  onExpandNested: () => void;
}

const resolveInspectorValue = (
  record: JsonlRecord | null,
  selectedPath: SelectedPath | null,
): InspectorValue | null => {
  if (!record || !selectedPath || selectedPath.recordId !== record.id) {
    return null;
  }
  if (record.status === "preview") {
    return { kind: "loading" };
  }

  const resolved = resolveSelectedNode(record, selectedPath);
  if (!resolved) {
    return null;
  }
  if (!isNodeWithinInspectorBudget(resolved.node)) {
    return { kind: "too-large" };
  }

  const text = JSON.stringify(materializeNode(resolved.node), null, 2) ?? "";
  return text.length > inspectorCharLimit
    ? { kind: "value", text: text.slice(0, inspectorCharLimit), truncated: true }
    : { kind: "value", text, truncated: false };
};

export const NodeInspector = memo(function NodeInspector({
  record,
  selectedPath,
  hasNestedJson,
  onCopyValue,
  onCopyPath,
  onExpandNested,
}: NodeInspectorProps) {
  const { t } = useTranslation();
  // The header's search field re-renders the whole app on every keystroke;
  // materializing a multi-MB subtree per keystroke is what this guards.
  const value = useMemo(() => resolveInspectorValue(record, selectedPath), [record, selectedPath]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-4 py-3.5">
      <div className="flex flex-col gap-1">
        <span className="uq-label">{t("inspector.title")}</span>
        {value && selectedPath ? (
          <>
            <span className="text-[13px] font-medium text-text-primary">{selectedPath.rawKey}</span>
            <span className="break-all font-mono text-[11px] text-text-secondary">
              {selectedPath.pathText}
            </span>
          </>
        ) : (
          <span className="text-[12px] text-text-tertiary">{t("inspector.empty")}</span>
        )}
      </div>

      {value ? (
        <>
          <div className="max-h-[300px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface-50 p-2.5 font-mono text-[11.5px] leading-[19px] text-text-primary">
            {value.kind === "value" ? value.text : null}
            {value.kind === "loading" ? t("inspector.loading") : null}
            {value.kind === "too-large" ? t("inspector.tooLarge") : null}
          </div>
          {value.kind === "value" && value.truncated ? (
            <span className="text-[11px] text-text-tertiary">{t("inspector.truncated")}</span>
          ) : null}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-[30px] flex-1 rounded-md"
              onClick={onCopyValue}
            >
              {t("inspector.copyValue")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-[30px] flex-1 rounded-md"
              onClick={onCopyPath}
            >
              {t("inspector.copyPath")}
            </Button>
          </div>
        </>
      ) : null}

      {hasNestedJson ? (
        <div className="flex flex-col items-start gap-1.5 rounded-md border border-accent bg-accent-soft px-3 py-2.5">
          <span className="text-[12px] font-medium text-accent">{t("inspector.nestedTitle")}</span>
          <span className="text-[11.5px] leading-[17px] text-text-secondary">
            {t("inspector.nestedBody")}
          </span>
          <Button
            variant="secondary"
            size="sm"
            className="h-6 rounded-sm px-2.5"
            onClick={onExpandNested}
          >
            {t("inspector.expandNested")}
          </Button>
        </div>
      ) : null}
    </div>
  );
});
