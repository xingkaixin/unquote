import { Braces, ClipboardCopy, Download, List } from "lucide-react";
import { useTranslation } from "../i18n/context";
import type { OutputView } from "../hooks/use-output-view";
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

  return (
    <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border bg-surface-100 px-4">
      <h1 className="m-0 shrink-0 font-mono text-[12.5px] font-bold tracking-[var(--tracking-tag)] text-text-primary">
        UNQUOTE
      </h1>
      {outputView ? (
        <Tabs
          className="shrink-0"
          value={outputView}
          onValueChange={(value) => onOutputViewChange(value === "agent" ? "agent" : "json")}
        >
          <TabsList className="h-7 border-border-medium p-0">
            <TabsTrigger value="agent" data-output-tab="agent" className="h-full px-4">
              {t("app.tab.agent")}
            </TabsTrigger>
            <TabsTrigger value="json" data-output-tab="json" translate="no" className="h-full px-4">
              {jsonTabLabel}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      ) : null}
      <div className="flex h-8 min-w-0 max-w-[560px] flex-1 items-center gap-1.5 rounded-md border border-border-medium bg-surface-50 px-2.5">
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
      <span className="flex-1" />
      <button
        type="button"
        className="flex h-7 min-w-0 max-w-[280px] shrink items-center gap-2 rounded-md border border-border-medium bg-surface-50 px-2.5 text-text-secondary hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onClick={onOpenImport}
        aria-label={t("source.openImport")}
      >
        <span className="shrink-0 font-mono text-[11px] text-accent" aria-hidden="true">
          ◍
        </span>
        <span className="min-w-0 truncate font-mono text-[11px]">
          {sourceName ?? t(enabled ? "source.pasted" : "source.none")}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-text-tertiary">
          {t("source.change")}
        </span>
      </button>
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
            <List className="mr-2 size-3.5" />
            {t("toolbar.copyJsonl")}
          </DropdownMenuItem>
          <DropdownMenuItem className="text-[11px]" title={copyHint} onClick={onCopyFormattedJson}>
            <ClipboardCopy className="mr-2 size-3.5" />
            {t("toolbar.copyFormattedJson")}
          </DropdownMenuItem>
          <DropdownMenuItem className="text-[11px]" onClick={onExportJsonl}>
            <Download className="mr-2 size-3.5" />
            {t("toolbar.exportJsonl")}
          </DropdownMenuItem>
          <DropdownMenuItem className="text-[11px]" onClick={onExportFormattedJson}>
            <Braces className="mr-2 size-3.5" />
            {t("toolbar.exportJson")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
};
