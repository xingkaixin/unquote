export type Locale = "en" | "zh-CN";

export interface Messages {
  readonly "app.tab.input": string;
  readonly "app.tab.output": string;
  readonly "app.expand": string;
  readonly "app.chrome": string;
  readonly "theme.toggle": string;
  readonly "theme.light": string;
  readonly "theme.dark": string;
  readonly "theme.system": string;
  readonly "toolbar.copy": string;
  readonly "toolbar.copyJsonl": string;
  readonly "toolbar.copyFormattedJson": string;
  readonly "toolbar.export": string;
  readonly "toolbar.exportJsonl": string;
  readonly "toolbar.exportJson": string;
  readonly "toolbar.expandAll": string;
  readonly "toolbar.restoreAll": string;
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
  readonly "input.expandSource": string;
  readonly "input.placeholder": string;
  readonly "input.dropActive": string;
  readonly "input.dropHint": string;
  readonly "input.filePreviewHint": string;
  readonly "input.readingFile": string;
  readonly "input.parsingFile": string;
  readonly "input.loadedFile": string;
  readonly "input.parseErrorTitle": string;
  readonly "input.parseErrorMode": string;
  readonly "samples.label": string;
  readonly "samples.ariaLabel": string;
  readonly "samples.escapedApiResponse": string;
  readonly "samples.agentToolCallJsonl": string;
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
  readonly "stats.autoFailureMode": string;
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
  readonly "path.placeholder": string;
  readonly "path.jump": string;
  readonly "path.invalid": string;
  readonly "path.notFound": string;
  readonly "path.inspector": string;
  readonly "path.copyJsonPath": string;
  readonly "path.copyJq": string;
  readonly "path.focusSubtree": string;
  readonly "path.exitFocus": string;
  readonly "path.copySubtree": string;
  readonly "path.copyEscapedString": string;
  readonly "path.copyValue": string;
  readonly "path.copyDebugBundle": string;
  readonly "path.rawKey": string;
  readonly "path.type": string;
  readonly "path.source": string;
  readonly "path.record": string;
  readonly "path.clearSelection": string;
  readonly "path.source.source": string;
  readonly "path.source.stringified": string;
  readonly "path.source.insideStringified": string;
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
