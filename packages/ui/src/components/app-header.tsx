import BracketsCurlyIcon from "@phosphor-icons/core/regular/brackets-curly.svg?react";
import ClipboardTextIcon from "@phosphor-icons/core/regular/clipboard-text.svg?react";
import DownloadSimpleIcon from "@phosphor-icons/core/regular/download-simple.svg?react";
import DotsThreeIcon from "@phosphor-icons/core/regular/dots-three.svg?react";
import ListBulletsIcon from "@phosphor-icons/core/regular/list-bullets.svg?react";
import { useTranslation } from "../i18n/context";
import { isOutputView, type OutputView } from "../lib/output-view";
import type { ThemeToggleProps } from "./theme-toggle";
import { Button } from "./button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { LocaleToggle } from "./locale-toggle";
import { SearchField, type SearchFieldProps } from "./search-field";
import { Tabs, TabsList, TabsTrigger } from "./tabs";
import { ThemeToggle } from "./theme-toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

export interface AppHeaderProps {
  enabled: boolean;
  sourceName: string | null;
  onOpenImport: () => void;
  onOpenTable?: (() => void) | undefined;
  onOpenDiff?: () => void;
  outputView: OutputView | null;
  jsonTabLabel: string;
  onOutputViewChange: (view: OutputView) => void;
  search: SearchFieldProps;
  onOpenCommandPalette: () => void;
  theme: ThemeToggleProps["theme"];
  onThemeChange: ThemeToggleProps["onChange"];
  copyBlocked: boolean;
  onCopyJsonl: () => void;
  onCopyFormattedJson: () => void;
  onExportJsonl: () => void;
  onExportFormattedJson: () => void;
  onOpenReport?: (() => void) | undefined;
}

export const AppHeader = ({
  enabled,
  sourceName,
  onOpenImport,
  onOpenTable,
  onOpenDiff,
  outputView,
  jsonTabLabel,
  onOutputViewChange,
  search,
  onOpenCommandPalette,
  theme,
  onThemeChange,
  copyBlocked,
  onCopyJsonl,
  onCopyFormattedJson,
  onExportJsonl,
  onExportFormattedJson,
  onOpenReport,
}: AppHeaderProps) => {
  const { t } = useTranslation();
  const shortcut = navigator.platform.toLowerCase().includes("mac") ? "⌘K" : "Ctrl K";
  const copyHint = copyBlocked ? t("toolbar.copyBlocked") : undefined;
  const sourceLabel = sourceName ?? t(enabled ? "source.pasted" : "source.none");
  const tableDisabled = !enabled || !onOpenTable;

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface-100 px-3 py-2">
      <div className="m-0 hidden shrink-0 font-mono text-[12.5px] font-bold tracking-[var(--tracking-tag)] text-text-primary sm:flex">
        UNQUOTE
      </div>
      {outputView ? (
        <Tabs
          className="basis-full shrink-0 sm:basis-auto"
          value={outputView}
          onValueChange={(value) => {
            if (typeof value !== "string" || !isOutputView(value)) {
              return;
            }
            onOutputViewChange(value);
          }}
        >
          <TabsList className="h-7 whitespace-nowrap border-border-medium p-0">
            <TabsTrigger value="agent" data-output-tab="agent" className="h-full px-2 sm:px-4">
              {t("app.tab.agent")}
            </TabsTrigger>
            <TabsTrigger
              value="trajectory"
              data-output-tab="trajectory"
              className="h-full px-2 sm:px-4"
            >
              {t("app.tab.trajectory")}
            </TabsTrigger>
            <TabsTrigger
              value="json"
              data-output-tab="json"
              translate="no"
              className="h-full px-2 sm:px-4"
            >
              {jsonTabLabel}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      ) : null}
      <div className="flex min-w-64 basis-full items-center gap-1.5 rounded-md border border-border-medium bg-surface-50 px-2.5 sm:flex-1">
        <SearchField {...search} />
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className="shrink-0 rounded-xs border border-border px-1.5 py-0.5 font-mono text-[10px] text-text-tertiary hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
                onClick={onOpenCommandPalette}
                disabled={!enabled}
                aria-label={t("command.openShort")}
              >
                <span aria-hidden="true">{shortcut}</span>
              </button>
            }
          />
          <TooltipContent>{`${t("command.open")} · ${shortcut}`}</TooltipContent>
        </Tooltip>
      </div>
      <div className="ml-auto flex min-w-0 basis-full items-center justify-between gap-2 sm:basis-auto">
        <button
          type="button"
          className="flex h-7 min-w-0 max-w-40 flex-1 items-center gap-2 whitespace-nowrap rounded-md border border-border-medium bg-surface-50 px-2.5 text-text-secondary hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onClick={onOpenImport}
          // Names the button after what it shows: adjacent spans would otherwise
          // run together into "payload.jsonlChange" (WCAG 2.5.3 Label in Name).
          aria-label={`${sourceLabel} ${t("source.change")}`}
        >
          <span className="shrink-0 font-mono text-[11px] text-accent" aria-hidden="true">
            ◍
          </span>
          <span className="min-w-0 truncate font-mono text-[11px]">{sourceLabel}</span>
          <span className="hidden shrink-0 font-mono text-[10px] text-text-tertiary sm:flex">
            {t("source.change")}
          </span>
        </button>
        <Button
          className="hidden shrink-0 whitespace-nowrap sm:flex"
          variant="outline"
          size="sm"
          disabled={tableDisabled}
          onClick={onOpenTable}
        >
          {t("table.title")}
        </Button>
        {onOpenDiff ? (
          <Button
            className="hidden shrink-0 whitespace-nowrap sm:flex"
            variant="outline"
            size="sm"
            onClick={onOpenDiff}
          >
            {t("diff.title")}
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="sm"
                className="uq-icon-button size-7 shrink-0 px-0 sm:hidden"
                aria-label={t("toolbar.more")}
              >
                <DotsThreeIcon className="size-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className={tableDisabled ? "text-text-tertiary" : undefined}
              disabled={tableDisabled}
              onClick={onOpenTable}
            >
              {t("table.title")}
            </DropdownMenuItem>
            {onOpenDiff ? (
              <DropdownMenuItem onClick={onOpenDiff}>{t("diff.title")}</DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        <LocaleToggle />
        <ThemeToggle theme={theme} onChange={onThemeChange} />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="sm"
                className="uq-icon-button shrink-0 whitespace-nowrap px-2"
                disabled={!enabled}
                aria-label={t("toolbar.export")}
                title={t("toolbar.export")}
              >
                <DownloadSimpleIcon className="size-4 sm:hidden" aria-hidden="true" />
                <span className="hidden sm:flex">{t("toolbar.export")}</span>
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            {onOpenReport ? (
              <DropdownMenuItem className="text-[11px]" onClick={onOpenReport}>
                {t("report.title")}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem className="text-[11px]" title={copyHint} onClick={onCopyJsonl}>
              <ListBulletsIcon className="mr-2 size-3.5" />
              {t("toolbar.copyJsonl")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-[11px]"
              title={copyHint}
              onClick={onCopyFormattedJson}
            >
              <ClipboardTextIcon className="mr-2 size-3.5" />
              {t("toolbar.copyFormattedJson")}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-[11px]" onClick={onExportJsonl}>
              <DownloadSimpleIcon className="mr-2 size-3.5" />
              {t("toolbar.exportJsonl")}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-[11px]" onClick={onExportFormattedJson}>
              <BracketsCurlyIcon className="mr-2 size-3.5" />
              {t("toolbar.exportJson")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
};
