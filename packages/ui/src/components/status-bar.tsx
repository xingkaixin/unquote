import { Store } from "lucide-react";
import { useTranslation } from "../i18n/context";
import { cn } from "../lib/utils";

export interface StatusBarProps {
  summary: string;
  failedCount: number;
  onSelectFailed: () => void;
  maxDepth: number;
  expandedNestedCount: number;
  sourceStatus: string | undefined;
  sourceBusy: boolean;
  sourceProgress: number | null;
  hasData: boolean;
  onClear: () => void;
  chromeWebStoreUrl?: string;
  edgeAddonsUrl?: string;
}

interface ExtensionStoreLinkProps {
  href: string;
  label: string;
}

const ExtensionStoreLink = ({ href, label }: ExtensionStoreLinkProps) => (
  <a
    href={href}
    target="_blank"
    rel="noreferrer"
    aria-label={label}
    title={label}
    className="inline-flex items-center gap-1.5 text-text-tertiary hover:text-accent"
  >
    <Store className="size-3" />
    <span className="hidden sm:inline" aria-hidden="true">
      {label}
    </span>
  </a>
);

export const StatusBar = ({
  summary,
  failedCount,
  onSelectFailed,
  maxDepth,
  expandedNestedCount,
  sourceStatus,
  sourceBusy,
  sourceProgress,
  hasData,
  onClear,
  chromeWebStoreUrl,
  edgeAddonsUrl,
}: StatusBarProps) => {
  const { t } = useTranslation();
  const progressPercent =
    typeof sourceProgress === "number"
      ? Math.max(0, Math.min(100, Math.round(sourceProgress * 100)))
      : null;

  return (
    <footer className="flex h-8 shrink-0 items-center gap-4 overflow-hidden border-t border-border bg-surface-100 px-3.5 font-mono text-[10.5px] text-text-tertiary">
      <span className="min-w-0 truncate">{summary}</span>
      {hasData ? (
        <>
          <span className="hidden shrink-0 sm:inline">
            {t("status.maxDepth", { depth: maxDepth })}
          </span>
          <span className="hidden shrink-0 sm:inline">
            {t("status.expandedNested", { count: expandedNestedCount })}
          </span>
        </>
      ) : null}
      {/* The single parse-failure announcement: a live region has to be in the
          DOM before its content changes, so the region outlives the button. */}
      <span className="shrink-0" aria-live="polite">
        {failedCount > 0 ? (
          <button
            type="button"
            className="text-error hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onClick={onSelectFailed}
          >
            {t("status.failed", { count: failedCount })}
          </button>
        ) : null}
      </span>
      {sourceStatus ? (
        <div className="flex min-w-0 items-center gap-2" aria-live="polite">
          <span className="min-w-0 truncate">{sourceStatus}</span>
          {sourceBusy ? (
            <span className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-surface-200">
              <span
                className={cn(
                  "uq-motion-progress block h-full rounded-full bg-accent",
                  progressPercent === null
                    ? "uq-motion-pulse w-1/2 animate-pulse"
                    : "w-full origin-left transition-transform duration-150 ease-[var(--ease-out)]",
                )}
                style={
                  progressPercent === null
                    ? undefined
                    : { transform: `scaleX(${progressPercent / 100})` }
                }
              />
            </span>
          ) : null}
        </div>
      ) : null}
      <span className="flex-1" />
      {hasData ? (
        <>
          <button
            type="button"
            className="shrink-0 rounded-xs border border-border px-2 py-0.5 hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onClick={onClear}
          >
            {t("status.clear")}
          </button>
          <span className="hidden shrink-0 lg:inline">{t("status.hintMatches")}</span>
          <span className="hidden shrink-0 lg:inline">{t("status.hintPath")}</span>
          <span className="hidden shrink-0 lg:inline">{t("status.hintPalette")}</span>
        </>
      ) : null}
      {chromeWebStoreUrl ? (
        <ExtensionStoreLink href={chromeWebStoreUrl} label={t("app.chrome")} />
      ) : null}
      {edgeAddonsUrl ? <ExtensionStoreLink href={edgeAddonsUrl} label={t("app.edge")} /> : null}
    </footer>
  );
};
