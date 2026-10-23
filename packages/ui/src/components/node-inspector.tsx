import { memo, useMemo } from "react";
import { useTranslation } from "../i18n/context";
import type { MessageKey } from "../i18n/i18n";
import { decodeNodeValue } from "../lib/decoded-value";
import type { DecodedValue, TimestampSource } from "../lib/decoded-value";
import type { SelectedNodeProjection } from "../lib/selected-node";
import { Button } from "./button";

export interface NodeInspectorProps {
  projection: SelectedNodeProjection;
  hasNestedJson: boolean;
  onCopyValue: () => void;
  onCopyPath: () => void;
  onExpandNested: () => void;
}

const codeBlockClass =
  "max-h-[300px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface-50 p-2.5 font-mono text-[11.5px] leading-[19px] text-text-primary";

const timestampSourceLabel: Record<TimestampSource, MessageKey> = {
  "unix-seconds": "inspector.decoded.unixSeconds",
  "unix-milliseconds": "inspector.decoded.unixMilliseconds",
  "iso-8601": "inspector.decoded.iso8601",
};

const DecodedField = ({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className: string;
}) => (
  <div className="flex flex-col gap-1">
    <dt className="text-[11px] text-text-tertiary">{label}</dt>
    <dd className={`m-0 ${className}`}>{value}</dd>
  </div>
);

const DecodedValueView = ({ decoded }: { decoded: DecodedValue }) => {
  const { t } = useTranslation();
  const title = t(decoded.kind === "jwt" ? "inspector.decoded.jwt" : "inspector.decoded.timestamp");
  const timeClass = "break-all font-mono text-[11.5px] text-text-primary";

  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="uq-label m-0">{title}</h3>
        {decoded.kind === "jwt" ? (
          <span className="rounded-xs border border-warning px-1.5 py-0.5 font-mono text-[10.5px] text-warning">
            {t("inspector.decoded.unverified")}
          </span>
        ) : (
          <span className="rounded-xs border border-border-medium px-1.5 py-0.5 font-mono text-[10.5px] text-text-secondary">
            {t(timestampSourceLabel[decoded.source])}
          </span>
        )}
      </div>
      <dl className="m-0 flex flex-col gap-2">
        {decoded.kind === "jwt" ? (
          <>
            <DecodedField
              label={t("inspector.decoded.header")}
              value={decoded.header}
              className={codeBlockClass}
            />
            <DecodedField
              label={t("inspector.decoded.payload")}
              value={decoded.payload}
              className={codeBlockClass}
            />
          </>
        ) : (
          <>
            <DecodedField
              label={t("inspector.decoded.local", { zone: decoded.timeZone })}
              value={decoded.local}
              className={timeClass}
            />
            <DecodedField
              label={t("inspector.decoded.utc")}
              value={decoded.utc}
              className={timeClass}
            />
          </>
        )}
      </dl>
    </section>
  );
};

export const NodeInspector = memo(function NodeInspector({
  projection,
  hasNestedJson,
  onCopyValue,
  onCopyPath,
  onExpandNested,
}: NodeInspectorProps) {
  const { t } = useTranslation();
  const hasSelection = projection.kind !== "empty";
  const decoded = useMemo(
    () => (projection.kind === "value" ? decodeNodeValue(projection.node) : null),
    [projection],
  );

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
          <div className={codeBlockClass}>
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
          {decoded ? <DecodedValueView decoded={decoded} /> : null}
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
