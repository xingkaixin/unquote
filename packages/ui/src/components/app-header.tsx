import BracketsCurlyIcon from "@phosphor-icons/core/regular/brackets-curly.svg?react";
import ClipboardTextIcon from "@phosphor-icons/core/regular/clipboard-text.svg?react";
import DownloadSimpleIcon from "@phosphor-icons/core/regular/download-simple.svg?react";
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
}

export const AppHeader = ({
  enabled,
  sourceName,
  onOpenImport,
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
}: AppHeaderProps) => {
  const { t } = useTranslation();
  const shortcut = navigator.platform.toLowerCase().includes("mac") ? "⌘K" : "Ctrl K";
  const copyHint = copyBlocked ? t("toolbar.copyBlocked") : undefined;
  const sourceLabel = sourceName ?? t(enabled ? "source.pasted" : "source.none");

  return (
    <header className="flex h-[52px] shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-surface-100 px-3 sm:gap-3 sm:px-4">
      <h1 className="m-0 hidden shrink-0 font-mono text-[12.5px] font-bold tracking-[var(--tracking-tag)] text-text-primary md:block">
        UNQUOTE
      </h1>
      {outputView ? (
        <Tabs
          className="shrink-0"
          value={outputView}
          onValueChange={(value) => {
            if (typeof value !== "string" || !isOutputView(value)) {
              return;
            }
            onOutputViewChange(value);
          }}
        >
          <TabsList className="h-7 border-border-medium p-0">
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
      <div className="flex h-8 min-w-40 max-w-[560px] flex-1 items-center gap-1.5 rounded-md border border-border-medium bg-surface-50 px-2.5">
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
      <span className="hidden flex-1 lg:block" />
      <button
        type="button"
        className="flex h-7 min-w-0 max-w-40 shrink items-center gap-2 rounded-md border border-border-medium bg-surface-50 px-2.5 text-text-secondary hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:max-w-[280px]"
        onClick={onOpenImport}
        // Names the button after what it shows: adjacent spans would otherwise
        // run together into "payload.jsonlChange" (WCAG 2.5.3 Label in Name).
        aria-label={`${sourceLabel} ${t("source.change")}`}
      >
        <span className="shrink-0 font-mono text-[11px] text-accent" aria-hidden="true">
          ◍
        </span>
        <span className="min-w-0 truncate font-mono text-[11px]">{sourceLabel}</span>
        <span className="shrink-0 font-mono text-[10px] text-text-tertiary">
          {t("source.change")}
        </span>
      </button>
      {onOpenDiff ? (
        <Button variant="outline" size="sm" onClick={onOpenDiff}>
          {t("diff.title")}
        </Button>
      ) : null}
      <LocaleToggle />
      <ThemeToggle theme={theme} onChange={onThemeChange} />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button size="sm" className="shrink-0 px-3" disabled={!enabled}>
              {t("toolbar.export")}
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem className="text-[11px]" title={copyHint} onClick={onCopyJsonl}>
            <ListBulletsIcon className="mr-2 size-3.5" />
            {t("toolbar.copyJsonl")}
          </DropdownMenuItem>
          <DropdownMenuItem className="text-[11px]" title={copyHint} onClick={onCopyFormattedJson}>
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
    </header>
  );
};
