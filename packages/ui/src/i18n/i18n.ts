export type Locale = "en" | "zh-CN";

export interface Messages {
  readonly "app.tab.input": string;
  readonly "app.tab.output": string;
  readonly "app.tab.agent": string;
  readonly "app.tab.json": string;
  readonly "app.expand": string;
  readonly "app.chrome": string;
  readonly "theme.toggle": string;
  readonly "theme.light": string;
  readonly "theme.dark": string;
  readonly "theme.system": string;
  readonly "toolbar.copy": string;
  readonly "toolbar.copyJsonl": string;
  readonly "toolbar.copyFormattedJson": string;
  readonly "toolbar.copyBlocked": string;
  readonly "toolbar.exporting": string;
  readonly "toolbar.exportDone": string;
  readonly "toolbar.exportFailed": string;
  readonly "toolbar.export": string;
  readonly "toolbar.exportJsonl": string;
  readonly "toolbar.exportJson": string;
  readonly "toolbar.expandAll": string;
  readonly "toolbar.collapseAll": string;
  readonly "toolbar.more": string;
  readonly "command.launch": string;
  readonly "command.open": string;
  readonly "command.openShort": string;
  readonly "command.palette": string;
  readonly "command.placeholder": string;
  readonly "command.close": string;
  readonly "command.search": string;
  readonly "command.searchMode": string;
  readonly "command.pathMode": string;
  readonly "command.searchMatches": string;
  readonly "command.pathMatches": string;
  readonly "command.visibleRecords": string;
  readonly "command.filterCommands": string;
  readonly "command.active": string;
  readonly "overview.title": string;
  readonly "overview.fullScope": string;
  readonly "overview.filteredScope": string;
  readonly "overview.total": string;
  readonly "overview.success": string;
  readonly "overview.failed": string;
  readonly "overview.nestedRecords": string;
  readonly "overview.maxDepth": string;
  readonly "overview.topNestedPaths": string;
  readonly "overview.topFieldValues": string;
  readonly "overview.errors": string;
  readonly "overview.none": string;
  readonly "overview.count": string;
  readonly "overview.errorLine": string;
  readonly "overview.errorMore": string;
  readonly "overview.jumpToPath": string;
  readonly "overview.searchValue": string;
  readonly "overview.jumpToError": string;
  readonly "agent.metric.events": string;
  readonly "agent.metric.messages": string;
  readonly "agent.metric.turns": string;
  readonly "agent.metric.tools": string;
  readonly "agent.sessionId": string;
  readonly "agent.model": string;
  readonly "agent.cwd": string;
  readonly "agent.version": string;
  readonly "agent.warnings": string;
  readonly "agent.timeline": string;
  readonly "agent.rawJsonl": string;
  readonly "agent.collapseTimeline": string;
  readonly "agent.expandTimeline": string;
  readonly "agent.collapseRawData": string;
  readonly "agent.expandRawData": string;
  readonly "agent.conversation": string;
  readonly "agent.noConversation": string;
  readonly "agent.line": string;
  readonly "agent.turn": string;
  readonly "agent.role.user": string;
  readonly "agent.role.assistant": string;
  readonly "agent.role.system": string;
  readonly "agent.role.thinking": string;
  readonly "agent.role.toolCall": string;
  readonly "agent.role.toolResult": string;
  readonly "agent.category.user": string;
  readonly "agent.category.assistant": string;
  readonly "agent.category.thinking": string;
  readonly "agent.category.tool": string;
  readonly "agent.category.system": string;
  readonly "agent.category.meta": string;
  readonly "agent.category.unknown": string;
  readonly "input.expandSource": string;
  readonly "input.placeholder": string;
  readonly "input.dropActive": string;
  readonly "input.dropHint": string;
  readonly "input.filePreviewHint": string;
  readonly "input.readingFile": string;
  readonly "input.parsingFile": string;
  readonly "input.loadedFile": string;
  readonly "input.readFailed": string;
  readonly "input.parseErrorTitle": string;
  readonly "input.parseErrorMode": string;
  readonly "samples.label": string;
  readonly "samples.ariaLabel": string;
  readonly "samples.escapedApiResponse": string;
  readonly "samples.agentToolCallJsonl": string;
  readonly "samples.codexRolloutJsonl": string;
  readonly "samples.mixedValidInvalidJsonl": string;
  readonly "toc.title": string;
  readonly "toc.stats": string;
  readonly "toc.filteredStats": string;
  readonly "tree.nodes": string;
  readonly "tree.scrollHint": string;
  readonly "tree.toggle": string;
  readonly "tree.focused": string;
  readonly "tree.exitFocus": string;
  readonly "stats.label": string;
  readonly "stats.filteredLabel": string;
  readonly "stats.progress": string;
  readonly "error.parseFailed": string;
  readonly "error.location": string;
  readonly "error.rawLine": string;
  readonly "error.context": string;
  readonly "error.copyRawLine": string;
  readonly "error.copyDetails": string;
  readonly "error.message": string;
  readonly "extension.openInUnquote": string;
  readonly "search.placeholder": string;
  readonly "search.regex": string;
  readonly "search.caseSensitive": string;
  readonly "search.prev": string;
  readonly "search.next": string;
  readonly "search.clear": string;
  readonly "search.jq": string;
  readonly "filter.all": string;
  readonly "filter.matches": string;
  readonly "filter.errors": string;
  readonly "filter.nested": string;
  readonly "filter.tools": string;
  readonly "filter.messages": string;
  readonly "filter.events": string;
  readonly "insight.kind.error": string;
  readonly "insight.kind.tool": string;
  readonly "insight.kind.message": string;
  readonly "insight.kind.event": string;
  readonly "insight.nested": string;
  readonly "insight.depth": string;
  readonly "insight.paths": string;
  readonly "insight.more": string;
  readonly "path.placeholder": string;
  readonly "path.jump": string;
  readonly "path.invalid": string;
  readonly "path.notFound": string;
}

export type MessageKey = keyof Messages;

const STORAGE_KEY = "unquote-locale";

const SUPPORTED: readonly Locale[] = ["en", "zh-CN"];

const isLocale = (value: string): value is Locale =>
  (SUPPORTED as readonly string[]).includes(value);

export const detectLocale = (): Locale => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && isLocale(stored)) {
      return stored;
    }
  } catch {}

  const lang = navigator.language;
  if (lang.startsWith("zh")) {
    return "zh-CN";
  }
  return "en";
};

export const persistLocale = (locale: Locale) => {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {}
};

export const createTranslator =
  (messages: Messages) =>
  (key: MessageKey, params?: Record<string, string | number>): string => {
    let result = messages[key];
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        result = result.replace(`{${k}}`, String(v));
      }
    }
    return result;
  };
