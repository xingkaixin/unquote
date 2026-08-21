import type { Messages, MessageKey } from "./en";

export type Locale = "en" | "zh-CN" | "ja";
export type { Messages, MessageKey };

const STORAGE_KEY = "unquote-locale";

const SUPPORTED: readonly Locale[] = ["en", "zh-CN", "ja"];

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
  if (lang.startsWith("ja")) {
    return "ja";
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
