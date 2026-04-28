export type Locale = "en" | "zh-CN";

export interface Messages {
  readonly "app.tab.input": string;
  readonly "app.tab.output": string;
  readonly "app.expand": string;
  readonly "theme.toggle": string;
  readonly "theme.light": string;
  readonly "theme.dark": string;
  readonly "theme.system": string;
  readonly "toolbar.copyAll": string;
  readonly "toolbar.expandAll": string;
  readonly "toolbar.restoreAll": string;
  readonly "input.expandSource": string;
  readonly "input.placeholder": string;
  readonly "toc.title": string;
  readonly "tree.nodes": string;
  readonly "tree.scrollHint": string;
  readonly "tree.toggle": string;
  readonly "stats.label": string;
  readonly "extension.openInUnquote": string;
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
