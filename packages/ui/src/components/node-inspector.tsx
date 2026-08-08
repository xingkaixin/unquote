import { memo } from "react";
import { useTranslation } from "../i18n/context";
import type { SelectedNodeProjection } from "../lib/selected-node";
import { Button } from "./button";

export interface NodeInspectorProps {
  projection: SelectedNodeProjection;
  hasNestedJson: boolean;
  onCopyValue: () => void;
  onCopyPath: () => void;
  onExpandNested: () => void;
}

export const NodeInspector = memo(function NodeInspector({
  projection,
  hasNestedJson,
  onCopyValue,
  onCopyPath,
  onExpandNested,
}: NodeInspectorProps) {
  const { t } = useTranslation();
  const hasSelection = projection.kind !== "empty";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-4 py-3.5">
      <div className="flex flex-col gap-1">
        <h2 className="uq-label m-0">{t("inspector.title")}</h2>
        {hasSelection ? (
          <>
            <span className="text-[13px] font-medium text-text-primary">
              {projection.selection.rawKey}
            </span>
            <span className="break-all font-mono text-[11px] text-text-secondary">
              {projection.selection.pathText}
            </span>
          </>
        ) : (
          <span className="text-[12px] text-text-tertiary">{t("inspector.empty")}</span>
        )}
      </div>

      {hasSelection ? (
        <>
          <div className="max-h-[300px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface-50 p-2.5 font-mono text-[11.5px] leading-[19px] text-text-primary">
            {projection.kind === "value" ? projection.text : null}
            {projection.kind === "loading" ? t("inspector.loading") : null}
            {projection.kind === "too-large" ? t("inspector.tooLarge") : null}
          </div>
          {projection.kind === "value" && projection.truncated ? (
            <span className="text-[11px] text-text-tertiary">{t("inspector.truncated")}</span>
          ) : null}
          {projection.kind === "value" && projection.copy.kind === "blocked" ? (
            <span className="text-[11px] text-text-tertiary">{t("inspector.copyBlocked")}</span>
          ) : null}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-[30px] flex-1 rounded-md"
              disabled={projection.copy.kind === "blocked"}
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
